import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginStorageRepository } from 'emdash';
import {
  CHECKOUT_READINESS_SCHEMA,
  COMMERCE_REGISTRY_RUNTIME_ID,
  REGISTRY_CHECKOUT_CONFIG_SCHEMA,
} from '../../dist/features/checkout/index.js';
import {
  authorizeNetConfiguration,
  configuration,
  credential,
  runtimeFixture,
  SITE,
  STORE_KEY,
  connectionFor,
} from '../features/checkout/registry-runtime.mjs';

const READINESS_ROUTE = 'checkout/guest/readiness';
const SUPPORTED_TEST = {
  schema: CHECKOUT_READINESS_SCHEMA,
  status: 'supported',
  mode: 'test',
};
const UNAVAILABLE = {
  schema: CHECKOUT_READINESS_SCHEMA,
  status: 'unavailable',
};

const seedReadiness = async (state, data) => state.collections.checkout_readiness.put('readiness', data);
const readinessRecord = async (state) => await state.collections.checkout_readiness.get('readiness');

test('readiness: positive stripe test returns supported test and trades key once', async t => {
  const state = await runtimeFixture({ config: configuration() });
  t.after(() => state.close());

  const res = await state.invokeReadiness();
  assert.deepEqual(res, SUPPORTED_TEST);
  assert.equal(state.counts.trades, 1, 'traded store key exactly once for payments:checkout pass');
  assert.equal(state.counts.transport, 1, 'contacted payments transport exactly once to verify binding');

  // Closed response exposes NO secret keys, tokens, settings, account IDs, or binding IDs
  for (const forbidden of [STORE_KEY, 'synthetic-binding', 'acct_synthetic', 'synthetic-site', 'payments:checkout']) {
    const json = JSON.stringify(res);
    assert.equal(json.includes(forbidden), false, `readiness response must not leak ${forbidden}`);
  }
});

test('readiness: positive authorize_net test returns supported test', async t => {
  const state = await runtimeFixture({ config: authorizeNetConfiguration() });
  t.after(() => state.close());

  const res = await state.invokeReadiness();
  assert.deepEqual(res, SUPPORTED_TEST);
  assert.equal(state.counts.trades, 1);
  assert.equal(state.counts.transport, 1);
});

test('readiness: leaves checkout carts, capabilities, and orders untouched, writing only dedicated cache metadata', async t => {
  const state = await runtimeFixture({ config: configuration() });
  t.after(() => state.close());

  const cartsBefore = await state.collections.checkout_carts.query();
  const capsBefore = await state.collections.checkout_guest_capabilities.query();
  const ordersBefore = await state.collections.orders.query();
  const readinessBefore = await state.collections.checkout_readiness.query();

  assert.equal(readinessBefore.items.length, 0);

  const res = await state.invokeReadiness();
  assert.deepEqual(res, SUPPORTED_TEST);

  const cartsAfter = await state.collections.checkout_carts.query();
  const capsAfter = await state.collections.checkout_guest_capabilities.query();
  const ordersAfter = await state.collections.orders.query();
  const readinessAfter = await state.collections.checkout_readiness.query();

  assert.equal(cartsAfter.items.length, 0);
  assert.equal(capsAfter.items.length, 0);
  assert.equal(ordersAfter.items.length, 0);
  assert.deepEqual(cartsBefore, cartsAfter);
  assert.deepEqual(capsBefore, capsAfter);
  assert.deepEqual(ordersBefore, ordersAfter);

  assert.equal(readinessAfter.items.length, 1);
  const cached = readinessAfter.items[0].data;
  assert.equal(cached.status, 'supported');
  assert.deepEqual(Object.keys(cached).sort(), ['attempts', 'expiresAt', 'generation', 'lastAttemptAt', 'status', 'version']);
  assert.equal(cached.version, 1);
  assert.ok(typeof cached.generation === 'string');
  assert.ok(typeof cached.expiresAt === 'number');
  assert.ok(Array.isArray(cached.attempts));
  assert.equal(cached.attempts.length, 1);
  // Ensure no secrets leaked in cache record
  for (const forbidden of [STORE_KEY, 'token', 'access_token', 'storeKey', 'synthetic-binding', 'acct_synthetic']) {
    assert.equal(cached[forbidden], undefined);
  }
});

test('readiness: missing config returns unavailable without trade', async t => {
  const state = await runtimeFixture({ config: null });
  t.after(() => state.close());

  assert.equal((await state.invoke('checkout/guest/prepare')).ok, true,
    'successful prepare is not evidence of configured Payments');

  const res = await state.invokeReadiness();
  assert.deepEqual(res, UNAVAILABLE);
  assert.equal(state.counts.trades, 0, 'no trade when config is disabled');
});

test('readiness: foreign and native-alias namespaces cannot attest the Registry catalog', async () => {
  for (const owner of ['foreign_commerce', 'dinkus-commerce']) {
    const state = await runtimeFixture({ owner });
    try {
      assert.deepEqual(await state.invokeReadiness(), UNAVAILABLE);
      assert.equal(state.counts.trades, 0);
    } finally { await state.close(); }
  }
});

test('readiness: mismatched configured origin fails closed', async () => {
  for (const options of [
    { config: { ...configuration(), commerceOrigin: 'foreign.example.test' } },
    { config: { ...configuration(), commerceOrigin: 'http://shop.example.test' } },
    { config: { ...configuration(), commerceOrigin: 'https://shop.example.test:8443' } },
    { config: { ...configuration(), commerceOrigin: 'https://foreign.example.test' } },
  ]) {
    const state = await runtimeFixture(options);
    try {
      assert.deepEqual(await state.invokeReadiness(), UNAVAILABLE);
      assert.equal(state.counts.trades, 0);
    } finally { await state.close(); }
  }
});

test('readiness: successful Payments wire binding needs no ready property', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  const config = configuration();
  state.setTransportOverride((path) => {
    assert.equal(path, '/v1/checkout-binding');
    return Response.json({
      bindingRef: config.bindingRef, providerId: config.providerId,
      stripeAccountId: config.stripeAccountId, mode: 'test',
    });
  });
  assert.deepEqual(await state.invokeReadiness(), SUPPORTED_TEST);
  assert.equal(state.counts.trades, 1);
  assert.equal(state.counts.transport, 1);
});

test('readiness: failed or mismatched wire bindings remain unavailable', async () => {
  const valid = {
    bindingRef: 'synthetic-binding', providerId: 'stripe',
    stripeAccountId: 'acct_synthetic', mode: 'test',
  };
  const cases = [
    [401, valid], [409, valid], [503, valid], [200, null], [200, {}],
    [200, { ...valid, bindingRef: 'foreign-binding' }],
    [200, { ...valid, providerId: 'authorize_net' }],
    [200, { ...valid, stripeAccountId: 'acct_other' }],
    [200, { ...valid, mode: 'live' }],
    [200, { ...valid, ready: false }], [200, { ...valid, ready: 'true' }],
  ];
  for (const [status, body] of cases) {
    const state = await runtimeFixture();
    try {
      state.setTransportOverride(path => {
        assert.equal(path, '/v1/checkout-binding');
        return Response.json(body, { status });
      });
      assert.deepEqual(await state.invokeReadiness(), UNAVAILABLE, JSON.stringify({ status, body }));
      assert.equal(state.counts.trades, 1);
      assert.equal(state.counts.transport, 1);
    } finally { await state.close(); }
  }
});

test('readiness: pending status revalidates binding after a supported read', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  assert.deepEqual(await state.invokeReadiness(), SUPPORTED_TEST);
  const prepared = await state.invoke('checkout/guest/prepare');
  const token = prepared.capability.capability;
  const started = await state.invoke('checkout/guest/start', {
    contact: { email: 'shopper@example.test' }, lines: [{ catalogItemId: 'hat', quantity: 1 }],
  }, token);
  assert.equal(started.checkout.state, 'pending');
  state.setPaid();
  state.setBindingMode('live');
  const status = await state.invoke('checkout/guest/status', {}, token);
  assert.notEqual(status.checkout?.state, 'paid');
  assert.equal((await state.collections.orders.query()).items.length, 0);
  state.setBindingMode('test');
  const paid = await state.invoke('checkout/guest/status', {}, token);
  assert.equal(paid.checkout.state, 'paid');
  const replay = await state.invoke('checkout/guest/status', {}, token);
  assert.deepEqual(replay.checkout.order, paid.checkout.order);
  assert.equal((await state.collections.orders.query()).items.length, 1);
});

test('readiness: disabled config returns unavailable without trade', async t => {
  const state = await runtimeFixture({
    config: { schema: REGISTRY_CHECKOUT_CONFIG_SCHEMA, enabled: false },
  });
  t.after(() => state.close());

  const res = await state.invokeReadiness();
  assert.deepEqual(res, UNAVAILABLE);
  assert.equal(state.counts.trades, 0, 'no trade when config is disabled');
});

test('readiness: malformed config returns unavailable', async t => {
  const malformed = configuration();
  delete malformed.siteId;
  const state = await runtimeFixture({ config: malformed });
  t.after(() => state.close());

  const res = await state.invokeReadiness();
  assert.deepEqual(res, UNAVAILABLE);
});

test('readiness: missing store key returns unavailable without trade', async t => {
  const state = await runtimeFixture({ storeKey: null });
  t.after(() => state.close());

  const res = await state.invokeReadiness();
  assert.deepEqual(res, UNAVAILABLE);
  assert.equal(state.counts.trades, 0);
});

test('readiness: refused store key trade returns unavailable with no transport call', async t => {
  const state = await runtimeFixture({ storeKey: 'dk_store_' + 'i'.repeat(43) });
  t.after(() => state.close());
  state.acceptStoreKey('dk_store_' + 'o'.repeat(43));

  const res = await state.invokeReadiness();
  assert.deepEqual(res, UNAVAILABLE);
  assert.equal(state.counts.trades, 1);
  assert.equal(state.counts.transport, 0, 'no transport call when trade was refused');
});

test('readiness: refused service scope returns unavailable', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  state.setPass('payments:checkout', null);

  const res = await state.invokeReadiness();
  assert.deepEqual(res, UNAVAILABLE);
});

test('readiness: expired pass from trade returns unavailable', async t => {
  const expiredPass = await credential({ exp: Math.floor(Date.now() / 1000) - 60 });
  const state = await runtimeFixture({ token: expiredPass });
  t.after(() => state.close());

  const res = await state.invokeReadiness();
  assert.deepEqual(res, UNAVAILABLE);
});

test('readiness: config mode live returns unavailable', async t => {
  const liveConfig = { ...configuration(), mode: 'live' };
  const state = await runtimeFixture({ config: liveConfig });
  t.after(() => state.close());

  const res = await state.invokeReadiness();
  assert.deepEqual(res, UNAVAILABLE, 'live mode is not supported for positive readiness');
  assert.equal(state.counts.trades, 0);
  assert.equal(state.counts.transport, 0);
});

test('readiness: binding mode live when store is test returns unavailable', async t => {
  const state = await runtimeFixture({ bindingMode: 'live' });
  t.after(() => state.close());

  const res = await state.invokeReadiness();
  assert.deepEqual(res, UNAVAILABLE);
});

test('readiness: binding not ready returns unavailable', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  state.setTransportOverride((path) => {
    if (path.endsWith('-binding')) {
      return Response.json({
        bindingRef: 'synthetic-binding',
        providerId: 'stripe',
        stripeAccountId: 'acct_synthetic',
        mode: 'test',
        ready: false,
      });
    }
  });

  const res = await state.invokeReadiness();
  assert.deepEqual(res, UNAVAILABLE);
});

test('readiness: binding mismatch returns unavailable', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  state.setTransportOverride((path) => {
    if (path.endsWith('-binding')) {
      return Response.json({
        bindingRef: 'foreign-binding',
        providerId: 'stripe',
        stripeAccountId: 'acct_synthetic',
        mode: 'test',
        ready: true,
      });
    }
  });

  const res = await state.invokeReadiness();
  assert.deepEqual(res, UNAVAILABLE);
});

test('readiness: request URL origin mismatch returns unavailable', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());

  const res = await state.invokeReadiness({
    url: `https://foreign.example.test/_emdash/api/plugins/${COMMERCE_REGISTRY_RUNTIME_ID}/${READINESS_ROUTE}`,
  });
  assert.deepEqual(res, UNAVAILABLE);
});

test('readiness: origin header mismatch returns unavailable', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());

  const res = await state.invokeReadiness({
    headers: { origin: 'https://foreign.example.test' },
  });
  assert.deepEqual(res, UNAVAILABLE);
});

test('readiness: transport error returns unavailable', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  state.setTransportOverride((path) => {
    if (path.endsWith('-binding')) {
      return Response.json({ error: 'internal_error' }, { status: 500 });
    }
  });

  const res = await state.invokeReadiness();
  assert.deepEqual(res, UNAVAILABLE);
});

test('readiness is advisory: subsequent start independently revalidates binding', async t => {
  const state = await runtimeFixture({ config: configuration() });
  t.after(() => state.close());

  // 1. Initial readiness reports supported
  const readyBefore = await state.invokeReadiness();
  assert.deepEqual(readyBefore, SUPPORTED_TEST);

  // 2. Prepare checkout
  const prepared = await state.invoke('checkout/guest/prepare');
  assert.equal(prepared.ok, true);
  const token = prepared.capability.capability;

  // 3. Now make binding unready in Payments
  state.setTransportOverride((path) => {
    if (path.endsWith('-binding')) {
      return Response.json({
        bindingRef: 'synthetic-binding',
        providerId: 'stripe',
        stripeAccountId: 'acct_synthetic',
        mode: 'test',
        ready: false,
      });
    }
  });

  // 4. Start must independently revalidate and fail session creation
  const started = await state.invoke(
    'checkout/guest/start',
    { contact: { email: 'shopper@example.test' }, lines: [{ catalogItemId: 'hat', quantity: 1 }] },
    token,
  );
  assert.equal(started.ok, true);
  assert.equal(started.checkout.state, 'recoverable-failure');
  assert.equal(started.checkout.unavailable.code, 'PAYMENTS_UNAVAILABLE');

  // 5. Readiness is strictly advisory: while still within the 15-minute TTL, it serves
  // the cached supported advisory result, even though genuine start failed against upstream.
  const readyCached = await state.invokeReadiness();
  assert.deepEqual(readyCached, SUPPORTED_TEST);

  // 6. After the cache record expires (or is invalidated after 60s floor), the refreshed
  // readiness check hits upstream, encounters the unready binding, and returns unavailable.
  const record = await readinessRecord(state);
  const now = Math.floor(Date.now() / 1000);
  await seedReadiness(state, {
    ...record,
    expiresAt: now - 1,
    lastAttemptAt: now - 901,
    attempts: [now - 901],
  });
  const readyAfter = await state.invokeReadiness();
  assert.deepEqual(readyAfter, UNAVAILABLE);
});

test('readiness: concurrent independent invocations share one refresh and query variations cannot bypass cache', async t => {
  const state = await runtimeFixture({ config: configuration() });
  t.after(() => state.close());

  // 1. Initial burst: multiple concurrent contenders
  const burst1 = await Promise.all([
    state.invokeReadiness(),
    state.invokeReadiness(),
    state.invokeReadiness(),
  ]);
  // Exactly one winner refreshed and traded
  assert.equal(state.counts.trades, 1, 'only one contender traded');
  // At least the winner returned supported
  assert.ok(burst1.some(res => res.status === 'supported'));

  // 2. Query variations burst on unexpired cache: all return supported without any new trade
  const urls = [
    undefined,
    `${SITE}/_emdash/api/plugins/dinkus-commerce/checkout/guest/readiness?v=1`,
    `${SITE}/_emdash/api/plugins/dinkus-commerce/checkout/guest/readiness?v=2`,
    `${SITE}/_emdash/api/plugins/dinkus-commerce/checkout/guest/readiness?ref=promo`,
    `${SITE}/_emdash/api/plugins/dinkus-commerce/checkout/guest/readiness?session=new`,
    `${SITE}/_emdash/api/plugins/dinkus-commerce/checkout/guest/readiness?cache=bust`,
  ];
  const burst2 = await Promise.all(urls.map(url => state.invokeReadiness(url ? { url } : {})));
  for (const res of burst2) {
    assert.deepEqual(res, SUPPORTED_TEST);
  }
  assert.equal(state.counts.trades, 1, 'query variations did not trigger additional trades');
  assert.equal(state.counts.transport, 1, 'query variations did not trigger additional transport calls');
});

test('readiness: failure backoff caches unavailable for 15 minutes', async t => {
  const state = await runtimeFixture({ config: configuration() });
  t.after(() => state.close());

  // Override transport to return 500 error
  state.setTransportOverride(() => new Response('Internal error', { status: 500 }));

  const res1 = await state.invokeReadiness();
  assert.deepEqual(res1, UNAVAILABLE);
  assert.equal(state.counts.trades, 1, 'initial failure traded key');

  // Second call within 15 minutes failure cooldown returns unavailable immediately without trade
  const res2 = await state.invokeReadiness();
  assert.deepEqual(res2, UNAVAILABLE);
  assert.equal(state.counts.trades, 1, 'cooldown prevented upstream retry');

  // Verify cached cooldown record
  const record = await readinessRecord(state);
  assert.equal(record.status, 'unavailable');
  assert.ok(record.expiresAt > Math.floor(Date.now() / 1000));
});

test('readiness: inconsistent expiry fails closed without resetting quota', async t => {
  const state = await runtimeFixture({ config: configuration() });
  t.after(() => state.close());

  // Initial successful read
  await state.invokeReadiness();
  assert.equal(state.counts.trades, 1);

  // Seed expired result where lastAttemptAt is only 10s ago (within 60s floor)
  const now = Math.floor(Date.now() / 1000);
  const record = await readinessRecord(state);
  await seedReadiness(state, {
    ...record,
    expiresAt: now - 1, // expired
    lastAttemptAt: now - 10, // 60s floor not reached
  });

  // Must fail closed to unavailable rather than returning stale supported
  const res = await state.invokeReadiness();
  assert.deepEqual(res, UNAVAILABLE);
  assert.equal(state.counts.trades, 1, '60s floor prevented refresh attempt');
});

test('readiness: owner configuration/key change invalidates cache immediately without resetting rolling budget', async t => {
  const state = await runtimeFixture({ config: configuration() });
  t.after(() => state.close());

  // Initial read caches supported
  await state.invokeReadiness();
  assert.equal(state.counts.trades, 1);
  const recordBefore = await readinessRecord(state);
  assert.equal(recordBefore.attempts.length, 1);

  // Update owner configuration (e.g. shipping policy configurationId and revision)
  const newConfig = configuration({ configurationId: 'shipping-updated', revision: 2, mode: 'free' });
  await state.settings.set('installedCheckout', JSON.stringify(newConfig));

  // Immediate read is blocked by 60s floor, fails closed without returning old cache
  const resFloor = await state.invokeReadiness();
  assert.deepEqual(resFloor, UNAVAILABLE);
  assert.equal(state.counts.trades, 1, '60s floor blocks upstream attempt');

  // Fast forward past 60s floor
  const now = Math.floor(Date.now() / 1000);
  await seedReadiness(state, {
    ...recordBefore,
    lastAttemptAt: now - 65,
    expiresAt: now - 65 + 900,
    attempts: [now - 65],
  });

  // Now refresh proceeds with new generation
  const resRefreshed = await state.invokeReadiness();
  assert.deepEqual(resRefreshed, SUPPORTED_TEST);
  assert.equal(state.counts.trades, 2, 'fresh trade occurred after 60s floor');

  // Rolling budget retains previous attempts
  const recordAfter = await readinessRecord(state);
  assert.equal(recordAfter.attempts.length, 2, 'rolling attempts budget was NOT reset');
});

test('readiness: corrupted cache record fails closed without erasing storage or resetting quota', async t => {
  const state = await runtimeFixture({ config: configuration() });
  t.after(() => state.close());

  // Put corrupt data into checkout_readiness
  await seedReadiness(state, { corrupted: true, garbage: 12345 });

  const res = await state.invokeReadiness();
  assert.deepEqual(res, UNAVAILABLE);
  assert.equal(state.counts.trades, 0, 'corrupted state fails closed without upstream calls');

  // Corrupted record was NOT wiped or erased
  const record = await readinessRecord(state);
  assert.equal(record.corrupted, true);
});

test('readiness: 100-attempt rolling budget exhaustion fails closed', async t => {
  const state = await runtimeFixture({ config: configuration() });
  t.after(() => state.close());

  // Seed 100 attempts within the last 24h
  const now = Math.floor(Date.now() / 1000);
  const attempts = Array.from({ length: 100 }, (_, i) => now - 1000 - i * 60);
  await seedReadiness(state, {
    version: 1,
    generation: 'different-generation',
    status: 'unavailable',
    expiresAt: now - 100,
    lastAttemptAt: now - 1000, // past 60s floor
    attempts,
  });

  const res = await state.invokeReadiness();
  assert.deepEqual(res, UNAVAILABLE);
  assert.equal(state.counts.trades, 0, 'budget exhaustion prevents any trade');
});

test('readiness: genuine checkout start and status remain fresh and succeed even when readiness budget is exhausted', async t => {
  const state = await runtimeFixture({ config: configuration() });
  t.after(() => state.close());

  // Exhaust readiness budget completely
  const now = Math.floor(Date.now() / 1000);
  const attempts = Array.from({ length: 100 }, (_, i) => now - 1000 - i * 60);
  await seedReadiness(state, {
    version: 1,
    generation: 'any-gen',
    status: 'unavailable',
    expiresAt: now - 100,
    lastAttemptAt: now - 1000,
    attempts,
  });

  // Readiness fails closed due to budget
  const ready = await state.invokeReadiness();
  assert.deepEqual(ready, UNAVAILABLE);
  assert.equal(state.counts.trades, 0);

  // Genuine checkout is completely independent and succeeds!
  const prepared = await state.invoke('checkout/guest/prepare');
  assert.equal(prepared.ok, true);
  const token = prepared.capability.capability;

  const started = await state.invoke(
    'checkout/guest/start',
    { contact: { email: 'shopper@example.test' }, lines: [{ catalogItemId: 'hat', quantity: 1 }] },
    token,
  );
  assert.equal(started.ok, true);
  assert.equal(started.checkout.state, 'pending');
  assert.equal(state.counts.trades, 1, 'genuine checkout start traded store key independently');

  state.setPaid();
  const paid = await state.invoke('checkout/guest/status', {}, token);
  assert.equal(paid.checkout.state, 'paid');
  assert.equal((await state.collections.orders.query()).items.length, 1);
  assert.equal(state.counts.trades, 2, 'genuine checkout status traded store key independently');
});

test('readiness: a superseded CAS claim cannot publish or return supported', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  let release, entered;
  const blocked = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const config = configuration();
  state.setTransportOverride(async () => {
    entered();
    await blocked;
    return Response.json({ bindingRef: config.bindingRef, providerId: 'stripe',
      stripeAccountId: config.stripeAccountId, mode: 'test', ready: true });
  });
  const pending = state.invokeReadiness();
  await started;
  const replacement = { ...await readinessRecord(state), generation: 'new-owner-generation' };
  await seedReadiness(state, replacement);
  release();
  assert.deepEqual(await pending, UNAVAILABLE);
  assert.deepEqual(await readinessRecord(state), replacement);
});

test('readiness: malformed times, history and schemas cannot extend a cached result', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  assert.deepEqual(await state.invokeReadiness(), SUPPORTED_TEST);
  const baseline = await readinessRecord(state), now = Math.floor(Date.now() / 1000);
  for (const invalid of [
    { ...baseline, expiresAt: baseline.expiresAt + 1 },
    { ...baseline, lastAttemptAt: now + 100, expiresAt: now + 1000, attempts: [now + 100] },
    { ...baseline, attempts: ['not-a-time'] },
    { ...baseline, attempts: Array(101).fill(baseline.lastAttemptAt) },
    { ...baseline, version: 2 },
  ]) {
    await seedReadiness(state, invalid);
    assert.deepEqual(await state.invokeReadiness(), UNAVAILABLE);
    assert.equal(state.counts.trades, 1);
    assert.deepEqual(await readinessRecord(state), invalid);
  }
});

test('readiness: settings changed during refresh discard the old supported result', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  let release, entered;
  const blocked = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const config = configuration();
  state.setTransportOverride(async () => {
    entered();
    await blocked;
    return Response.json({ bindingRef: config.bindingRef, providerId: 'stripe',
      stripeAccountId: config.stripeAccountId, mode: 'test', ready: true });
  });
  const pending = state.invokeReadiness();
  await started;
  await state.settings.set('installedCheckout', JSON.stringify({ schema: REGISTRY_CHECKOUT_CONFIG_SCHEMA, enabled: false }));
  release();
  assert.deepEqual(await pending, UNAVAILABLE);
  assert.equal((await readinessRecord(state)).status, 'unavailable');
  assert.deepEqual(await state.invokeReadiness(), UNAVAILABLE);
  assert.equal(state.counts.trades, 1);
});

test('readiness: replacing the store key invalidates the result without resetting quota', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  assert.deepEqual(await state.invokeReadiness(), SUPPORTED_TEST);
  const old = await readinessRecord(state);
  const replacementKey = 'dk_store_' + 'r'.repeat(43);
  await state.settings.set('connection', connectionFor(replacementKey));
  state.acceptStoreKey(replacementKey);
  assert.deepEqual(await state.invokeReadiness(), UNAVAILABLE);
  assert.equal(state.counts.trades, 1);
  const at = Math.floor(Date.now() / 1000) - 65;
  await seedReadiness(state, { ...old, lastAttemptAt: at, expiresAt: at + 900, attempts: [at] });
  assert.deepEqual(await state.invokeReadiness(), SUPPORTED_TEST);
  const current = await readinessRecord(state);
  assert.notEqual(current.generation, old.generation);
  assert.equal(current.attempts.length, 2);
  assert.equal(JSON.stringify(current).includes(replacementKey), false);
});

test('readiness: a fresh cached answer never masks disabled owner configuration', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  assert.deepEqual(await state.invokeReadiness(), SUPPORTED_TEST);
  await state.settings.set('installedCheckout', JSON.stringify({ schema: REGISTRY_CHECKOUT_CONFIG_SCHEMA, enabled: false }));
  assert.deepEqual(await state.invokeReadiness(), UNAVAILABLE);
  assert.equal(state.counts.trades, 1);
});

test('readiness: budget survives restart and does not affect another installed store', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'commerce-readiness-budget-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'store-a.db');
  const first = await runtimeFixture({ databasePath });
  try {
    await first.invokeReadiness();
    const old = await readinessRecord(first), at = Math.floor(Date.now() / 1000) - 1000;
    await seedReadiness(first, { ...old, status: 'unavailable', lastAttemptAt: at,
      expiresAt: at + 900, attempts: Array.from({ length: 100 }, (_, i) => at - i * 60) });
  } finally { await first.close(); }
  const other = await runtimeFixture({ databasePath: join(directory, 'store-b.db') });
  try {
    assert.deepEqual(await other.invokeReadiness(), SUPPORTED_TEST);
    assert.equal(other.counts.trades, 1);
  } finally { await other.close(); }
  const reopened = await runtimeFixture({ databasePath, seed: false, config: null, storeKey: null });
  try {
    assert.deepEqual(await reopened.invokeReadiness(), UNAVAILABLE);
    assert.equal(reopened.counts.trades, 0);
    assert.equal((await readinessRecord(reopened)).attempts.length, 100);
  } finally { await reopened.close(); }
});

test('readiness: slow storage cannot serve a result past its TTL', { timeout: 10000 }, async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  await state.invokeReadiness();
  const cached = await readinessRecord(state);
  const expiresAt = Math.floor(Date.now() / 1000) + 2, at = expiresAt - 900;
  await seedReadiness(state, { ...cached, expiresAt, lastAttemptAt: at,
    attempts: Array.from({ length: 100 }, (_, i) => at - i * 60) });
  const original = PluginStorageRepository.prototype.getVersioned;
  let release, entered, timeout;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise((resolve, reject) => {
    entered = resolve;
    timeout = setTimeout(() => reject(new Error('fixture storage interception unavailable')), 5000);
  });
  // Delay only the real SDK read; retain the original installed context and stored value.
  PluginStorageRepository.prototype.getVersioned = async function(id) {
    if (id === 'readiness') { entered(); await gate; }
    return original.call(this, id);
  };
  try {
    const pending = state.invokeReadiness();
    await started;
    clearTimeout(timeout);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt * 1000 + 50 - Date.now())));
    release();
    assert.deepEqual(await pending, UNAVAILABLE);
    assert.equal(state.counts.trades, 1, 'expired result and exhausted budget make no new upstream call');
  } finally {
    clearTimeout(timeout);
    release();
    PluginStorageRepository.prototype.getVersioned = original;
  }
});
