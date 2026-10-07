import assert from 'node:assert/strict';
import test from 'node:test';
import { configuration, credential, runtimeFixture, SITE } from '../features/checkout/registry-runtime.mjs';
import { COMMERCE_CHECKOUT_WAKES_TASK } from '../../dist/features/checkout/index.js';

const PREPARE = 'checkout/guest/prepare', START = 'checkout/guest/start', STATUS = 'checkout/guest/status';
const basket = { lines: [{ catalogItemId: 'hat', quantity: 1 }] };

async function start(state, input = basket) {
  const prepared = await state.invoke(PREPARE);
  assert.equal(prepared.ok, true);
  const token = prepared.capability.capability;
  return { token, result: await state.invoke(START, input, token) };
}

test('actual compiled default workerd profile preserves empty-grants/unconfigured admission', async t => {
  const state = await runtimeFixture({ grants: false, config: null, token: null });
  t.after(() => state.close());
  assert.deepEqual(state.artifact.capabilities, []);
  assert.deepEqual(state.artifact.allowedHosts, []);
  const { result } = await start(state);
  assert.equal(result.error.code, 'PAYMENTS_UNAVAILABLE');
  await state.plugin.invokeHook('cron', { name: COMMERCE_CHECKOUT_WAKES_TASK });
  assert.equal(state.counts.credentials, 0);
  assert.equal(state.counts.transport, 0);
  assert.equal(state.counts.scheduler, 0);
  assert.deepEqual(await state.cartRecords(), []);
});

test('actual SDK CAS and manifest uniqueness retain one winner and owner configuration revisions', async t => {
  const state = await runtimeFixture({ config: null, token: null });
  t.after(() => state.close());
  const carts = state.collections.checkout_carts;
  const results = await Promise.all([carts.compareAndSet('race', null, { attempts: [] }), carts.compareAndSet('race', null, { attempts: [] })]);
  assert.equal(results.filter(value => value.applied).length, 1);
  const original = await carts.getVersioned('race');
  assert.equal(typeof original.revision, 'string');
  assert.equal((await carts.compareAndSet('race', original.revision, { attempts: [], marker: 'winner' })).applied, true);
  assert.equal((await carts.compareAndSet('race', original.revision, { attempts: [], marker: 'stale' })).applied, false);
  assert.equal((await carts.getVersioned('race')).value.marker, 'winner');
  const first = await state.settings.compareAndSet('installedCheckout', null, JSON.stringify(configuration()));
  assert.equal(first.applied, true);
  assert.equal((await state.settings.compareAndSet('installedCheckout', null, 'stale')).applied, false);
  assert.equal((await state.settings.getVersioned('installedCheckout')).revision, first.revision);
  await state.collections.coupons.put('unique-a', { normalizedCode: 'SYNTHETIC' });
  await assert.rejects(state.collections.coupons.compareAndSet('unique-b', null, { normalizedCode: 'SYNTHETIC' }), /UNIQUE/);
  assert.equal(await state.collections.coupons.get('unique-b'), null);
});

test('malformed or copied configuration is rejected before encrypted credential/transport', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  const cases = [
    { ...configuration(), commerceOrigin: 'https://other.example.test' },
    { ...configuration(), schema: 'unsupported' },
    { ...configuration(), paymentsOrigin: 'http://8.8.8.8' },
    { ...configuration(), providerId: 'unsupported' },
    { ...configuration(), pricingSchema: 'unsupported' },
    { ...configuration(), shipping: { configurationId: 'ship', revision: 1, mode: 'flat', amount: { currency: 'USD', minor: '-1' } } },
    { ...configuration(), shipping: { configurationId: 'ship', revision: 1, mode: 'free', amount: { currency: 'USD', minor: '1' } } },
  ];
  for (const config of cases) {
    await state.settings.set('installedCheckout', JSON.stringify(config));
    const result = await state.invoke(PREPARE);
    assert.equal(result.error.code, 'UNAVAILABLE');
  }
  assert.equal(state.counts.credentials, 0);
  assert.equal(state.counts.transport, 0);
  assert.deepEqual(await state.cartRecords(), []);
});

test('expired/wrong-scope/wrong-site credentials fail before synthetic Payments transport', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  const now = Math.floor(Date.now() / 1000);
  for (const changes of [{ exp: now - 1 }, { iat: now - 3601 }, { scope: 'payments:admin' },
    { site_id: 'other-site' }, { aud: 'other-audience' }, { iss: 'https://other.example.test' }, { nbf: now + 100 }]) {
    await state.settings.set('installedCheckoutCredential', await credential(changes));
    assert.equal((await state.invoke(PREPARE)).error.code, 'UNAVAILABLE');
  }
  assert.equal(state.counts.transport, 0);
  assert.equal(state.counts.scheduler, 0);
  assert.deepEqual(await state.cartRecords(), []);
  // Legitimate standard scope and audience array are accepted; no obsolete array claim.
  await state.settings.set('installedCheckoutCredential', await credential({ aud: ['synthetic-payments', 'other'] }));
  assert.equal((await state.invoke(PREPARE)).ok, true);
});

test('default module rejects foreign origin before settings/credentials and preserves managed binding', async t => {
  const state = await runtimeFixture({ managed: true });
  t.after(() => state.close());
  assert.equal((await state.invoke(PREPARE, {}, undefined, 'https://other.example.test')).error.code, 'ORIGIN_DENIED');
  assert.equal(state.counts.credentials, 0);
  const before = await state.collections.catalog_items.get('hat');
  const binding = await state.collections.store_inventory_configurations.get('active');
  const { result } = await start(state);
  assert.equal(result.error.code, 'PRODUCT_UNAVAILABLE');
  assert.equal(state.counts.transport, 0);
  assert.deepEqual(await state.collections.catalog_items.get('hat'), before);
  assert.deepEqual(await state.collections.store_inventory_configurations.get('active'), binding);
  assert.deepEqual(await state.cartRecords(), []);
});

test('workerd bridge denies missing grants even with configured services and HTTP proxy', async t => {
  const state = await runtimeFixture({ grants: false });
  t.after(() => state.close());
  const { result } = await start(state);
  assert.equal(result.ok, true);
  assert.equal(state.counts.transport, 0);
  const attempts = (await state.cartRecords())[0].attempts;
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].phase, 'paying');
  assert.equal(attempts[0].order, undefined);
  assert.equal(state.counts.scheduler, 0);
});

for (const mode of ['free', 'flat']) test(`compiled default workerd ${mode} shipping and coupon retain canonical payment/order replay`, async t => {
  const shipping = { configurationId: 'ship-synthetic', revision: 3, mode,
    ...(mode === 'flat' ? { amount: { currency: 'USD', minor: '50' } } : {}) };
  const state = await runtimeFixture({ config: configuration(shipping) });
  t.after(() => state.close());
  await state.coupon();
  const { token, result } = await start(state, { ...basket, couponCode: 'save10' });
  assert.equal(result.ok, true);
  assert.equal(state.requests.length, 1);
  const original = structuredClone(state.requests[0]);
  assert.equal(original.total.minor, mode === 'flat' ? '200' : '150');
  assert.equal(original.pricing.merchandiseSubtotal.minor, '250');
  assert.equal(original.pricing.couponDiscount.minor, '100');
  assert.equal(original.pricing.netMerchandise.minor, '150');
  assert.equal(original.pricing.shipping.mode, mode);
  assert.equal(original.pricing.shipping.revision, 3);
  state.setPaid();
  await state.settings.set('installedCheckout', JSON.stringify(configuration({ configurationId: 'changed', revision: 4, mode: 'free' })));
  const paid = await state.invoke(STATUS, {}, token);
  assert.equal(paid.ok, true);
  assert.equal(paid.checkout.state, 'paid');
  const replay = await state.invoke(STATUS, {}, token);
  assert.deepEqual(replay.checkout.order, paid.checkout.order);
  const record = (await state.cartRecords())[0];
  assert.equal(record.attempts.length, 1);
  assert.equal(record.attempts[0].order.total.minor, original.total.minor);
  assert.deepEqual(record.attempts[0].order.pricing, original.pricing);
  assert.equal(record.attempts[0].coupon.status, 'consumed');
  assert.equal(state.requests.length, 1);
  assert.equal(state.counts.scheduler, 0);
});

test('real workerd cron wake applies canonical paid order/coupon before exact ACK and replay', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  await state.coupon();
  await start(state, { ...basket, couponCode: 'save10' });
  state.setPaid();
  state.setWakes([{ eventId: 'evt_SYNTHETIC', attemptId: state.requests[0].attemptId,
    bindingRef: configuration().bindingRef, deliveryGeneration: 2, wokeAt: Date.now() }]);
  await state.plugin.invokeHook('cron', { name: COMMERCE_CHECKOUT_WAKES_TASK });
  assert.equal(state.counts.acknowledgments, 1);
  const record = structuredClone((await state.cartRecords())[0]);
  await state.plugin.invokeHook('cron', { name: COMMERCE_CHECKOUT_WAKES_TASK });
  assert.deepEqual((await state.cartRecords())[0], record);
  assert.equal(state.counts.acknowledgments, 1);
  assert.equal(state.counts.scheduler, 0);
});

test('wake transport rejects oversized/malformed batches with no ACK or canonical order', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  state.setTransportOverride(() => new Response(' '.repeat(131073)));
  await state.plugin.invokeHook('cron', { name: COMMERCE_CHECKOUT_WAKES_TASK });
  assert.equal(state.counts.acknowledgments, 0);
  assert.deepEqual(await state.cartRecords(), []);
  state.setTransportOverride(() => Response.json(Array.from({ length: 101 }, () => ({
    eventId: 'evt_SYNTHETIC', attemptId: 'attempt', bindingRef: configuration().bindingRef, deliveryGeneration: 1, wokeAt: 1 }))));
  await state.plugin.invokeHook('cron', { name: COMMERCE_CHECKOUT_WAKES_TASK });
  assert.equal(state.counts.acknowledgments, 0);
  assert.deepEqual(await state.cartRecords(), []);
});
