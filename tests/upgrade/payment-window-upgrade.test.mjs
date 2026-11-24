// An upgrade proof, not part of the unit or integration suites: it needs an earlier release's Registry build.
// Build it from its own tag, then point COMMERCE_UPGRADE_FROM_SANDBOX at that build's dist/sandbox:
//   git worktree add --detach /tmp/commerce-v0.8.0 v0.8.0 && (cd /tmp/commerce-v0.8.0 && npm ci &&
//     node scripts/build.mjs && node scripts/build-sandbox.mjs)
//   npm run build && COMMERCE_UPGRADE_FROM_SANDBOX=/tmp/commerce-v0.8.0/dist/sandbox node --test tests/upgrade/*.test.mjs
// The release's own compiled runtime starts a checkout to the open payment page; this checkout's compiled runtime
// then opens the same database, reads that attempt and its payment window, and settles it to a paid order.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import BetterSqlite3 from 'better-sqlite3';
import { COMMERCE_CHECKOUT_WAKES_TASK, COMMERCE_REGISTRY_RUNTIME_ID } from '../../dist/features/checkout/index.js';
import { runtimeFixture, SITE } from '../features/checkout/registry-runtime.mjs';

const from = process.env.COMMERCE_UPGRADE_FROM_SANDBOX;
const owner = COMMERCE_REGISTRY_RUNTIME_ID;
const basket = { contact: { email: 'shopper@example.test', billing: { name: 'Bill Payer', line1: '9 Billing Way', city: 'Billtown', postalCode: '00009', country: 'US' } }, lines: [{ catalogItemId: 'hat', quantity: 1 }] };
const json = (value) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });

/** The release's own routes: 0.8.0 has no server cart, so start takes the lines and status reads the checkout. */
const releaseCall = (state, route, input, capability) => state.plugin.invokeRoute(route, input, {
  url: `${SITE}/_emdash/api/plugins/${owner}/${route}`, method: 'POST',
  headers: { origin: SITE, 'sec-fetch-site': 'same-origin', ...(capability ? { 'x-commerce-guest-capability': capability } : {}) },
});

async function startOnRelease(databasePath) {
  const release = await runtimeFixture({ databasePath,
    artifactManifest: JSON.parse(await readFile(join(from, 'manifest.json'), 'utf8')),
    backendSource: await readFile(join(from, 'plugin.mjs'), 'utf8') });
  try {
    const prepared = await releaseCall(release, 'checkout/guest/prepare', {});
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const token = prepared.capability.capability;
    const started = await releaseCall(release, 'checkout/guest/start', basket, token);
    assert.equal(started.ok, true, JSON.stringify(started));
    assert.equal(release.requests.length, 1);
    return { token, settings: await release.settings.get('installedCheckout') };
  } finally { await release.close(); }
}

function storedAttempt(databasePath) {
  const sqlite = new BetterSqlite3(databasePath);
  try {
    const row = sqlite.prepare("SELECT id, data FROM _plugin_storage WHERE plugin_id = ? AND collection = 'checkout_carts'").get(owner);
    return { cartId: row.id, record: JSON.parse(row.data) };
  } finally { sqlite.close(); }
}

/** Payments, after the upgrade, answers for the session the release saved: paid, with that same session. */
function paidAnswerFor(attempt) {
  return async (path, init) => {
    if (path.endsWith('-binding') || path.startsWith('/v1/checkout/wakes')) return undefined;
    const request = JSON.parse(new TextDecoder().decode(init.body));
    assert.equal(request.attemptId, attempt.attemptId);
    return json({ outcome: 'paid', attemptId: attempt.attemptId, total: attempt.payment.total, session: attempt.session, paymentId: 'pi_upgrade' });
  };
}

const upgraded = (databasePath) => runtimeFixture({ databasePath, seed: false, config: null });

test('a checkout open on the payment page when the store upgrades is paid on this build, with its saved settings kept', { skip: !from && 'set COMMERCE_UPGRADE_FROM_SANDBOX' }, async (t) => {
  const directory = await mkdtemp('/tmp/commerce-upgrade-window-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'store.db');
  const { token, settings } = await startOnRelease(databasePath);
  const { record } = storedAttempt(databasePath);
  const attempt = record.attempts[0];
  // The release froze a current window: 1800 to 1860 seconds, and Payments gave a 1830-second session.
  assert.deepEqual(attempt.payment.paymentWindow, { minSeconds: 1800, maxSeconds: 1860 });
  assert.equal(Object.hasOwn(attempt.payment, 'paymentWindowSeconds'), false);
  assert.equal(attempt.session.expiresAt - attempt.session.createdAt, 1830);
  t.diagnostic(`release attempt ${attempt.attemptId} phase=${attempt.phase} window=${JSON.stringify(attempt.payment.paymentWindow)} session=${attempt.session.expiresAt - attempt.session.createdAt}s`);

  const state = await upgraded(databasePath);
  t.after(() => state.close());
  assert.equal(await state.settings.get('installedCheckout'), settings, 'the saved checkout setting is unchanged');
  state.setTransportOverride(paidAnswerFor(attempt));
  const read = await state.invoke('checkout/guest/status', {}, token);
  assert.equal(read.ok, true, JSON.stringify(read));
  assert.equal(read.checkout.state, 'paid', JSON.stringify(read.checkout));
  assert.equal(read.checkout.order.total.minor, '250');
  t.diagnostic(`after upgrade: state=${read.checkout.state} order=${read.checkout.order.orderId} total=${read.checkout.order.total.minor}`);

  // The kept settings still open checkout for a new shopper on this build.
  state.setTransportOverride(null);
  const prepared = await state.invoke('checkout/guest/prepare');
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const fresh = await state.invoke('checkout/guest/start', basket, prepared.capability.capability);
  assert.equal(fresh.ok, true, JSON.stringify(fresh));
  assert.equal(fresh.checkout.state, 'pending', JSON.stringify(fresh.checkout));
  assert.equal(fresh.checkout.redirectUrl, 'https://pay.example.test/synthetic');
  t.diagnostic(`new checkout on the kept settings: state=${fresh.checkout.state}`);
});

test('an attempt frozen with the old exact 1800-second window still settles after the upgrade, and a longer session is refused', { skip: !from && 'set COMMERCE_UPGRADE_FROM_SANDBOX' }, async (t) => {
  const directory = await mkdtemp('/tmp/commerce-upgrade-window-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'store.db');
  const { token } = await startOnRelease(databasePath);
  // Releases before the bounded window and checkout pricing froze paymentWindowSeconds: 1800, with no pricing,
  // and an exact 1800-second session. Rewrite the release's attempt into that older shape, as such a store holds it.
  const sqlite = new BetterSqlite3(databasePath);
  const { cartId, record } = storedAttempt(databasePath);
  const attempt = record.attempts[0];
  const { paymentWindow, pricing, ...rest } = attempt.payment;
  attempt.payment = { ...rest, paymentWindowSeconds: 1800 };
  attempt.session = { ...attempt.session, expiresAt: attempt.session.createdAt + 1800 };
  sqlite.prepare("UPDATE _plugin_storage SET data = ? WHERE plugin_id = ? AND collection = 'checkout_carts' AND id = ?").run(JSON.stringify(record), owner, cartId);
  sqlite.close();

  const state = await upgraded(databasePath);
  t.after(() => state.close());
  // A 1830-second session for this attempt is refused, and nothing is paid.
  state.setTransportOverride(paidAnswerFor({ ...attempt, session: { ...attempt.session, expiresAt: attempt.session.createdAt + 1830 } }));
  await state.plugin.invokeHook('cron', { name: COMMERCE_CHECKOUT_WAKES_TASK });
  const refused = await state.invoke('checkout/guest/status', {}, token);
  assert.notEqual(refused?.checkout?.state, 'paid', JSON.stringify(refused));
  assert.equal((await state.cartRecords())[0].attempts[0].order, undefined);
  t.diagnostic(`1830-second session for the old attempt: state=${refused?.checkout?.state ?? refused?.error?.code}`);
  // The exact 1800-second session it was frozen with settles it.
  state.setTransportOverride(paidAnswerFor(attempt));
  const read = await state.invoke('checkout/guest/status', {}, token);
  assert.equal(read.ok, true, JSON.stringify(read));
  assert.equal(read.checkout.state, 'paid', JSON.stringify(read.checkout));
  assert.equal(read.checkout.order.total.minor, '250');
  t.diagnostic(`exact 1800-second session: state=${read.checkout.state} order=${read.checkout.order.orderId}`);
});
