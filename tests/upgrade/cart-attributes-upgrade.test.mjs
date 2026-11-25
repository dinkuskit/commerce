// An upgrade proof for cart attributes (commerce-cart-attributes-order-paid-20261123), run like its neighbour:
//   npm run build && COMMERCE_UPGRADE_FROM_SANDBOX=<v0.8.0 checkout>/dist/sandbox node --test tests/upgrade/*.test.mjs
// Commerce 0.8.0's own compiled runtime starts a checkout; this checkout's compiled runtime then opens the same
// database. Records written before attributes existed have none and keep working, beside a new cart that carries them.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import BetterSqlite3 from 'better-sqlite3';
import { COMMERCE_REGISTRY_RUNTIME_ID } from '../../dist/features/checkout/index.js';
import { runtimeFixture, SITE } from '../features/checkout/registry-runtime.mjs';

const from = process.env.COMMERCE_UPGRADE_FROM_SANDBOX;
const owner = COMMERCE_REGISTRY_RUNTIME_ID;
const contact = { email: 'shopper@example.test', billing: { name: 'Bill Payer', line1: '9 Billing Way', city: 'Billtown', postalCode: '00009', country: 'US' } };
const lines = [{ catalogItemId: 'hat', quantity: 1 }];
const json = (value) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });

/** One route of a compiled runtime, as the store's own page calls it. */
const call = (state, route, input, capability) => state.plugin.invokeRoute(route, input, {
  url: `${SITE}/_emdash/api/plugins/${owner}/${route}`, method: 'POST',
  headers: { origin: SITE, 'sec-fetch-site': 'same-origin', ...(capability ? { 'x-commerce-guest-capability': capability } : {}) },
});

function stored(databasePath, collection) {
  const sqlite = new BetterSqlite3(databasePath);
  try {
    return sqlite.prepare('SELECT id, data FROM _plugin_storage WHERE plugin_id = ? AND collection = ?').all(owner, collection)
      .map(row => ({ id: row.id, record: JSON.parse(row.data) }));
  } finally { sqlite.close(); }
}

test('a cart key, checkout and paid order from 0.8.0 keep working with no attributes, beside a new cart that carries them', { skip: !from && 'set COMMERCE_UPGRADE_FROM_SANDBOX' }, async (t) => {
  const directory = await mkdtemp('/tmp/commerce-upgrade-attributes-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'store.db');

  // On 0.8.0: a shopper reaches the payment page. 0.8.0 has no server cart, so its start takes the lines.
  const release = await runtimeFixture({ databasePath,
    artifactManifest: JSON.parse(await readFile(join(from, 'manifest.json'), 'utf8')),
    backendSource: await readFile(join(from, 'plugin.mjs'), 'utf8') });
  let token, settings;
  try {
    const prepared = await call(release, 'checkout/guest/prepare', {});
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    token = prepared.capability.capability;
    const started = await call(release, 'checkout/guest/start', { contact, lines }, token);
    assert.equal(started.ok, true, JSON.stringify(started));
    settings = await release.settings.get('installedCheckout');
  } finally { await release.close(); }
  const [{ id: oldCartId, record: oldRecord }] = stored(databasePath, 'checkout_carts');
  const attempt = oldRecord.attempts[0];
  assert.equal('attributes' in oldRecord, false);
  assert.equal('attributes' in attempt, false);
  t.diagnostic(`0.8.0 wrote cart ${oldCartId}: attempt ${attempt.attemptId} phase=${attempt.phase}, no attributes on the record or the attempt`);

  // On this build, same database: the setting is as 0.8.0 left it and the shopper's key still reads the checkout.
  const state = await runtimeFixture({ databasePath, seed: false, config: null });
  t.after(() => state.close());
  assert.equal(await state.settings.get('installedCheckout'), settings, 'the saved checkout setting is unchanged');
  // Payments still holds the session 0.8.0 opened: unpaid at first, paid below.
  let outcome = 'open';
  state.setTransportOverride(async (path, init) => {
    if (path.endsWith('-binding') || path.startsWith('/v1/checkout/wakes')) return undefined;
    const request = JSON.parse(new TextDecoder().decode(init.body));
    return json({ outcome, attemptId: request.attemptId, total: attempt.payment.total, session: attempt.session, ...(outcome === 'paid' ? { paymentId: 'pi_upgrade' } : {}) });
  });
  const read = await call(state, 'checkout/guest/cart', {}, token);
  assert.equal(read.ok, true, JSON.stringify(read));
  assert.equal(read.checkout.attemptId, attempt.attemptId);
  assert.equal('attributes' in read.cart, false);
  // Its open checkout is frozen as before: attributes cannot be added to it now.
  const late = await call(state, 'checkout/guest/cart', { lines, version: read.cart.version, attributes: { account_id: 'acct_late' } }, token);
  assert.equal(late.error?.code, 'CHECKOUT_FROZEN', JSON.stringify(late));
  t.diagnostic(`after upgrade: the 0.8.0 key reads attempt ${read.checkout.attemptId}; adding attributes to its open checkout answers ${late.error.code}`);

  // Payments answers paid for the session 0.8.0 saved: the order is made, with no attributes.
  outcome = 'paid';
  const paid = await call(state, 'checkout/guest/cart', {}, token);
  assert.equal(paid.checkout?.state, 'paid', JSON.stringify(paid));
  const paidAttempt = stored(databasePath, 'checkout_carts').find(row => row.id === oldCartId).record.attempts[0];
  assert.equal(paidAttempt.order.orderId, paid.checkout.order.orderId);
  assert.equal('attributes' in paidAttempt.order, false);
  const [order] = stored(databasePath, 'orders');
  assert.equal(order.record.paidOrder.orderId, paid.checkout.order.orderId);
  assert.equal('attributes' in order.record.paidOrder, false);
  t.diagnostic(`paid after upgrade: ${order.record.paidOrder.orderId} total=${order.record.paidOrder.total.minor}, kept by Orders with no attributes`);

  // A new shopper on this build, in the same database: the cart carries attributes and checkout freezes them.
  state.setTransportOverride(null);
  const prepared = await call(state, 'checkout/guest/prepare', {});
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const fresh = prepared.capability.capability;
  const attributes = { account_id: 'acct_42', 'credit.sku': 'compute-100' };
  const saved = await call(state, 'checkout/guest/cart', { lines, version: null, attributes }, fresh);
  assert.deepEqual(saved.cart?.attributes, attributes, JSON.stringify(saved));
  const started = await call(state, 'checkout/guest/start', { contact }, fresh);
  assert.equal(started.ok, true, JSON.stringify(started));
  const carts = stored(databasePath, 'checkout_carts');
  assert.equal(carts.length, 2);
  const newest = carts.find(row => row.id !== oldCartId).record;
  assert.deepEqual(newest.attributes, attributes);
  assert.deepEqual(newest.attempts[0].attributes, attributes);
  assert.equal('attributes' in carts.find(row => row.id === oldCartId).record, false, 'the 0.8.0 cart is untouched');
  t.diagnostic(`new cart on this build: attributes ${JSON.stringify(newest.attempts[0].attributes)} frozen on attempt ${newest.attempts[0].attemptId}; carts in the database: ${carts.length}`);
});
