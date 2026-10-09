import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { resolveCatalogItemPrice } from '../../dist/features/catalog/index.js';
import { resolveStorefrontAvailability } from '../../dist/features/storefront-availability/index.js';
import { configuration, credential, runtimeFixture, SITE } from '../features/checkout/registry-runtime.mjs';
import {
  COMMERCE_CHECKOUT_WAKES_TASK,
  COMMERCE_REGISTRY_RUNTIME_ID,
} from '../../dist/features/checkout/index.js';

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
  assert.equal(state.manifest.id, COMMERCE_REGISTRY_RUNTIME_ID);
  assert.deepEqual(state.artifact.capabilities, ['media:read', 'network:request']);
  assert.deepEqual(state.artifact.allowedHosts, ['payments.dinkuskit.com']);
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

test('compiled Registry runtime declares no coupons and rejects coupon codes before attempts or Payments', async t => {
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
    assert.equal(rejected.error.code, 'UNAVAILABLE');
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
  const input = { lines: [{ catalogItemId: catalog.products[0].id, quantity: 2 }] };
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

test('malformed or copied configuration is rejected before encrypted credential/transport', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  const cases = [
    { ...configuration(), commerceOrigin: 'https://other.example.test' },
    { ...configuration(), schema: 'unsupported' },
    { ...configuration(), paymentsOrigin: 'http://8.8.8.8' },
    { ...configuration(), providerId: 'unsupported' },
    { ...configuration(), mode: 'live' },
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
