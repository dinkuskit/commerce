// This SDK uses one workerd port; keep the readiness and service cases in one test process.
import './registry-checkout-readiness-cases.mjs';
import './shopper-accounts-runtime-cases.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import test from 'node:test';
import BetterSqlite3 from 'better-sqlite3';
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
  connectionFor,
  TRADE_URL,
  TRANSPORT_ORIGIN,
  verifyCouponPass,
  verifyShipPass,
} from '../features/checkout/registry-runtime.mjs';
import { couponCollection } from '../features/checkout/pricing-fixture.mjs';
import { couponServiceFake } from '../features/checkout/coupon-service-fake.mjs';
import { createCouponAdmin } from '../../dist/features/coupons/index.js';
import {
  BACKGROUND_CHECK_REGISTER_BUDGET_MS,
  COMMERCE_CHECKOUT_WAKES_TASK,
  COMMERCE_REGISTRY_RUNTIME_ID,
} from '../../dist/features/checkout/index.js';

const PREPARE = 'checkout/guest/prepare', START = 'checkout/guest/start', STATUS = 'checkout/guest/status';
const basket = { contact: { email: 'shopper@example.test', billing: { name: 'Bill Payer', line1: '9 Billing Way', city: 'Billtown', postalCode: '00009', country: 'US' } }, lines: [{ catalogItemId: 'hat', quantity: 1 }] };

// Checkout schedules nothing of its own: the site scheduler holds only the 5-minute background
// check, which the first request registers when switching on did not.
const BACKGROUND_CHECK = [COMMERCE_REGISTRY_RUNTIME_ID, COMMERCE_CHECKOUT_WAKES_TASK, '*/5 * * * *', 1];
function assertOnlyBackgroundCheck(state) {
  assert.deepEqual(state.cronTasks().map(row => Object.values(row)), [BACKGROUND_CHECK]);
}

async function start(state, input = basket) {
  const prepared = await state.invoke(PREPARE);
  assert.equal(prepared.ok, true);
  const token = prepared.capability.capability;
  return { token, result: await state.invoke(START, input, token) };
}

for (const ready of [false, null, 'false', 'true']) {
  test(`compiled Registry creation refuses ready=${JSON.stringify(ready)} before session POST`, async t => {
    const state = await runtimeFixture();
    t.after(() => state.close());
    const config = configuration();
    const calls = [];
    state.setTransportOverride((path, init) => {
      calls.push([path, init.method]);
      if (path === '/v1/checkout-binding') return Response.json({
        bindingRef: config.bindingRef, providerId: config.providerId,
        stripeAccountId: config.stripeAccountId, mode: 'test', ready,
      });
      return Response.json({ outcome: 'not-created' });
    });
    await start(state);
    assert.deepEqual(calls, [['/v1/checkout-binding', 'GET']]);
    const attempts = (await state.cartRecords()).flatMap(cart => cart.attempts);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].session, undefined);
    assert.equal(attempts[0].order, undefined);
    assert.equal((await state.collections.orders.query()).items.length, 0);
  });
}

const productPanelUi = entryId => ({ surface: 'content-editor-panel', locale: 'en', direction: 'ltr', extensionId: 'product', entry: { collection: 'products', id: entryId, locale: null, version: 1 } });

test('actual compiled default workerd profile preserves empty-grants/unconfigured admission', async t => {
  const state = await runtimeFixture({ grants: false, config: null, token: null, storeKey: null });
  t.after(() => state.close());
  assert.equal(state.manifest.id, COMMERCE_REGISTRY_RUNTIME_ID);
  assert.deepEqual(state.artifact.capabilities, ['admin.editor-draft:read', 'media:read', 'network:request', 'email:send']);
  assert.deepEqual(state.artifact.allowedHosts, ['payments.dinkuskit.com', 'coupons.dinkuskit.com', 'ship.dinkuskit.com', 'dinkuskit.com']);
  const { result } = await start(state);
  assert.equal(result.error.code, 'PAYMENTS_UNAVAILABLE');
  await state.plugin.invokeHook('cron', { name: COMMERCE_CHECKOUT_WAKES_TASK });
  // The background check looks once for the key Connect saves and, finding none, sends nothing.
  assert.equal(state.counts.credentials, 1);
  assert.equal(state.counts.trades, 0);
  assert.equal(state.counts.transport, 0);
  assertOnlyBackgroundCheck(state);
  assert.deepEqual(await state.cartRecords(), []);
});

test('EmDash 1.4 SDK storage preserves checkout records across runtime restart without reseed', async t => {
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
  assertOnlyBackgroundCheck(state);
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
  assertOnlyBackgroundCheck(state);
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

test('EmDash 1.4 original storage shares admin prices, storefront helpers and canonical checkout', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  const prepared = await state.invoke(PREPARE);
  assert.equal(prepared.ok, true);
  // Invoke the compiled admin handler on its original owner storage. Actual
  // HTTP admin authorization is separately exercised by the browser suite.
  const saved = await state.plugin.invokeRoute('product-panel', {
    type: 'form_submit', action_id: 'save:hat',
    values: { regular: '4.00', sale: '3.00', stockStatus: 'in-stock' },
  }, { url: `${SITE}/_emdash/api/content/products/page-hat/plugin-extensions/${state.manifest.id}/panel/product`, method: 'POST', ui: productPanelUi('page-hat') });
  assert.equal(saved.toast.type, 'success');
  const c = state.collections;
  const price = await resolveCatalogItemPrice(c.catalog_prices, 'hat', c.catalog_items);
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

test('public installed catalog reads an admin-created product, feed eligibility and canonical order', async t => {
  const directory = await mkdtemp('/tmp/commerce-public-catalog-restart-');
  const databasePath = join(directory, 'runtime.db');
  let state = await runtimeFixture({ seed: false, databasePath });
  t.after(async () => { await state.close(); await rm(directory, { recursive: true, force: true }); });
  // Products are made from their page's Dinkus Commerce panel and go on sale when the store publishes that page.
  const admin = input => state.plugin.invokeRoute('product-panel', input, { url: `${SITE}/_emdash/api/content/products/page-public-hat/plugin-extensions/${state.manifest.id}/panel/product`, method: 'POST', ui: productPanelUi('page-public-hat') });
  const created = await admin({ type: 'form_submit', action_id: 'sell', values: { sku: 'PUBLIC-HAT' }, draft: { fields: { title: 'Public Hat' } } });
  assert.equal(created.toast.type, 'success');
  const products = (await state.collections.catalog_items.query()).items.filter(row => row.data.recordKind === 'catalog-item');
  assert.equal(products.length, 1);
  const id = products[0].id;
  assert.equal(created.patch, undefined, 'the page is never patched; Commerce holds its link');
  // The publish check sends the page alone, and Commerce finds the product it links.
  assert.deepEqual(await state.plugin.invokeRoute('catalog-items/set-on-sale', { entryId: 'page-public-hat', onSale: true },
    { url: `${SITE}/_emdash/api/plugins/${state.manifest.id}/catalog-items/set-on-sale`, method: 'POST' }), { changed: true });
  assert.equal((await admin({ type: 'form_submit', action_id: 'save:' + id, values: { regular: '4.00', sale: '3.00', stockStatus: 'in-stock' } })).toast.type, 'success');
  const publicList = () => state.plugin.invokeRoute('catalog/public', {}, { url: `${SITE}/_emdash/api/plugins/${state.manifest.id}/catalog/public`, method: 'GET' });
  const publicItem = (query = `itemId=${id}`) => state.plugin.invokeRoute('catalog/public/item', {}, { url: `${SITE}/_emdash/api/plugins/${state.manifest.id}/catalog/public/item?${query}`, method: 'GET' });
  const catalog = await publicList();
  // Add price and stock makes a physical product, which carries its one-member variant group.
  const { variants } = catalog.products[0] ?? {};
  assert.deepEqual(variants?.members.map(member => [member.catalogItemId, member.fulfillment]), [[id, 'physical']]);
  const expectedProduct = { id, name: 'Public Hat', sku: 'PUBLIC-HAT', price: { currency: 'USD', minor: '300' }, availability: { status: 'in-stock', sellable: true, listable: true }, image: null, gallery: [], feedChannels: [], page: 'page-public-hat', variants };
  assert.deepEqual(catalog, { products: [expectedProduct] });
  assert.deepEqual(await publicItem(), expectedProduct);
  assert.deepEqual(await publicItem('pageId=page-public-hat'), expectedProduct, 'the storefront finds a product by its page');
  assert.equal(await publicItem('pageId=page-other'), null);
  await assert.rejects(publicItem(`pageId=page-public-hat&itemId=${id}`));
  for (const enabled of [true, false]) {
    const saved = await admin({ type: 'form_submit', action_id: 'save:' + id, values: {
      regular: '4.00', sale: '3.00', stockStatus: 'in-stock',
      'feed:google-merchant': enabled, 'feed:meta-catalog': enabled,
    } });
    assert.equal(saved.toast.type, 'success');
    const channels = enabled ? ['google-merchant', 'meta-catalog'] : [];
    assert.deepEqual((await state.collections.catalog_items.get(id)).catalogData.feedChannels, channels);
    assert.deepEqual(await publicList(), { products: [{ ...expectedProduct, feedChannels: channels }] });
    assert.deepEqual(await publicItem(), { ...expectedProduct, feedChannels: channels });
  }
  // An admin-created product has no fulfillment mark, so it counts as physical and needs a US address.
  await saveMerchantStoreSettings(state.settings, { expectedRevision: null, storeCountry: 'US' });
  const input = { contact: { email: 'shopper@example.test', delivery: syntheticDelivery, billing: { name: 'Bill Payer', line1: '9 Billing Way', city: 'Billtown', postalCode: '00009', country: 'US' } }, lines: [{ catalogItemId: catalog.products[0].id, quantity: 2 }] };
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
  assert.deepEqual(await publicList(), { products: [expectedProduct] });
  assert.deepEqual(await publicItem(), expectedProduct);
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


test('a store still saving the retired isolated Ship TEST profile keeps checkout and sends nothing to Ship', async () => {
  const retired = { origin: 'https://ship.sm0ky.dev', audience: 'dinkus-ship-sandbox', recipient: 'ship-sandbox', generation: 'fixture-generation-1', mode: 'test' };
  const ship = shipStandIn();
  const state = await runtimeFixture({ config: { ...configuration(), ship: retired }, shipPass: await credential(), shipService: ship.service });
  try {
    assert.equal((await start(state)).result.checkout.state, 'pending');
    await physicalShipOrder(state);
    const [{ id }] = (await state.collections.orders.query()).items;
    const pinned = await state.collections.orders.get(id);
    await state.collections.orders.put(id, { ...pinned, shipPin: { recipient: retired.recipient, generation: retired.generation, site: 'site', enabled: true } });
    const page = JSON.stringify(await shipAdmin(state, { type: 'page_load', page: '/orders' }));
    assert.match(page, /\(TEST\)/);
    const detail = JSON.stringify(await shipAdmin(state, { type: 'block_action', action_id: 'orders.open:' + encodeURIComponent(id) }));
    assert.equal(detail.includes('Create shipping label'), false);
    await state.plugin.invokeHook('cron', { name: COMMERCE_CHECKOUT_WAKES_TASK });
    assert.deepEqual([ship.state.calls, state.counts.ship], [0, 0]);
    assert.ok(state.outbound.every(request => new URL(request.url).hostname !== 'ship.sm0ky.dev'));
    const kept = await state.collections.orders.get(id);
    assert.deepEqual([kept.shipPin.enabled, kept.shipVersion, kept.completed], [true, undefined, undefined]);
  } finally { await state.close(); }
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
  assertOnlyBackgroundCheck(state);
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
  assertOnlyBackgroundCheck(state);
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
  assertOnlyBackgroundCheck(state);
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
  assertOnlyBackgroundCheck(state);
});

test('switching Commerce on registers its 5-minute background check with the site scheduler', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  // EmDash stops a hook after 5 seconds unless the manifest says otherwise; the check needs longer to reach Ship.
  assert.deepEqual(state.manifest.hooks, ['plugin:activate', { name: 'cron', timeout: 25000 }]);
  assert.deepEqual(state.cronTasks(), []);
  await state.plugin.invokeHook('plugin:activate', {});
  assertOnlyBackgroundCheck(state);
  // Switching on again, as after re-enabling, keeps one task.
  await state.plugin.invokeHook('plugin:activate', {});
  assertOnlyBackgroundCheck(state);
  // Once the task is registered, checkout never touches the scheduler.
  const scheduled = state.counts.scheduler;
  await start(state);
  assert.equal(state.counts.scheduler, scheduled);
});

// The site scheduler runs the task it holds: the cron hook gets the registered row's task name.
async function runScheduledCheck(state) {
  const [row] = state.cronTasks();
  assert.ok(row, 'the background check is registered');
  await state.plugin.invokeHook('cron', { name: row.task_name });
}

test('when the scheduler refuses at switch-on, the next request registers the background check, which then settles payments and Ship', async t => {
  const ship = shipStandIn();
  const state = await runtimeFixture({ config: { ...configuration(), ship: SHIP }, shipPass: await shipCredential(), shipService: ship.service });
  t.after(() => state.close());
  state.setSchedulerFault(() => { throw new Error('synthetic scheduler outage'); });
  // EmDash sees switching on succeed; nothing is scheduled yet.
  await state.plugin.invokeHook('plugin:activate', {});
  assert.deepEqual(state.cronTasks(), []);
  state.setSchedulerFault(null);
  // The next request registers the task, without anyone switching Commerce off and on.
  const hat = await state.collections.catalog_items.get('hat');
  await state.collections.catalog_items.put('hat', { ...hat, fulfillment: 'physical', weightOz: 4.5 });
  await saveMerchantStoreSettings(state.settings, { expectedRevision: null, storeCountry: 'US' });
  const prepared = await state.invoke(PREPARE);
  assertOnlyBackgroundCheck(state);
  // Later requests leave the scheduler alone.
  const scheduled = state.counts.scheduler;
  const started = await state.invoke(START, { contact: { email: 'shopper@example.test', delivery: syntheticDelivery, billing: { name: 'Bill Payer', line1: '9 Billing Way', city: 'Billtown', postalCode: '00009', country: 'US' } },
    lines: [{ catalogItemId: 'hat', quantity: 1 }] }, prepared.capability.capability);
  assert.equal(started.ok, true);
  assert.equal(state.counts.scheduler, scheduled);
  // The shopper pays and never comes back: the scheduled check settles the payment and sends the order to Ship.
  state.setPaid();
  state.setWakes([{ eventId: 'evt_SYNTHETIC', attemptId: state.requests[0].attemptId,
    bindingRef: configuration().bindingRef, deliveryGeneration: 1, wokeAt: Date.now() }]);
  await runScheduledCheck(state);
  assert.equal(state.counts.acknowledgments, 1);
  const attempt = (await state.cartRecords())[0].attempts[0];
  assert.equal(attempt.phase, 'paid');
  assert.deepEqual(ship.state.sent.map(order => [order.orderId, order.status]), [[attempt.order.orderId, 'processing']]);
  // The merchant buys a label in Ship and leaves Commerce closed: the next check completes the order.
  ship.state.labels = [{ eventId: 'lbl_synthetic_1', orderId: attempt.order.orderId, version: 1, carrier: 'USPS', tracking: '9400 SYNTHETIC' }];
  await runScheduledCheck(state);
  assert.deepEqual(ship.state.acks, ['lbl_synthetic_1']);
  assert.equal((await state.collections.orders.get(attempt.order.orderId)).completed.tracking, '9400 SYNTHETIC');
  assert.equal(state.counts.scheduler, scheduled);
  assertOnlyBackgroundCheck(state);
});

test('a stalled scheduler holds neither switch-on nor a request past the budget, and its late answer leaves one task', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  let release;
  const stalled = new Promise(resolve => { release = resolve; });
  state.setSchedulerFault(() => stalled);
  const timed = async run => { const began = Date.now(); const result = await run(); return { result, ms: Date.now() - began }; };
  const activated = await timed(() => state.plugin.invokeHook('plugin:activate', {}));
  assert.ok(activated.ms >= BACKGROUND_CHECK_REGISTER_BUDGET_MS - 100 && activated.ms < BACKGROUND_CHECK_REGISTER_BUDGET_MS + 1500, String(activated.ms));
  // The first request waits no longer than the budget, and still answers.
  const first = await timed(() => state.invoke(PREPARE));
  assert.equal(first.result.ok, true);
  assert.ok(first.ms < BACKGROUND_CHECK_REGISTER_BUDGET_MS + 1500, String(first.ms));
  // Requests in the next minute leave the stalled scheduler alone.
  const second = await timed(() => state.invoke(PREPARE));
  assert.equal(second.result.ok, true);
  assert.ok(second.ms < BACKGROUND_CHECK_REGISTER_BUDGET_MS - 1000, String(second.ms));
  assert.deepEqual(state.cronTasks(), []);
  // The scheduler answers late: the stalled calls finish safely with one task.
  state.setSchedulerFault(null);
  release();
  for (let tries = 0; tries < 50 && state.cronTasks().length === 0; tries++) await new Promise(resolve => setTimeout(resolve, 20));
  assertOnlyBackgroundCheck(state);
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
  const started = await state.invoke(START, { contact: { email: 'shopper@example.test', delivery: syntheticDelivery, billing: { name: 'Bill Payer', line1: '9 Billing Way', city: 'Billtown', postalCode: '00009', country: 'US' } }, lines: [{ catalogItemId: 'hat', quantity: 2 }] }, token);
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
        audience: scope === 'ship:orders' ? 'synthetic-ship' : scope === 'commerce:settings' ? 'dinkuskit' : 'synthetic-payments' } });
    // Preparing a checkout needs no service, so nothing is traded.
    const prepared = await state.invoke(PREPARE);
    assert.equal(state.counts.trades, 0);
    // Starting one asks Payments twice (binding, then session) on one traded pass.
    const token = prepared.capability.capability;
    await saveMerchantStoreSettings(state.settings, { expectedRevision: null, storeCountry: 'US' });
    const hat = await state.collections.catalog_items.get('hat');
    await state.collections.catalog_items.put('hat', { ...hat, fulfillment: 'physical', weightOz: 4.5 });
    assert.equal((await state.invoke(START, { contact: { email: 'shopper@example.test', delivery: syntheticDelivery, billing: { name: 'Bill Payer', line1: '9 Billing Way', city: 'Billtown', postalCode: '00009', country: 'US' } },
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
    // The background check fetches the checkout settings, then trades at most once for Payments and once for Ship.
    await state.plugin.invokeHook('cron', { name: COMMERCE_CHECKOUT_WAKES_TASK });
    assert.deepEqual(state.trades.slice(3), [trade('commerce:settings'), trade('payments:checkout'), trade('ship:orders')]);
    // Payments and Ship got passes only: the key itself went in the six trades and nowhere else.
    assert.deepEqual(state.outbound.filter(request => request.text.includes(STORE_KEY)).map(request => request.url),
      Array(6).fill(TRADE_URL));
    assert.ok(state.outbound.length > 6);
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
      assert.deepEqual([...new Set(state.trades.map(trade => trade.body.scope))].sort(), ['commerce:settings', 'payments:checkout', 'ship:orders']);
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

test('Connect again on DinkusKit.com stops the old key at once, and without a key checkout stays unavailable', async () => {
  const state = await runtimeFixture();
  const replacement = 'dk_store_' + 'r'.repeat(43);
  try {
    assert.equal((await start(state)).result.checkout.state, 'pending');
    const before = state.counts.transport;
    state.acceptStoreKey(replacement);
    assert.equal((await start(state)).result.checkout.state, 'recoverable-failure');
    assert.equal(state.counts.transport, before);
    // The key Connect again saved trades as itself; a key saved for another store is never used.
    await state.settings.set('connection', connectionFor(replacement, 'another-site'));
    assert.equal((await state.invoke(PREPARE)).ok, false);
    assert.equal(state.trades.at(-1).authorization, 'Bearer ' + STORE_KEY);
    await state.settings.set('connection', connectionFor(replacement));
    assert.equal((await start(state)).result.checkout.state, 'pending');
    assert.equal(state.trades.at(-1).authorization, 'Bearer ' + replacement);
  } finally { await state.close(); }
  const unset = await runtimeFixture({ storeKey: null });
  try {
    assert.equal((await unset.invoke(PREPARE)).error.code, 'UNAVAILABLE');
    await unset.plugin.invokeHook('cron', { name: COMMERCE_CHECKOUT_WAKES_TASK });
    assert.deepEqual([unset.counts.trades, unset.counts.transport], [0, 0]);
  } finally { await unset.close(); }
});

test('a store upgrading from the three pass settings stays unavailable until it connects, and its old passes are never sent', async () => {
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
    // The key Connect brings is all it takes.
    await state.settings.set('connection', connectionFor(STORE_KEY));
    state.acceptStoreKey(STORE_KEY);
    assert.equal((await start(state)).result.checkout.state, 'pending');
    await shipAdmin(state, { type: 'page_load', page: '/orders' });
    assert.ok(state.counts.transport >= 2 && ship.state.calls >= 1);
    for (const pass of Object.values(legacyPasses)) assert.ok(state.outbound.every(request => !request.text.includes(pass)));
  } finally { await state.close(); }
});

test('a store upgrading from 0.4.0 keeps its catalog and saved checkout settings, never sends its pasted key, and works again after Connect', async () => {
  const ship = shipStandIn();
  // What 0.4.0 saved: the key pasted into its "storeKey" secret setting, and the pasted checkout settings.
  const pasted = 'dk_store_' + 'p'.repeat(43);
  const state = await runtimeFixture({ config: { ...configuration(), ship: SHIP }, storeKey: null, legacyPasses: { storeKey: pasted },
    shipPass: await shipCredential(), shipService: ship.service });
  try {
    state.acceptStoreKey(pasted);
    assert.equal((await state.invoke(PREPARE)).error.code, 'UNAVAILABLE');
    assert.match(JSON.stringify(await shipAdmin(state, { type: 'page_load', page: '/orders' })), /No orders recorded yet/);
    await state.plugin.invokeHook('cron', { name: COMMERCE_CHECKOUT_WAKES_TASK });
    assert.deepEqual([state.counts.trades, state.outbound.length, ship.state.calls], [0, 0, 0], 'the pasted key is never traded, even though DinkusKit.com would still take it');
    assert.equal(JSON.parse(await state.settings.get('installedCheckout')).ship.origin, SHIP.origin, 'the saved checkout settings are kept');
    assert.equal((await state.collections.catalog_items.get('hat')).name, 'Hat', 'the catalog is kept');
    // Connect saves Commerce's own key; checkout and Ship work again on it alone.
    await state.settings.set('connection', connectionFor(STORE_KEY));
    state.acceptStoreKey(STORE_KEY);
    assert.equal((await start(state)).result.checkout.state, 'pending');
    await shipAdmin(state, { type: 'page_load', page: '/orders' });
    assert.ok(state.counts.transport >= 2 && ship.state.calls >= 1);
    assert.ok(state.trades.every(trade => trade.authorization === 'Bearer ' + STORE_KEY));
    assert.ok(state.outbound.every(request => !request.text.includes(pasted)));
  } finally { await state.close(); }
});

test('Connect through the compiled runtime saves the approved key encrypted, and a key arriving late for a cancelled Connect is never saved or used', async t => {
  const dir = await mkdtemp('/tmp/commerce-connect-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const database = join(dir, 'site.db');
  const approved = 'dk_store_' + 'a'.repeat(43), late = 'dk_store_' + 'l'.repeat(43);
  // A stand-in DinkusKit.com: Connect start, the token exchange (held open when a test asks), passes and checkout settings.
  const seen = [], proofs = [];
  let flows = 0, hold = null, answer = null;
  const body = init => init.body === undefined ? '' : typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body);
  const state = await runtimeFixture({ databasePath: database, config: null, storeKey: null, transportFetch: async (url, init) => {
    const text = body(init), path = new URL(url).pathname, headers = new Headers(init.headers);
    seen.push({ path, authorization: headers.get('authorization'), text });
    assert.equal(new URL(url).origin, ISSUER_ORIGIN);
    if (path === '/api/store-connections') {
      const request = JSON.parse(text), id = 'connection-' + ++flows;
      assert.deepEqual([request.protocol_version, request.client_id, request.service, request.site_origin, request.code_challenge_method],
        [2, 'dinkus-commerce-emdash', 'commerce', SITE, 'S256']);
      return Response.json({ protocol_version: 2, site_id: 'synthetic-site', connection_id: id, challenge: 'challenge-' + id,
        expires_at: Date.now() + 300_000, interval: 5, verification_uri: `${ISSUER_ORIGIN}/account/connect?connection_id=${id}` });
    }
    if (path === '/api/store-connections/token') {
      if (hold) await hold;
      return answer ? Response.json(answer) : Response.json({ error: 'authorization_pending' }, { status: 400 });
    }
    if (path === '/api/store-passes') return Response.json({ access_token: 'pass-for-' + headers.get('authorization').slice(-4), token_type: 'Bearer', expires_in: 300 });
    if (path === '/api/commerce-settings') return new Response(JSON.stringify(configuration()), { headers: { 'content-type': 'application/json' } });
    return assert.fail('unexpected DinkusKit.com call ' + path);
  } });
  t.after(() => state.close());
  const press = action_id => shipAdmin(state, { type: 'block_action', action_id });
  const proof = async connection => {
    const response = await state.plugin.invokeRoute('store-proof', { connection_id: connection },
      { url: `${SITE}/_emdash/api/plugins/${state.manifest.id}/store-proof?connection_id=${connection}`, method: 'GET' });
    proofs.push(response);
    return response.status;
  };
  const saved = async () => JSON.parse(await state.settings.get('connection') ?? '{}');
  const sqlite = new BetterSqlite3(database, { readonly: true });
  t.after(() => sqlite.close());
  const raw = () => sqlite.prepare('SELECT value FROM options').all().map(row => row.value).join('\n');

  // Allowed: Connect, the owner approves, Check saves the key in the encrypted setting and fetches the checkout settings with it.
  assert.match(JSON.stringify(await press('connect')), /Approve at DinkusKit.com/);
  assert.equal(await proof('connection-1'), 200, 'DinkusKit.com can read the waiting Connect');
  answer = { site_id: 'synthetic-site', store_key: approved };
  assert.match(JSON.stringify(await press('connect.check')), /Checkout settings are up to date/);
  assert.equal((await saved()).storeKey, approved);
  assert.equal((await saved()).flow, undefined);
  assert.ok(!raw().includes(approved), 'the key is stored encrypted, never as plain text');
  assert.equal(JSON.parse(await state.settings.get('installedCheckout')).siteId, 'synthetic-site');
  assert.equal(seen.find(call => call.path === '/api/store-passes').authorization, 'Bearer ' + approved);
  assert.equal(await proof('connection-1'), 404, 'a finished Connect is no longer vouched for');

  // Revoked while DinkusKit.com answers: Connect again, Check is held open, Cancel lands, then a key arrives for the cancelled Connect.
  answer = null;
  await press('connect');
  assert.equal(await proof('connection-2'), 200);
  let release;
  hold = new Promise(resolve => { release = resolve; });
  const checking = press('connect.check');
  while (!seen.some(call => call.path === '/api/store-connections/token' && call.text.includes('connection-2'))) await new Promise(r => setTimeout(r, 10));
  assert.match(JSON.stringify(await press('connect.cancel')), /Connected to DinkusKit.com, store synthetic-site/);
  assert.equal(await proof('connection-2'), 404, 'a cancelled Connect is not vouched for');
  answer = { site_id: 'synthetic-site', store_key: late };
  release();
  assert.doesNotMatch(JSON.stringify(await checking), new RegExp(late));
  hold = null;
  assert.equal((await saved()).storeKey, approved, 'the key from before Connect again is kept');
  assert.equal((await saved()).flow, undefined);
  assert.ok(!raw().includes(late));
  // The rejected key is never used: the next fetch and the background check trade only the approved key.
  const from = seen.length;
  await press('connect.refresh');
  await state.plugin.invokeHook('cron', { name: COMMERCE_CHECKOUT_WAKES_TASK }).catch(() => {});
  const after = seen.slice(from).filter(call => call.path === '/api/store-passes');
  assert.ok(after.length >= 1);
  assert.ok(after.every(call => call.authorization === 'Bearer ' + approved));
  assert.ok(seen.every(call => call.authorization !== 'Bearer ' + late && !call.text.includes(late)), 'the late key is never sent anywhere');
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


test('compiled Registry invocation cannot POST a fresh order after Ship connection settings switch',async()=>{
 let state,posts=0,lists=0;
 const moved={origin:'https://ship.example.test',audience:'dinkus-ship'};
 state=await runtimeFixture({config:{...configuration(),ship:SHIP},shipPass:await shipCredential(),shipService:async(url)=>{
   if(new URL(url).pathname!=='/v1/labels'){posts++;return Response.json({received:true})}
   lists++;await state.settings.set('installedCheckout',JSON.stringify({...configuration(),ship:moved}));
   await state.collections.orders.put('fixture-unpinned',{paidOrder:{schema:'dinkuskit.commerce.paid-order/v1',orderId:'fixture-unpinned',receiptId:'fixture-receipt',attemptId:'fixture-attempt',mode:'test',lines:[{catalogItemId:'hat',name:'Hat',quantity:1,unitPrice:{currency:'USD',minor:'250'}}],total:{currency:'USD',minor:'250'},contactSnapshot:{schema:'dinkuskit.commerce.checkout-contact/v1',requirePhoneNumber:false,revision:null,contact:{email:'fixture@example.test',delivery:syntheticDelivery}}},number:1002,revision:1});
   return Response.json([]);
 }});
 try{await shipAdmin(state,{type:'page_load',page:'/orders'});assert.equal(lists,1);assert.equal(posts,0);const fresh=await state.collections.orders.get('fixture-unpinned');assert.equal(fresh.shipPin,undefined);assert.equal(fresh.shipVersion,undefined);assert.equal(fresh.revision,1)}finally{await state.close()}
});


async function preparedBetaArtifact(t) {
  const root = await mkdtemp('/tmp/commerce-beta-package-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.tmp/sandbox-source/src'), { recursive: true });
  for (const file of ['package.json', 'emdash-plugin.jsonc']) {
    const value = JSON.parse(await readFile(resolve('.tmp/sandbox-source', file), 'utf8'));
    value.version = '0.3.0-beta.0';
    const source = JSON.stringify(value, null, 2) + '\n';
    await writeFile(join(root, file), source);
    await writeFile(join(root, '.tmp/sandbox-source', file), source);
  }
  await copyFile(resolve('.tmp/sandbox-source/src/plugin.ts'), join(root, '.tmp/sandbox-source/src/plugin.ts'));
  const { stageRegistryListing } = await import('../../scripts/stage-registry-listing.mjs');
  await stageRegistryListing(resolve('.tmp/sandbox-source'), join(root, '.tmp/sandbox-source'));
  execFileSync(process.execPath, [resolve('scripts/prepare-emdash-release.mjs'), 'dinkus-commerce-beta@0.3.0-beta.0'], { cwd: root, stdio: 'pipe' });
  const archive = join(root, '.emdash-release/dinkus-commerce-beta-0.3.0-beta.0.tar.gz');
  const manifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'manifest.json'], { encoding: 'utf8' }));
  const backend = execFileSync('tar', ['-xOf', archive, 'backend.js'], { encoding: 'utf8' });
  assert.equal(manifest.id, 'dinkus-commerce-beta');
  assert.equal(manifest.version, '0.3.0-beta.0');
  const shipped = JSON.parse(await readFile(resolve('dist/sandbox/manifest.json'), 'utf8'));
  assert.deepEqual(manifest.capabilities, shipped.capabilities);
  assert.deepEqual(manifest.allowedHosts, shipped.allowedHosts);
  assert.deepEqual(manifest.storage, shipped.storage);
  assert.equal(createHash('sha256').update(backend).digest('hex'), createHash('sha256').update(await readFile(resolve('dist/sandbox/plugin.mjs'))).digest('hex'));
  return { manifest, backend };
}

test('prepared beta package uses its own installed namespace and declared Payments grants', async t => {
  const beta = await preparedBetaArtifact(t);
  const config = { ...configuration(), paymentsOrigin: 'https://payments.dinkuskit.com' };
  const state = await runtimeFixture({ owner: 'r_fjzjvld3ssb4j63o', grants: false, config,
    artifactManifest: beta.manifest, backendSource: beta.backend });
  t.after(() => state.close());
  assert.deepEqual(state.manifest.allowedHosts, beta.manifest.allowedHosts);
  assert.equal((await state.invokeReadiness()).status, 'supported');
  const { result, token } = await start(state);
  assert.equal(result.ok, true);
  assert.equal(state.requests.length, 1);
  state.setPaid();
  assert.equal((await state.invoke(STATUS, {}, token)).checkout.state, 'paid');
  assert.equal((await state.cartRecords()).length, 1);
});

test('unknown and unregistered beta IDs fail before service contact', async () => {
  for (const owner of ['r_fjzjvld3ssb4j63x', 'r_arbitraryplugin0', 'dinkus-commerce-beta']) {
    const state = await runtimeFixture({ owner });
    try {
      assert.equal((await state.invokeReadiness()).status, 'unavailable');
      assert.equal((await state.invoke(PREPARE)).error.code, 'UNAVAILABLE');
      assert.equal(state.counts.trades, 0);
      assert.equal(state.counts.transport, 0);
    } finally { await state.close(); }
  }
});

test('beta installation does not inherit stable storage or settings', async t => {
  const directory = await mkdtemp('/tmp/commerce-beta-isolation-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'runtime.db');
  const stable = await runtimeFixture({ databasePath });
  try { assert.equal((await start(stable)).result.ok, true); }
  finally { await stable.close(); }
  const beta = await runtimeFixture({ databasePath, owner: 'r_fjzjvld3ssb4j63o', seed: false, config: null, storeKey: null });
  try {
    assert.deepEqual(await beta.cartRecords(), []);
    assert.equal(await beta.collections.catalog_items.get('hat'), null);
    assert.equal(await beta.settings.get('connection'), null);
    assert.equal((await beta.invokeReadiness()).status, 'unavailable');
    assert.equal(beta.counts.trades, 0);
  } finally { await beta.close(); }
  const restored = await runtimeFixture({ databasePath, seed: false, config: null, storeKey: null });
  try { assert.equal((await restored.cartRecords()).length, 1); }
  finally { await restored.close(); }
});
