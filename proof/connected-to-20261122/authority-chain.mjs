// Authority-chain run for the connected-to line and the uninstall cancel.
//
// The built Commerce plugin's own entry points (Connect and its Check, the store-proof
// route, the Commerce settings page load and the plugin:uninstall hook from dist/plugin.js)
// run against DinkusKit.com's own built Worker from dinkuskit/dinkuskit (the branch of
// dinkuskit/dinkuskit#145), under that repository's merchant test harness with local D1
// and KV. Connect, Approve, token, store passes, GET /api/store-connection and
// POST /api/store-keys/cancel are DinkusKit.com's real routes.
//
// Two things stand in for what is not on this machine:
//  1. Transport: the plugin's https://dinkuskit.com requests go to the local Worker, and
//     that Worker's own address is written back as https://dinkuskit.com in replies.
//  2. The store's address: DinkusKit.com reads a waiting Connect's receipt from the
//     plugin's store-proof route at the store's address. Here the receipt is read from the
//     real store-proof route of the installation that owns that address and handed to the
//     Worker's proof-receipt simulation.
//
// Run from this repository after `npm run build`:
//   DINKUSKIT_DIR=/path/to/built/dinkuskit COMMERCE_BASE_DIR=/path/to/built/checkout/of/main \
//   node proof/connected-to-20261122/authority-chain.mjs > proof/connected-to-20261122/authority-chain-trace.md
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DK = process.env.DINKUSKIT_DIR, BASE = process.env.COMMERCE_BASE_DIR;
if (!DK || !BASE) throw new Error('Set DINKUSKIT_DIR and COMMERCE_BASE_DIR.');
const load = async root => ({
  connect: await import(pathToFileURL(`${root}/dist/features/checkout/registry-connect.js`).href),
  settings: await import(pathToFileURL(`${root}/dist/admin/settings.js`).href),
  plugin: (await import(pathToFileURL(`${root}/dist/plugin.js`).href)).default,
});
const here = await load(new URL('../..', import.meta.url).pathname.replace(/\/$/, ''));
const base = await load(BASE);
const rev = dir => execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const harness = await import(pathToFileURL(`${DK}/tests/helpers/merchant-harness.mjs`).href);
process.chdir(DK);

const PROD = 'https://dinkuskit.com';
const lines = [], say = text => lines.push(text);
let runtime;
const redact = value => String(value).replaceAll(runtime?.origin ?? '\u0000', PROD)
  .replace(/dk_store_[A-Za-z0-9_-]{43}/g, 'dk_store_[redacted]')
  .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[pass redacted]')
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>');
const check = (label, ok, seen) => { say(`- ${ok ? 'PASS' : 'FAIL'}: ${label}${seen === undefined ? '' : ` (${redact(typeof seen === 'string' ? seen : JSON.stringify(seen))})`}`); assert.ok(ok, label); };

// The Worker's local D1 file, read directly (read-only) to show which keys remain.
let sqlite;
function d1() {
  if (sqlite) return sqlite;
  const Database = createRequire(`${DK}/package.json`)('better-sqlite3');
  const dir = join(runtime.persistTo, 'v3', 'd1', 'miniflare-D1DatabaseObject');
  for (const file of readdirSync(dir).filter(name => name.endsWith('.sqlite'))) {
    const db = new Database(join(dir, file), { readonly: true, fileMustExist: true });
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'dinkuskit_plugin_key'").get()) return (sqlite = db);
    db.close();
  }
  throw new Error('merchant D1 not found');
}
const keyRows = siteId => d1().prepare('SELECT plugin FROM dinkuskit_plugin_key WHERE site_id = ? ORDER BY plugin').all(siteId).map(r => r.plugin);
const rows = (label, sites) => say(`  - D1 plugin keys ${label}: ${sites.map(([name, id]) => `${name} [${keyRows(id).join(', ') || 'none'}]`).join('; ')}`);

const owners = new Map();
function transport() {
  return { async fetch(url, init = {}) {
    assert.ok(url.startsWith(`${PROD}/`), `unexpected address ${url}`);
    const response = await fetch(new URL(url.slice(PROD.length), runtime.origin), { ...init, redirect: 'manual' });
    const text = (await response.text()).replaceAll(runtime.origin, PROD);
    return new Response(response.status === 204 ? null : text, { status: response.status, headers: response.headers });
  } };
}
// One installed Commerce at a store address, with its own settings and KV.
function install(origin, code = here, store = { settings: new Map(), kv: new Map(), revision: 0 }) {
  const ctx = () => ({
    plugin: { id: 'r_gshdrqaldna3r7sn' }, site: { url: origin }, http: transport(),
    settings: {
      get: async n => store.settings.get(n)?.value ?? null, getVersioned: async n => store.settings.get(n) ?? null,
      compareAndSet: async (n, expected, value) => {
        if ((store.settings.get(n)?.revision ?? null) !== expected) return { applied: false };
        store.settings.set(n, { value, revision: String(++store.revision) }); return { applied: true };
      },
    },
    kv: { get: async k => store.kv.get(k) ?? null, set: async (k, v) => { store.kv.set(k, v); }, delete: async k => store.kv.delete(k) },
    storage: new Proxy({}, { get: () => new Proxy({}, { get: (_, op) => async () => op === 'query' ? { items: [] } : null }) }),
  });
  const self = {
    origin, store, ctx,
    proof: connectionId => code.connect.storeProof({ connection_id: connectionId }, ctx()),
    start: () => code.connect.startConnect(ctx()),
    check: () => code.connect.connectState(ctx(), true),
    key: () => code.connect.storeKey(ctx()),
    line: async () => {
      const page = await code.settings.settingsAdmin({ ui: { surface: 'admin-page' }, user: { id: 'admin', role: 50 }, input: { type: 'page_load', page: '/settings' } }, ctx());
      return page.blocks.filter(b => b.type === 'context' && /^Connected to/.test(b.text)).map(b => b.text).join(' ');
    },
    uninstall: () => code.plugin.hooks['plugin:uninstall']({}, ctx()),
    as: other => install(origin, other, store),
  };
  owners.set(origin, self);
  return self;
}
async function bridge(connectionId, origin) {
  const answer = await owners.get(origin).proof(connectionId);
  if (answer.status !== 200) return false;
  return (await harness.request(runtime, new Map(), '/__proof/receipt', { method: 'POST', body: answer.body.value })).status === 200;
}

try {
  runtime = await harness.startMerchantTestRuntime();
  const form = async (jar, fields) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: await harness.accountForm(runtime, jar, new URLSearchParams(fields).toString()) });
  const business = async (email, name) => {
    const jar = new Map(); await harness.signup(runtime, email, jar);
    assert.equal((await harness.request(runtime, jar, '/api/account/organizations', await form(jar, { action: 'rename', name }))).status, 303);
    return jar;
  };
  const acmeOwner = await business('acme-owner@example.test', 'Acme Goods');
  const otherOwner = await business('other-owner@example.test', 'Other Shop');
  const approve = async (jar, link, origin) => {
    const id = new URL(link).searchParams.get('connection_id');
    assert.ok(await bridge(id, origin), 'the store answers at its address');
    const answer = await harness.request(runtime, jar, `/account/connect?connection_id=${id}`, await form(jar, { action: 'approve' }));
    assert.equal(answer.status, 303);
  };
  // Commerce's own Connect: press Connect, the owner approves, then Check.
  async function connect(store, jar) {
    const pending = await store.start();
    assert.equal(pending.state, 'pending');
    await approve(jar, pending.uri.replace(PROD, runtime.origin), store.origin);
    const done = await store.check();
    assert.equal(done.state, 'connected');
    return done;
  }
  // Payments joins with its owner's Approve (Payments is not under test here).
  async function connectPayments(origin, jar) {
    const verifier = randomBytes(32).toString('base64url'), challenge = createHash('sha256').update(verifier).digest('base64url');
    const callback = `${origin}/_emdash/admin/plugins/r_3brsc2on3bu673rn/status`;
    const started = await (await harness.request(runtime, new Map(), '/api/store-connections', { method: 'POST', body: JSON.stringify({ protocol_version: 2,
      client_id: 'dinkus-payments-emdash', service: 'payments', site_origin: origin, callback_uri: callback, code_challenge: challenge, code_challenge_method: 'S256' }) })).json();
    await harness.request(runtime, new Map(), '/__proof/receipt', { method: 'POST', body: JSON.stringify({ version: 2, connection_id: started.connection_id,
      challenge: started.challenge, client_id: 'dinkus-payments-emdash', service: 'payments', site_id: started.site_id, site_origin: origin, callback_uri: callback,
      code_challenge: challenge, expires_at: started.expires_at }) });
    await harness.request(runtime, jar, `/account/connect?connection_id=${started.connection_id}`, await form(jar, { action: 'approve' }));
    return (await (await harness.request(runtime, new Map(), '/api/store-connections/token', { method: 'POST',
      body: JSON.stringify({ client_id: 'dinkus-payments-emdash', connection_id: started.connection_id, code_verifier: verifier }) })).json()).store_key;
  }
  // One recorded request to DinkusKit.com's Worker, redacted, with its answer.
  const call = async (path, init = {}, jar = new Map()) => {
    const response = await harness.request(runtime, jar, path, init);
    const text = response.status === 303 ? '' : await response.text();
    const auth = init.headers?.authorization ? ` (Bearer ${redact(init.headers.authorization.slice(7))})` : ' (no Authorization)';
    say(`  - ${init.method ?? 'GET'} ${path}${auth}${typeof init.body === 'string' && init.body.startsWith('{') ? ` ${redact(init.body)}` : ''} → ${response.status}${text ? ` ${redact(text)}` : ''}`);
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const cancelCall = (bearer, siteId) => call('/api/store-keys/cancel', { method: 'POST', headers: bearer ? { authorization: `Bearer ${bearer}` } : {}, body: JSON.stringify({ site_id: siteId }) });
  const readCall = pass => call('/api/store-connection', { headers: { authorization: `Bearer ${pass}` } });
  const passFor = async (key, siteId) => (await (await harness.request(runtime, new Map(), '/api/store-passes', { method: 'POST', headers: { authorization: `Bearer ${key}` },
    body: JSON.stringify({ site_id: siteId, scope: 'store:connection', audience: 'dinkuskit' }) })).json()).access_token;
  const trade = async (key, siteId, scope, audience) => {
    const r = await harness.request(runtime, new Map(), '/api/store-passes', { method: 'POST', headers: { authorization: `Bearer ${key}` },
      body: JSON.stringify({ site_id: siteId, scope, audience }) });
    return r.status === 200 ? 200 : (await r.json()).error;
  };

  say('# Commerce authority chain: connected-to line and uninstall cancel');
  say('');
  say(`Commerce ${rev(new URL('../..', import.meta.url).pathname)} (built), Commerce main ${rev(BASE)} for the upgrade, DinkusKit.com Worker from ${rev(DK)} under its merchant harness with local D1 and KV. Keys are redacted and ids replaced with <id>.`);
  say('');
  say('## 1. Connected-to line');
  const acme = install('https://acme-goods.example');
  const acmeConnected = await connect(acme, acmeOwner);
  check('Commerce connects with its own Connect and the owner\'s Approve', acmeConnected.state === 'connected');
  check('before Payments joins, the line names the business and Commerce', /Connected to Acme Goods on DinkusKit, store .*DinkusKit plugins on this store: Commerce\./.test(await acme.line()), await acme.line());
  const paymentsKey = await connectPayments(acme.origin, acmeOwner);
  check('after Payments joins, the line names both plugins', /DinkusKit plugins on this store: Commerce and Payments\./.test(await acme.line()), await acme.line());
  const other = install('https://other-shop.example');
  await connect(other, otherOwner);
  check('another business\'s store shows its own business and plugins', /Connected to Other Shop on DinkusKit, store .*plugins on this store: Commerce\./.test(await other.line()), await other.line());
  const acmeKey = (await acme.key()).key, otherKey = (await other.key()).key, otherSite = (await other.key()).siteId;
  check("Acme's Commerce key cannot get a store:connection pass for the other store", (await trade(acmeKey, otherSite, 'store:connection', 'dinkuskit')) !== 200,
    await trade(acmeKey, otherSite, 'store:connection', 'dinkuskit'));
  say('');
  say('## 2. A cancel for another store, or without a key, cancels nothing');
  const acmeSite = acmeConnected.siteId;
  rows('before', [['Acme', acmeSite], ['Other Shop', otherSite]]);
  check("Acme's Commerce key cannot cancel at the other store", (await cancelCall(acmeKey, otherSite)).body?.error === 'site_mismatch');
  check("the other store's Commerce key cannot cancel at Acme", (await cancelCall(otherKey, acmeSite)).body?.error === 'site_mismatch');
  const acmePassBefore = await passFor(acmeKey, acmeSite), paymentsPassBefore = await passFor(paymentsKey, acmeSite);
  check('a store:connection pass is not a key and cancels nothing', (await cancelCall(acmePassBefore, acmeSite)).body?.error === 'invalid_store_key');
  check('no key cancels nothing', (await cancelCall(null, acmeSite)).body?.error === 'invalid_store_key');
  rows('after the refused cancels', [['Acme', acmeSite], ['Other Shop', otherSite]]);
  check('every key is still there', keyRows(acmeSite).join() === 'commerce,payments' && keyRows(otherSite).join() === 'commerce');
  check("and Acme's and the other store's Commerce keys still trade", (await trade(acmeKey, acmeSite, 'commerce:settings', 'dinkuskit')) === 200 && (await trade(otherKey, otherSite, 'commerce:settings', 'dinkuskit')) === 200);
  say('');
  say('## 3. Uninstall cancels only Commerce\'s key');
  check("before the uninstall, Acme's Commerce pass reads the store", (await readCall(acmePassBefore)).status === 200);
  await acme.uninstall();
  rows('after the uninstall', [['Acme', acmeSite], ['Other Shop', otherSite]]);
  check("Acme's Commerce key no longer trades any pass", (await trade(acmeKey, acmeConnected.siteId, 'commerce:settings', 'dinkuskit')) === 'invalid_store_key',
    await trade(acmeKey, acmeConnected.siteId, 'commerce:settings', 'dinkuskit'));
  check("Acme's Payments key still trades its checkout pass", (await trade(paymentsKey, acmeConnected.siteId, 'payments:checkout', 'dinkus-payments')) === 200);
  check("the other store's Commerce key still works", (await trade(otherKey, otherSite, 'store:connection', 'dinkuskit')) === 200);
  check('a page load with the cancelled key leaves the line at the Store ID alone', /^Connected to DinkusKit\.com, store /.test(await acme.line()), await acme.line());
  check("the store:connection pass Commerce got before the uninstall reads nothing after it", (await readCall(acmePassBefore)).body?.error === 'invalid_pass');
  const paymentsRead = await readCall(paymentsPassBefore);
  check("Payments' pass from before still reads, and no longer lists Commerce", paymentsRead.status === 200 && paymentsRead.body.plugins.join() === 'payments');
  say('');
  say('## 4. A reinstall connects again');
  const again = install(acme.origin);
  const reconnected = await connect(again, acmeOwner);
  check('the reinstalled Commerce connects to the same store', reconnected.siteId === acmeConnected.siteId, reconnected.siteId === acmeConnected.siteId ? 'same Store ID' : 'other Store ID');
  check('and its line names Commerce and Payments again', /plugins on this store: Commerce and Payments\./.test(await again.line()), await again.line());
  say('');
  say('## 5. Upgrade from Commerce main');
  const old = install('https://upgrade-shop.example', base);
  await connect(old, await business('upgrade-owner@example.test', 'Upgrade Shop'));
  const before = old.store.settings.get('connection').value;
  check('a store connected with Commerce main shows only the Store ID there', /^$/.test(await old.line()) || /^Connected to DinkusKit\.com, store /.test(await old.line()), await old.line() || '(no line)');
  const upgraded = old.as(here);
  check('after the upgrade, the same saved connection shows the line', /Connected to Upgrade Shop on DinkusKit/.test(await upgraded.line()), await upgraded.line());
  check('the saved connection is unchanged by the upgrade and the page load', upgraded.store.settings.get('connection').value === before);
  await upgraded.uninstall();
  check("its uninstall cancels the key saved by Commerce main", (await trade(JSON.parse(before).storeKey, JSON.parse(before).siteId, 'commerce:settings', 'dinkuskit')) === 'invalid_store_key');
  say('');
  say('## 6. An owner\'s Disconnect stops a pass issued before it');
  const commerceKey = (await again.key()).key;
  const commercePass = await passFor(commerceKey, acmeSite), paymentsPass = await passFor(paymentsKey, acmeSite);
  check("before the Disconnect, Payments' pass reads the store", (await readCall(paymentsPass)).status === 200);
  const disconnected = await harness.request(runtime, acmeOwner, '/account/sites', await form(acmeOwner, { action: 'disconnect_plugin', site_id: acmeSite, plugin: 'payments' }));
  say(`  - the owner presses Disconnect for Payments under Your stores → ${disconnected.status}`);
  rows('after the Disconnect', [['Acme', acmeSite]]);
  check("the Payments pass issued before the Disconnect reads nothing after it", (await readCall(paymentsPass)).body?.error === 'invalid_pass');
  const commerceRead = await readCall(commercePass);
  check("Commerce's pass still reads, listing only Commerce", commerceRead.status === 200 && commerceRead.body.plugins.join() === 'commerce');
  check('and the line names only Commerce', /plugins on this store: Commerce\./.test(await again.line()), await again.line());
  say('');
  say(`${lines.filter(l => l.startsWith('- PASS')).length} checks passed.`);
} finally {
  sqlite?.close();
  if (runtime) await harness.stopRuntime(runtime);
  process.stdout.write(`${lines.join('\n')}\n`);
}
