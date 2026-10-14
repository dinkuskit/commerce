// This SDK uses one workerd port; keep the readiness and service cases in one test process.
import './registry-checkout-readiness-cases.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { resolveCatalogItemPrice } from '../../dist/features/catalog/index.js';
import { resolveStorefrontAvailability } from '../../dist/features/storefront-availability/index.js';
import { saveMerchantStoreSettings } from '../../dist/features/store-settings/index.js';
import { syntheticDelivery } from '../features/checkout/fixture.mjs';
import {
  authorizeNetConfiguration,
  configuration,
  COUPONS,
  COUPONS_ORIGIN,
  couponCredential,
  credential,
  ISSUER_ORIGIN,
  legacyStripeConfiguration,
  runtimeFixture,
  SHIP,
  shipCredential,
  SITE,
  STORE_KEY,
  TRADE_URL,
  TRANSPORT_ORIGIN,
  verifyCouponPass,
  verifyShipPass,
} from '../features/checkout/registry-runtime.mjs';
import { couponCollection } from '../features/checkout/pricing-fixture.mjs';
import { couponServiceFake } from '../features/checkout/coupon-service-fake.mjs';
import { createCouponAdmin } from '../../dist/features/coupons/index.js';
import {
  COMMERCE_CHECKOUT_WAKES_TASK,
  COMMERCE_REGISTRY_RUNTIME_ID,
} from '../../dist/features/checkout/index.js';

const PREPARE = 'checkout/guest/prepare', START = 'checkout/guest/start', STATUS = 'checkout/guest/status';
const basket = { contact: { email: 'shopper@example.test' }, lines: [{ catalogItemId: 'hat', quantity: 1 }] };

async function start(state, input = basket) {
  const prepared = await state.invoke(PREPARE);
  assert.equal(prepared.ok, true);
  const token = prepared.capability.capability;
  return { token, result: await state.invoke(START, input, token) };
}

test('actual compiled default workerd profile preserves empty-grants/unconfigured admission', async t => {
  const state = await runtimeFixture({ grants: false, config: null, token: null });
  t.after(() => state.close());
  assert.equal(state.manifest.id, COMMERCE_REGISTRY_RUNTIME_ID);
  assert.deepEqual(state.artifact.capabilities, ['media:read', 'network:request']);
  assert.deepEqual(state.artifact.allowedHosts, ['payments.dinkuskit.com', 'coupons.dinkuskit.com', 'ship.dinkuskit.com', 'dinkuskit.com']);
  const { result } = await start(state);
  assert.equal(result.error.code, 'PAYMENTS_UNAVAILABLE');
  await state.plugin.invokeHook('cron', { name: COMMERCE_CHECKOUT_WAKES_TASK });
  assert.equal(state.counts.credentials, 0);
  assert.equal(state.counts.transport, 0);
  assert.equal(state.counts.scheduler, 0);
  assert.deepEqual(await state.cartRecords(), []);
});

test('EmDash 1.2 SDK storage preserves checkout records across runtime restart without reseed', async t => {
  const directory = await mkdtemp('/tmp/commerce-emdash-1-2-restart-');
  const databasePath = join(directory, 'runtime.db');
  t.after(() => rm(directory, { recursive: true, force: true }));

  const first = await runtimeFixture({ databasePath });
  const { token } = await (async () => {
    const started = await start(first);
    assert.equal(started.result.ok, true);
    first.setPaid();
    const paid = await first.invoke(STATUS, {}, started.token);
    assert.equal(paid.checkout.state, 'paid');
    return started;
  })().finally(() => first.close());

  const restarted = await runtimeFixture({
    grants: false,
    config: null,
    token: null,
    databasePath,
    seed: false,
  });
  t.after(() => restarted.close());
  const replay = await restarted.invoke(STATUS, {}, token);
  assert.equal(replay.ok, true);
  assert.equal(replay.checkout.state, 'paid');
  assert.equal(replay.checkout.order.total.minor, '250');
  assert.equal((await restarted.collections.catalog_items.get('hat')).sku, 'HAT');
  const persistedAttempt = (await restarted.cartRecords())[0].attempts[0];
  assert.equal(persistedAttempt.coupon, undefined);
  assert.equal(persistedAttempt.order.orderId, replay.checkout.order.orderId);
  assert.equal(persistedAttempt.order.total.minor, replay.checkout.order.total.minor);
});

test('compiled Registry runtime ships no coupon storage or evaluator, and without a coupon service rejects coupon codes before attempts or Payments', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  assert.equal(Object.hasOwn(state.artifact.storage, 'coupons'), false);
  assert.equal(state.artifact.admin.pages.some(page => page.path === '/coupons'), false);
  // Coupon evaluation and redemption code is absent from the shipped backend, not merely unreachable.
  const backend = await readFile(new URL('../../dist/sandbox/plugin.mjs', import.meta.url), 'utf8');
  for (const marker of ['browser totals are not authority', 'coupon CAS contention did not settle', 'normalized-code uniqueness']) {
    assert.equal(backend.includes(marker), false, marker);
  }
  const prepared = await state.invoke(PREPARE);
  const token = prepared.capability.capability;
  for (const couponCode of ['SAVE10', 'save10']) {
    const rejected = await state.invoke(START, { ...basket, couponCode }, token);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, 'COUPON_UNAVAILABLE');
    assert.equal(rejected.error.reason, 'try-later');
  }
  assert.deepEqual(await state.cartRecords(), []);
  assert.equal(state.requests.length, 0);
  // The same capability still checks out without a coupon.
  const plain = await state.invoke(START, basket, token);
  assert.equal(plain.ok, true);
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].pricing.couponDiscount.minor, '0');
  assert.equal(Object.hasOwn(state.requests[0].pricing, 'coupon'), false);
  assert.equal(state.counts.scheduler, 0);
});

async function hostedCoupons() {
  const coupons = couponCollection();
  await createCouponAdmin(coupons).create({
    code: 'SAVE10', globalCap: 5,
    rule: { ruleId: 'synthetic-rule', version: 1, discount: { kind: 'fixed', amount: { currency: 'USD', minor: '100' } },
      appliesTo: 'all-merchandise', selectedProductIds: [], includeSaleItems: true,
      minimumEligibleMerchandise: { currency: 'USD', minor: '0' },
      startsAt: '2026-01-01T00:00:00Z', endsAt: '2100-01-01T00:00:00Z', timeZone: 'UTC' },
  });
  const service = couponServiceFake(coupons, { siteId: 'synthetic-site', origin: COUPONS_ORIGIN, authorize: verifyCouponPass });
  return { service };
}

test('coupons are unhooked from the Registry build: a coupon code is refused before any call, even with the coupon service in the settings', async () => {
  const hosted = await hostedCoupons();
  // The hosted coupon port and its pass are absent from the shipped backend, not merely unused.
  const backend = await readFile(new URL('../../dist/sandbox/plugin.mjs', import.meta.url), 'utf8');
  for (const marker of ['/quotes', '/redemptions', 'coupons:checkout']) assert.equal(backend.includes(marker), false, marker);
  for (const couponPass of [await couponCredential(), null, await credential(), await couponCredential({ site_id: 'another-site' })]) {
    const state = await runtimeFixture({ config: { ...configuration(), coupons: COUPONS },
      couponPass, couponService: hosted.service.fetch });
    try {
      const prepared = await state.invoke(PREPARE);
      const capability = prepared.capability.capability;
      for (const couponCode of ['SAVE10', 'save10']) {
        const rejected = await state.invoke(START, { ...basket, couponCode }, capability);
        assert.equal(rejected.error.code, 'COUPON_UNAVAILABLE');
        assert.equal(rejected.error.reason, 'try-later');
      }
      assert.deepEqual(await state.cartRecords(), []);
      assert.equal(state.counts.coupons, 0);
      assert.equal(state.requests.length, 0);
      // The same capability still checks out without a coupon, trading only for Payments.
      const plain = await state.invoke(START, basket, capability);
      assert.equal(plain.ok, true);
      assert.equal(state.requests.length, 1);
      assert.deepEqual(state.trades.map(trade => trade.body.scope), ['payments:checkout']);
    } finally {
      await state.close();
    }
  }
  assert.equal(hosted.service.calls.length, 0);
});

const zeroPrice = { recordKind: 'catalog-price', recordId: 'hat', catalogItemId: 'hat', regular: { currency: 'USD', minor: '0' } };

test('actual compiled default workerd zero-priced cart writes one payment-free order', async t => {
  const state = await runtimeFixture({ grants: false, config: configuration() });
  t.after(() => state.close());
  await state.collections.catalog_prices.put('hat', zeroPrice);
  const { token, result } = await start(state);
  assert.equal(result.ok, true);
  assert.equal(result.checkout.state, 'paid');
  assert.equal(result.checkout.order.total.minor, '0');
  const stored = (await state.cartRecords())[0].attempts[0];
  assert.equal(Object.hasOwn(stored.order, 'paymentId'), false);
  assert.equal(stored.session, undefined);
  assert.equal(state.requests.length, 0);
  const repeat = await state.invoke(STATUS, {}, token);
  assert.deepEqual(repeat.checkout.order, result.checkout.order);
  assert.equal(state.counts.transport, 0);
  assert.equal(state.counts.scheduler, 0);
});

test('compiled zero-priced merchandise with positive shipping still uses Payments', async t => {
  const state = await runtimeFixture({ config: configuration({ configurationId: 'ship-flat', revision: 1,
    mode: 'flat', amount: { currency: 'USD', minor: '50' } }) });
  t.after(() => state.close());
  await state.collections.catalog_prices.put('hat', zeroPrice);
  const { result } = await start(state);
  assert.equal(result.ok, true);
  assert.equal(result.checkout.pricing.netMerchandise.minor, '0');
  assert.equal(result.checkout.total.minor, '50');
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].total.minor, '50');
  assert.equal((await state.cartRecords())[0].attempts[0].order, undefined);
});

test('EmDash 1.2 original storage shares admin prices, storefront helpers and canonical checkout', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  const prepared = await state.invoke(PREPARE);
  assert.equal(prepared.ok, true);
  // Invoke the compiled admin handler on its original owner storage. Actual
  // HTTP admin authorization is separately exercised by the browser suite.
  const saved = await state.plugin.invokeRoute('admin', {
    type: 'form_submit', action_id: 'save:hat',
    values: { regular: '4.00', sale: '3.00', stockStatus: 'in-stock' },
  }, { url: `${SITE}/_emdash/api/plugins/${state.manifest.id}/admin`, method: 'POST' });
  assert.equal(saved.toast.type, 'success');
  const c = state.collections;
  const price = await resolveCatalogItemPrice(c.catalog_prices, 'hat');
  assert.deepEqual(price.customerPays, { currency: 'USD', minor: '300' });
  const availability = await resolveStorefrontAvailability({
    catalog: c.catalog_items, prices: c.catalog_prices,
    manualAvailability: c.catalog_manual_availability,
    backorderPolicies: c.catalog_backorder_policies,
    configurations: c.store_inventory_configurations,
    settings: c.storefront_availability_settings,
    listing: c.storefront_out_of_stock_listing,
  }, { catalogItemId: 'hat' });
  assert.equal(availability.sellable, true);
  const token = prepared.capability.capability;
  const started = await state.invoke(START, basket, token);
  assert.equal(started.ok, true);
  assert.deepEqual(started.checkout.total, price.customerPays);
  assert.deepEqual(state.requests[0].total, price.customerPays);
  state.setPaid();
  const paid = await state.invoke(STATUS, {}, token);
  assert.equal(paid.checkout.state, 'paid');
  assert.deepEqual(paid.checkout.order.total, price.customerPays);
});

test('public installed catalog reads an admin-created product and canonical order', async t => {
  const directory = await mkdtemp('/tmp/commerce-public-catalog-restart-');
  const databasePath = join(directory, 'runtime.db');
  let state = await runtimeFixture({ seed: false, databasePath });
  t.after(async () => { await state.close(); await rm(directory, { recursive: true, force: true }); });
  const admin = input => state.plugin.invokeRoute('admin', input, { url: `${SITE}/_emdash/api/plugins/${state.manifest.id}/admin`, method: 'POST' });
  const created = await admin({ type: 'form_submit', action_id: 'create:public-catalog-flow', values: { name: 'Public Hat', sku: 'PUBLIC-HAT' } });
  assert.equal(created.toast.type, 'success');
  const products = (await state.collections.catalog_items.query()).items.filter(row => row.data.recordKind === 'catalog-item');
  assert.equal(products.length, 1);
  const id = products[0].id;
  assert.equal((await admin({ type: 'form_submit', action_id: 'save:' + id, values: { regular: '4.00', sale: '3.00', stockStatus: 'in-stock' } })).toast.type, 'success');
  const catalog = await state.plugin.invokeRoute('catalog/public', {}, { url: `${SITE}/_emdash/api/plugins/${state.manifest.id}/catalog/public`, method: 'GET' });
  assert.deepEqual(catalog, { products: [{ id, name: 'Public Hat', sku: 'PUBLIC-HAT', price: { currency: 'USD', minor: '300' }, availability: { status: 'in-stock', sellable: true, listable: true }, image: null, gallery: [] }] });
  // An admin-created product has no fulfillment mark, so it counts as physical and needs a US address.
  await saveMerchantStoreSettings(state.settings, { expectedRevision: null, storeCountry: 'US' });
  const input = { contact: { email: 'shopper@example.test', delivery: syntheticDelivery }, lines: [{ catalogItemId: catalog.products[0].id, quantity: 2 }] };
  const { token, result } = await start(state, input);
  assert.equal(result.ok, true);
  assert.equal(state.requests[0].total.minor, '600');
  state.setPaid();
  const paid = await state.invoke(STATUS, {}, token);
  assert.equal(paid.checkout.state, 'paid');
  assert.equal(paid.checkout.order.total.minor, '600');
  const replay = await state.invoke(START, input, token);
  assert.deepEqual(replay.checkout.order, paid.checkout.order);
  const stored = (await state.cartRecords())[0];
  assert.equal(stored.attempts.length, 1);
  assert.equal(stored.attempts[0].coupon, undefined);
  assert.equal(state.requests.length, 1);
  assert.equal(typeof paid.checkout.order.receiptId, 'string');
  assert.deepEqual(stored.attempts[0].order.total, state.requests[0].total);
  assert.equal(stored.attempts[0].payment.pricing.couponDiscount.minor, '0');
  await state.close();
  state = await runtimeFixture({ seed: false, databasePath, config: null, token: null, grants: false });
  const recovered = await state.invoke(STATUS, {}, token);
  assert.deepEqual(recovered.checkout.order, paid.checkout.order);
  assert.equal((await state.cartRecords())[0].attempts.length, 1);
  assert.equal(state.counts.transport, 0);
});

test('compiled route rejects missing/foreign capability and browser totals before order creation', async t => {
  const state = await runtimeFixture({ grants: false });
  t.after(() => state.close());
  const prepared = await state.invoke(PREPARE);
  const input = basket;
  assert.equal((await state.invoke(START, input)).error.code, 'CAPABILITY_DENIED');
  assert.equal((await state.invoke(START, input, 'guessed')).error.code, 'CAPABILITY_DENIED');
  assert.equal((await state.invoke(START, input, prepared.capability.capability, 'https://foreign.example.test')).error.code, 'ORIGIN_DENIED');
  assert.equal((await state.invoke(START, { ...input, total: { currency: 'USD', minor: '0' } }, prepared.capability.capability)).error.code, 'INVALID_CART');
  assert.deepEqual(await state.cartRecords(), []);
  assert.equal(state.counts.transport, 0);
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
  await state.collections.catalog_items.put('unique-a', { skuKey: 'SYNTHETIC' });
  await assert.rejects(state.collections.catalog_items.compareAndSet('unique-b', null, { skuKey: 'SYNTHETIC' }), /UNIQUE/);
  assert.equal(await state.collections.catalog_items.get('unique-b'), null);
});

test('predecessor v1 enabled config without mode still uses TEST Payments binding', async t => {
  const { mode: _ignored, ...legacy } = configuration();
  const state = await runtimeFixture({ config: legacy });
  t.after(() => state.close());
  const { result } = await start(state);
  assert.equal(result.ok, true);
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].total.minor, '250');
});

test('a store set to live records live orders only while Payments says its binding is live', async () => {
  // One workerd runtime at a time.
  const paidOrder = async options => {
    const state = await runtimeFixture(options);
    try {
      const { token, result } = await start(state);
      assert.equal(result.ok, true);
      state.setPaid();
      const paid = await state.invoke(STATUS, {}, token);
      assert.equal(paid.checkout.state, 'paid');
      // Checkout's own copy and the copy Orders keeps agree; the shopper's view does not carry it.
      const kept = (await state.collections.orders.query()).items.map(item => item.data.paidOrder);
      assert.equal(kept.length, 1);
      assert.equal(kept[0].mode, (await state.cartRecords())[0].attempts[0].order.mode);
      assert.equal(Object.hasOwn(paid.checkout.order, 'mode'), false);
      return kept[0];
    } finally { await state.close(); }
  };
  assert.equal((await paidOrder({ config: { ...configuration(), mode: 'live' }, bindingMode: 'live' })).mode, 'live');
  assert.equal((await paidOrder({})).mode, 'test');
  assert.equal((await paidOrder({ config: legacyStripeConfiguration() })).mode, 'test');
  // Either side alone set to live takes no payment.
  for (const [config, bindingMode] of [[{ ...configuration(), mode: 'live' }, 'test'], [configuration(), 'live'], [legacyStripeConfiguration(), 'live']]) {
    const state = await runtimeFixture({ config, bindingMode });
    try {
      await start(state);
      assert.equal(state.requests.length, 0);
      assert.deepEqual((await state.collections.orders.query()).items, []);
    } finally { await state.close(); }
  }
});

test('a checkout keeps the mode it started in when the store and Payments switch before the payment is looked up', async () => {
  for (const [from, to] of [['test', 'live'], ['live', 'test']]) {
    const state = await runtimeFixture({ config: { ...configuration(), mode: from }, bindingMode: from });
    try {
      const { token, result } = await start(state);
      assert.equal(result.ok, true);
      assert.equal((await state.cartRecords())[0].attempts[0].paymentMode, from);
      const lookups = () => state.requests.length + state.counts.transport;
      // Both sides switch while the payment is open, and Payments now reports it paid.
      const switchTo = async mode => {
        await state.settings.set('installedCheckout', JSON.stringify({ ...configuration(), mode }));
        state.setBindingMode(mode);
      };
      await switchTo(to);
      state.setPaid();
      const before = lookups();
      const waiting = await state.invoke(STATUS, {}, token);
      assert.notEqual(waiting.checkout.state, 'paid');
      assert.equal(lookups(), before);
      assert.deepEqual((await state.collections.orders.query()).items, []);
      assert.equal((await state.cartRecords())[0].attempts[0].phase, 'paying');
      // Switched back, the same payment finishes as an order in the mode it started in.
      await switchTo(from);
      const paid = await state.invoke(STATUS, {}, token);
      assert.equal(paid.checkout.state, 'paid');
      const kept = (await state.collections.orders.query()).items.map(item => item.data.paidOrder);
      assert.deepEqual(kept.map(order => order.mode), [from]);
    } finally { await state.close(); }
  }
});

test('agents read and complete orders through the private orders route of the compiled runtime', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  const route = state.manifest.routes.find(entry => entry.name === 'orders');
  assert.deepEqual(route, { name: 'orders', methods: ['POST'], public: false, permission: 'plugins:manage' });
  const { token } = await start(state);
  state.setPaid();
  assert.equal((await state.invoke(STATUS, {}, token)).checkout.state, 'paid');
  const orders = (input, user = { id: 'agent', role: 50 }) => state.plugin.invokeRoute('orders', input,
    { url: `${SITE}/_emdash/api/plugins/${state.manifest.id}/orders`, method: 'POST', ...(user ? { user } : {}) });
  const listed = await orders({ action: 'list', status: 'processing' });
  assert.equal(listed.total, 1);
  const [order] = listed.orders;
  assert.deepEqual([order.number, order.version, order.status, order.test, order.email], [1001, 1, 'processing', true, 'shopper@example.test']);
  const done = await orders({ action: 'complete', orderId: order.orderId, version: 1, carrier: 'USPS', tracking: 'SYNTHETIC-1' });
  assert.equal(done.result, 'saved');
  assert.deepEqual(done.order.completed.tracking, 'SYNTHETIC-1');
  assert.equal((await orders({ action: 'show', orderId: order.orderId })).order.status, 'completed');
  assert.equal((await orders({ action: 'list', status: 'processing' })).total, 0);
  // Without an administrator the route refuses, whatever the request says.
  await assert.rejects(orders({ action: 'list' }, null));
  await assert.rejects(orders({ action: 'list' }, { id: 'editor', role: 40 }));
});

test('malformed or copied configuration is rejected before encrypted credential/transport', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  const cases = [
    { ...configuration(), commerceOrigin: 'https://other.example.test' },
    { ...configuration(), schema: 'unsupported' },
    { ...configuration(), paymentsOrigin: 'http://8.8.8.8' },
    { ...configuration(), providerId: 'unsupported' },
    { ...configuration(), mode: 'LIVE' },
    { ...authorizeNetConfiguration(), mode: 'production' },
    { ...authorizeNetConfiguration(), stripeAccountId: 'acct_overloaded' },
    { ...configuration(), authorizeNetMerchantId: 'anet' },
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


test('legacy enabled v1 stripe config without new fields still starts checkout', async t => {
  const legacy = legacyStripeConfiguration();
  assert.equal(Object.hasOwn(legacy, 'mode'), false);
  assert.equal(Object.hasOwn(legacy, 'authorizeNetMerchantId'), false);
  const state = await runtimeFixture({ config: legacy });
  t.after(() => state.close());
  const { result } = await start(state);
  assert.equal(result.ok, true);
  assert.equal(result.checkout.state, 'pending');
  assert.equal(state.requests.length, 1);
});

test('authorize_net installed config admits beside stripe and creates a sandbox session', async t => {
  const state = await runtimeFixture({
    config: authorizeNetConfiguration({ authorizeNetMerchantId: 'anet_merchant', mode: 'test' }),
  });
  t.after(() => state.close());
  const { result } = await start(state);
  assert.equal(result.ok, true);
  assert.equal(result.checkout.state, 'pending');
  assert.equal(state.requests.length, 1);
});

test('expired/wrong-scope/wrong-site passes from the trade fail before synthetic Payments transport', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  const now = Math.floor(Date.now() / 1000);
  for (const changes of [{ exp: now - 1 }, { iat: now - 3601 }, { iat: now + 100 }, { scope: 'payments:admin' },
    { site_id: 'other-site' }, { aud: 'other-audience' }, { iss: 'https://other.example.test' }, { nbf: now + 100 }]) {
    state.setPass('payments:checkout', await credential(changes));
    // The shopper can try again; nothing reached Payments.
    assert.equal((await start(state)).result.checkout.state, 'recoverable-failure');
  }
  assert.equal(state.counts.transport, 0);
  assert.equal(state.counts.scheduler, 0);
  // Legitimate standard scope and audience array are accepted; no obsolete array claim.
  state.setPass('payments:checkout', await credential({ aud: ['synthetic-payments', 'other'] }));
  assert.equal((await start(state)).result.checkout.state, 'pending');
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

for (const mode of ['free', 'flat']) test(`compiled default workerd ${mode} shipping retains canonical payment/order replay`, async t => {
  const shipping = { configurationId: 'ship-synthetic', revision: 3, mode,
    ...(mode === 'flat' ? { amount: { currency: 'USD', minor: '50' } } : {}) };
  const state = await runtimeFixture({ config: configuration(shipping) });
  t.after(() => state.close());
  const { token, result } = await start(state);
  assert.equal(result.ok, true);
  assert.equal(state.requests.length, 1);
  const original = structuredClone(state.requests[0]);
  assert.equal(original.total.minor, mode === 'flat' ? '300' : '250');
  assert.equal(original.pricing.merchandiseSubtotal.minor, '250');
  assert.equal(original.pricing.couponDiscount.minor, '0');
  assert.equal(original.pricing.netMerchandise.minor, '250');
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
  assert.equal(state.requests.length, 1);
  assert.equal(state.counts.scheduler, 0);
});

test('real workerd cron wake applies canonical paid order before exact ACK and replay', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  await start(state);
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

test('switching Commerce on registers its 5-minute background check with the site scheduler', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  assert.deepEqual(state.manifest.hooks, ['plugin:activate', 'cron']);
  assert.deepEqual(state.cronTasks(), []);
  await state.plugin.invokeHook('plugin:activate', {});
  const task = [COMMERCE_REGISTRY_RUNTIME_ID, COMMERCE_CHECKOUT_WAKES_TASK, '*/5 * * * *', 1];
  assert.deepEqual(state.cronTasks().map(row => Object.values(row)), [task]);
  // Switching on again, as after re-enabling, keeps one task.
  await state.plugin.invokeHook('plugin:activate', {});
  assert.deepEqual(state.cronTasks().map(row => Object.values(row)), [task]);
  // Checkout itself never schedules anything.
  const scheduled = state.counts.scheduler;
  await start(state);
  assert.equal(state.counts.scheduler, scheduled);
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

// Ship's hosted service as Orders sees it: labels to collect, acknowledgements and orders received.
function shipStandIn() {
  const state = { labels: [], acks: [], sent: [], calls: 0 };
  async function service(url, init) {
    state.calls++;
    assert.equal(await verifyShipPass(new Headers(init.headers).get('authorization')), true);
    const path = new URL(url).pathname;
    if (path === '/v1/labels') return Response.json(state.labels);
    const body = JSON.parse(new TextDecoder().decode(init.body));
    if (path === '/v1/labels/ack') {
      state.acks.push(body.eventId);
      state.labels = state.labels.filter(label => label.eventId !== body.eventId);
      return Response.json({ acknowledged: true });
    }
    assert.equal(path, '/v1/orders');
    state.sent.push(body);
    return Response.json({ received: true });
  }
  return { state, service };
}

async function physicalShipOrder(state) {
  // A physical hat weighing 4.5 oz, bought for delivery in the US.
  const hat = await state.collections.catalog_items.get('hat');
  await state.collections.catalog_items.put('hat', { ...hat, fulfillment: 'physical', weightOz: 4.5 });
  await saveMerchantStoreSettings(state.settings, { expectedRevision: null, storeCountry: 'US' });
  const prepared = await state.invoke(PREPARE);
  const token = prepared.capability.capability;
  const started = await state.invoke(START, { contact: { email: 'shopper@example.test', delivery: syntheticDelivery }, lines: [{ catalogItemId: 'hat', quantity: 2 }] }, token);
  assert.equal(started.ok, true);
  state.setPaid();
  assert.equal((await state.invoke(STATUS, {}, token)).checkout.state, 'paid');
}

const shipAdmin = (state, input) => state.plugin.invokeRoute('admin', input, { url: `${SITE}/_emdash/api/plugins/${state.manifest.id}/admin`,
  method: 'POST', user: { id: 'owner', role: 50 }, ui: { surface: 'admin-page' } });
const shipAgent = (state, input) => state.plugin.invokeRoute('orders', input, { url: `${SITE}/_emdash/api/plugins/${state.manifest.id}/orders`,
  method: 'POST', user: { id: 'agent', role: 50 } });

test('the compiled runtime sends paid orders to Ship, and a label bought in Ship completes its order', async () => {
  const ship = shipStandIn();
  const state = await runtimeFixture({ config: { ...configuration(), ship: SHIP }, shipPass: await shipCredential(), shipService: ship.service });
  try {
    await physicalShipOrder(state);
    // Checkout itself never calls Ship; opening Orders sends the order.
    assert.equal(ship.state.calls, 0);
    // Orders and Ship need only Ship's pass: the Payments pass has expired from here on.
    const now = Math.floor(Date.now() / 1000);
    state.setPass('payments:checkout', await credential({ iat: now - 7200, exp: now - 3600 }));
    await shipAdmin(state, { type: 'page_load', page: '/orders' });
    assert.equal(ship.state.sent.length, 1);
    const [sent] = ship.state.sent;
    const { orderId, ...rest } = sent;
    assert.match(orderId, /^order:/);
    // storeName is the Site title EmDash hands the plugin.
    assert.deepEqual(rest, { schema: 'dinkuskit.commerce.ship-order/v1', number: 1001, version: 1, status: 'processing', test: true,
      shipTo: syntheticDelivery, email: 'shopper@example.test', completed: null, storeName: 'Synthetic fixture',
      lines: [{ catalogItemId: 'hat', name: 'Hat', quantity: 2, unitPrice: { currency: 'USD', minor: '250' }, weightOz: 4.5 }] });
    await shipAdmin(state, { type: 'page_load', page: '/orders' });
    assert.equal(ship.state.sent.length, 1);
    // While it is Processing, the order's page links to Ship's label page for it; opening it calls nothing.
    const open = async () => JSON.stringify(await shipAdmin(state, { type: 'block_action', action_id: 'orders.open:' + encodeURIComponent(orderId) }));
    const calls = ship.state.calls, trades = state.counts.trades;
    assert.ok((await open()).includes(JSON.stringify({ type: 'link', label: 'Create shipping label',
      target: { kind: 'external', url: SHIP.origin + '/stores/synthetic-site/orders/' + encodeURIComponent(orderId) }, appearance: 'primary' })));
    assert.deepEqual([ship.state.calls, state.counts.trades], [calls, trades]);
    // Ship bought a label: the background check completes the order with USPS and the tracking number, then tells Ship.
    ship.state.labels = [{ eventId: 'lbl_synthetic_1', orderId, version: 1, carrier: 'USPS', tracking: '9400 SYNTHETIC' }];
    await state.plugin.invokeHook('cron', { name: COMMERCE_CHECKOUT_WAKES_TASK });
    assert.deepEqual(ship.state.acks, ['lbl_synthetic_1']);
    const kept = await state.collections.orders.get(orderId);
    assert.deepEqual([kept.revision, kept.completed.carrier, kept.completed.tracking, kept.shipVersion], [2, 'USPS', '9400 SYNTHETIC', 2]);
    assert.deepEqual(ship.state.sent.map(order => [order.version, order.status]), [[1, 'processing'], [2, 'completed']]);
    const completed = await open();
    assert.match(completed, /9400 SYNTHETIC/);
    assert.doesNotMatch(completed, /Create shipping label/);
    // An agent's change reaches Ship right away; reading orders does not call Ship.
    const before = ship.state.calls;
    assert.equal((await shipAgent(state, { action: 'list' })).total, 1);
    assert.equal(ship.state.calls, before);
    assert.equal((await shipAgent(state, { action: 'reopen', orderId, version: 2 })).result, 'saved');
    assert.deepEqual([ship.state.sent.at(-1).version, ship.state.sent.at(-1).status, ship.state.sent.at(-1).completed], [3, 'processing', null]);
    // A label list too large to be Ship's is refused before it is used: nothing is acknowledged or completed.
    ship.state.labels = [{ eventId: 'lbl_synthetic_2', orderId, version: 3, carrier: 'USPS', tracking: '9400 ' + 'x'.repeat(140000) }];
    await state.plugin.invokeHook('cron', { name: COMMERCE_CHECKOUT_WAKES_TASK });
    assert.deepEqual([ship.state.acks, (await state.collections.orders.get(orderId)).revision], [['lbl_synthetic_1'], 3]);
  } finally { await state.close(); }
});

test('without a Ship service or a usable Ship pass, Orders calls nothing and keeps working', async () => {
  for (const options of [{}, { config: { ...configuration(), ship: SHIP } }, { config: { ...configuration(), ship: SHIP }, shipPass: await credential() }]) {
    const ship = shipStandIn();
    const state = await runtimeFixture({ ...options, shipService: ship.service });
    try {
      await physicalShipOrder(state);
      const page = JSON.stringify(await shipAdmin(state, { type: 'page_load', page: '/orders' }));
      assert.match(page, /#1001 \(TEST\)/);
      // The label link needs Ship in the settings and a store key; whether Ship takes the key shows only on Ship's page.
      const [{ id }] = (await state.collections.orders.query()).items;
      const detail = JSON.stringify(await shipAdmin(state, { type: 'block_action', action_id: 'orders.open:' + encodeURIComponent(id) }));
      assert.equal(detail.includes('Create shipping label'), options.config !== undefined);
      await state.plugin.invokeHook('cron', { name: COMMERCE_CHECKOUT_WAKES_TASK });
      assert.deepEqual([ship.state.calls, state.counts.ship], [0, 0]);
      assert.equal((await state.collections.orders.query()).items[0].data.shipVersion, undefined);
    } finally { await state.close(); }
  }
});

test('Commerce trades its store key at DinkusKit.com once per call, only for the service the call needs, and sends it nowhere else', async () => {
  const ship = shipStandIn();
  const state = await runtimeFixture({ config: { ...configuration(), ship: SHIP }, shipPass: await shipCredential(), shipService: ship.service });
  try {
    const trade = scope => ({ method: 'POST', url: TRADE_URL, authorization: 'Bearer ' + STORE_KEY, cookie: null,
      contentType: 'application/json', body: { site_id: 'synthetic-site', scope,
        audience: scope === 'ship:orders' ? 'synthetic-ship' : 'synthetic-payments' } });
    // Preparing a checkout needs no service, so nothing is traded.
    const prepared = await state.invoke(PREPARE);
    assert.equal(state.counts.trades, 0);
    // Starting one asks Payments twice (binding, then session) on one traded pass.
    const token = prepared.capability.capability;
    await saveMerchantStoreSettings(state.settings, { expectedRevision: null, storeCountry: 'US' });
    const hat = await state.collections.catalog_items.get('hat');
    await state.collections.catalog_items.put('hat', { ...hat, fulfillment: 'physical', weightOz: 4.5 });
    assert.equal((await state.invoke(START, { contact: { email: 'shopper@example.test', delivery: syntheticDelivery },
      lines: [{ catalogItemId: 'hat', quantity: 1 }] }, token)).checkout.state, 'pending');
    assert.ok(state.counts.transport >= 2);
    assert.deepEqual(state.trades, [trade('payments:checkout')]);
    state.setPaid();
    assert.equal((await state.invoke(STATUS, {}, token)).checkout.state, 'paid');
    assert.deepEqual(state.trades.slice(1), [trade('payments:checkout')]);
    // Opening Orders lists labels and sends the order to Ship on one traded Ship pass.
    ship.state.labels = [];
    await shipAdmin(state, { type: 'page_load', page: '/orders' });
    assert.ok(ship.state.calls >= 2);
    assert.deepEqual(state.trades.slice(2), [trade('ship:orders')]);
    // The background check trades at most once for Payments and once for Ship.
    await state.plugin.invokeHook('cron', { name: COMMERCE_CHECKOUT_WAKES_TASK });
    assert.deepEqual(state.trades.slice(3), [trade('payments:checkout'), trade('ship:orders')]);
    // Payments and Ship got passes only: the key itself went in the five trades and nowhere else.
    assert.deepEqual(state.outbound.filter(request => request.text.includes(STORE_KEY)).map(request => request.url),
      Array(5).fill(TRADE_URL));
    assert.ok(state.outbound.length > 5);
  } finally { await state.close(); }
});

test('the store key goes only to DinkusKit.com even when the checkout settings name Payments, Coupons or Ship as the issuer', async () => {
  for (const origin of [TRANSPORT_ORIGIN, COUPONS_ORIGIN, SHIP.origin]) {
    const ship = shipStandIn();
    const state = await runtimeFixture({ config: { ...configuration(), issuer: origin + '/account', ship: SHIP },
      shipPass: await shipCredential(), shipService: ship.service });
    try {
      // Checkout, Orders and the background check each trade at DinkusKit.com, whose passes do not
      // name the issuer in these settings, so none is used.
      assert.equal((await start(state)).result.checkout.state, 'recoverable-failure');
      await shipAdmin(state, { type: 'page_load', page: '/orders' });
      await state.plugin.invokeHook('cron', { name: COMMERCE_CHECKOUT_WAKES_TASK });
      assert.deepEqual([...new Set(state.trades.map(trade => trade.body.scope))].sort(), ['payments:checkout', 'ship:orders']);
      // Nothing went anywhere else: not to the address the settings named, Payments, Coupons or Ship.
      assert.deepEqual(state.outbound.map(request => request.url), state.trades.map(() => TRADE_URL));
      assert.deepEqual([state.counts.transport, state.counts.ship, ship.state.calls], [0, 0, 0]);
    } finally { await state.close(); }
  }
});

test('a refused trade makes no call: refused or replaced key, service off or cut off, limits, outages, redirects and bad answers', async () => {
  let answer = () => undefined;
  const state = await runtimeFixture({ passService: (url, init, body) => answer(body) });
  try {
    const now = Math.floor(Date.now() / 1000);
    const refusals = [
      () => Response.json({ error: 'invalid_store_key' }, { status: 401 }),
      () => Response.json({ error: 'site_mismatch' }, { status: 403 }),
      () => Response.json({ error: 'service_not_enabled' }, { status: 403 }),
      () => Response.json({ error: 'service_cut_off' }, { status: 403 }),
      () => Response.json({ error: 'store_suspended' }, { status: 403 }),
      () => Response.json({ error: 'rate_limited' }, { status: 429, headers: { 'retry-after': '1' } }),
      () => Response.json({ error: 'signing_unavailable' }, { status: 503 }),
      () => new Response(null, { status: 302, headers: { location: ISSUER_ORIGIN + '/elsewhere' } }),
      () => Response.json({ token_type: 'Bearer', expires_in: 300 }),
      () => new Response('{"access_token":', { headers: { 'content-type': 'application/json' } }),
      async () => Response.json({ access_token: await couponCredential() }),
      async () => Response.json({ access_token: await credential({ iat: now + 60, exp: now + 360 }) }),
    ];
    for (const refusal of refusals) {
      answer = refusal;
      const trades = state.counts.trades;
      assert.equal((await start(state)).result.checkout.state, 'recoverable-failure');
      // One trade, no retry, and nothing reached Payments.
      assert.equal(state.counts.trades, trades + 1);
    }
    assert.equal(state.counts.transport, 0);
    answer = async body => Response.json({ access_token: await credential(), token_type: 'Bearer', expires_in: 300, site_id: body.site_id });
    assert.equal((await start(state)).result.checkout.state, 'pending');
    assert.ok(state.counts.transport >= 2);
  } finally { await state.close(); }
});

test('Replace key on DinkusKit.com stops the old key at once, and without a key checkout stays unavailable', async () => {
  const state = await runtimeFixture();
  try {
    assert.equal((await start(state)).result.checkout.state, 'pending');
    const before = state.counts.transport;
    state.acceptStoreKey('the replacement synthetic key');
    assert.equal((await start(state)).result.checkout.state, 'recoverable-failure');
    assert.equal(state.counts.transport, before);
    // Pasted with a space and a line break around it, the key still trades as itself.
    await state.settings.set('storeKey', ' the replacement synthetic key\n');
    assert.equal((await start(state)).result.checkout.state, 'pending');
    assert.equal(state.trades.at(-1).authorization, 'Bearer the replacement synthetic key');
  } finally { await state.close(); }
  const unset = await runtimeFixture({ storeKey: null });
  try {
    assert.equal((await unset.invoke(PREPARE)).error.code, 'UNAVAILABLE');
    await unset.plugin.invokeHook('cron', { name: COMMERCE_CHECKOUT_WAKES_TASK });
    assert.deepEqual([unset.counts.trades, unset.counts.transport], [0, 0]);
  } finally { await unset.close(); }
});

test('a store upgrading from the three pass settings stays unavailable until it pastes a store key, and its old passes are never sent', async () => {
  const ship = shipStandIn();
  const old = { sub: 'owner-before-the-store-key' };
  const legacyPasses = { installedCheckoutCredential: await credential(old),
    installedCheckoutCouponsCredential: await couponCredential(old), installedShipCredential: await shipCredential(old) };
  const state = await runtimeFixture({ config: { ...configuration(), ship: SHIP }, storeKey: null, legacyPasses,
    shipPass: await shipCredential(), shipService: ship.service });
  try {
    // The old passes are still saved, but Commerce no longer reads them.
    assert.equal((await state.invoke(PREPARE)).error.code, 'UNAVAILABLE');
    assert.match(JSON.stringify(await shipAdmin(state, { type: 'page_load', page: '/orders' })), /No orders recorded yet/);
    await state.plugin.invokeHook('cron', { name: COMMERCE_CHECKOUT_WAKES_TASK });
    assert.deepEqual([state.counts.trades, state.outbound.length, ship.state.calls], [0, 0, 0]);
    // Pasting the key DinkusKit.com made for the store is all it takes.
    await state.settings.set('storeKey', STORE_KEY);
    state.acceptStoreKey(STORE_KEY);
    assert.equal((await start(state)).result.checkout.state, 'pending');
    await shipAdmin(state, { type: 'page_load', page: '/orders' });
    assert.ok(state.counts.transport >= 2 && ship.state.calls >= 1);
    for (const pass of Object.values(legacyPasses)) assert.ok(state.outbound.every(request => !request.text.includes(pass)));
  } finally { await state.close(); }
});

test('country-rejected start recovers through read-only prepared status on the same capability', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  const item = await state.collections.catalog_items.get('hat');
  await state.collections.catalog_items.put('hat', { ...item, fulfillment: 'physical' });
  const prepared = await state.invoke(PREPARE);
  const token = prepared.capability.capability;
  const input = { ...basket, contact: { ...basket.contact, delivery: syntheticDelivery } };
  const rejected = await state.invoke(START, input, token);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'INVALID_CART');
  assert.equal(rejected.error.message, 'The store does not ship to this country');
  assert.equal((await state.cartRecords()).length, 0);
  assert.equal((await state.collections.checkout_payment_associations.query()).items.length, 0);
  assert.equal(state.requests.length, 0);
  await saveMerchantStoreSettings(state.settings, {
    expectedRevision: null, storeCountry: 'US', sellingCountries: ['US'], shippingCountries: ['US'],
  });
  const before = { ...state.counts };
  const capabilities = (await state.collections.checkout_guest_capabilities.query()).items;
  const status = await state.invoke(STATUS, {}, token);
  assert.equal(status.ok, true);
  assert.equal(status.capabilityId, prepared.capabilityId);
  assert.deepEqual(status.checkout, prepared.checkout);
  assert.deepEqual({ ...state.counts, credentials: 0 }, { ...before, credentials: 0 });
  assert.deepEqual((await state.collections.checkout_guest_capabilities.query()).items, capabilities);
  assert.equal((await state.cartRecords()).length, 0);
  const started = await state.invoke(START, input, token);
  assert.equal(started.ok, true);
  assert.equal(started.checkout.state, 'pending');
  assert.notEqual(started.checkout.attemptId, null);
  assert.equal((await state.cartRecords())[0].attempts.length, 1);
  assert.equal(state.requests.length, 1);
});
