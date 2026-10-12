import assert from 'node:assert/strict';
import test from 'node:test';
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

test('readiness: leaves storage completely untouched (read-time service effect only)', async t => {
  const state = await runtimeFixture({ config: configuration() });
  t.after(() => state.close());

  const cartsBefore = await state.collections.checkout_carts.query();
  const capsBefore = await state.collections.checkout_guest_capabilities.query();
  const ordersBefore = await state.collections.orders.query();

  const res = await state.invokeReadiness();
  assert.deepEqual(res, SUPPORTED_TEST);

  const cartsAfter = await state.collections.checkout_carts.query();
  const capsAfter = await state.collections.checkout_guest_capabilities.query();
  const ordersAfter = await state.collections.orders.query();

  assert.equal(cartsAfter.items.length, 0);
  assert.equal(capsAfter.items.length, 0);
  assert.equal(ordersAfter.items.length, 0);
  assert.deepEqual(cartsBefore, cartsAfter);
  assert.deepEqual(capsBefore, capsAfter);
  assert.deepEqual(ordersBefore, ordersAfter);
});

test('readiness: missing config returns unavailable without trade', async t => {
  const state = await runtimeFixture({ config: null });
  t.after(() => state.close());

  assert.equal((await state.invoke('checkout/guest/prepare')).ok, true,
    'successful prepare is not evidence of configured Payments');

  const res = await state.invokeReadiness();
  assert.deepEqual(res, UNAVAILABLE);
  assert.equal(state.counts.trades, 0, 'no trade when config is missing');
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
    { config: { ...configuration(), commerceOrigin: 'https://foreign.example.test' } },
  ]) {
    const state = await runtimeFixture(options);
    try {
      assert.deepEqual(await state.invokeReadiness(), UNAVAILABLE);
      assert.equal(state.counts.trades, 0);
    } finally { await state.close(); }
  }
});

test('readiness: absent ready flag is not affirmative merchant readiness', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  const config = configuration();
  state.setTransportOverride(() => Response.json({
    bindingRef: config.bindingRef, providerId: config.providerId,
    stripeAccountId: config.stripeAccountId, mode: 'test',
  }));
  assert.deepEqual(await state.invokeReadiness(), UNAVAILABLE);
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
  const state = await runtimeFixture({ storeKey: 'invalid-key' });
  t.after(() => state.close());
  state.acceptStoreKey('other-key');

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

  // 5. Readiness also reflects unavailable now
  const readyAfter = await state.invokeReadiness();
  assert.deepEqual(readyAfter, UNAVAILABLE);
});
