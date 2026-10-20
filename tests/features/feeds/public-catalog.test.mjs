import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlugin, PRODUCT_FEED_ELIGIBILITY_COLLECTION } from '../../../dist/index.js';
import { buildGoogleMerchantFeed, buildMetaCatalogFeed } from '../../../dist/features/feeds/index.js';
import sandbox from '../../../dist/sandbox/plugin.mjs';

const names = {
  catalog_items: 'catalogItems',
  catalog_prices: 'catalogPrices',
  catalog_manual_availability: 'catalogManualAvailability',
  catalog_backorder_policies: 'catalogBackorderPolicies',
  store_inventory_configurations: 'storeInventoryConfigurations',
  storefront_availability_settings: 'storefrontAvailabilitySettings',
  storefront_out_of_stock_listing: 'storefrontOutOfStockListing',
  catalog_media: 'catalogMedia',
  storefront_placeholder_image: 'storefrontPlaceholderImage',
  product_feed_eligibility: PRODUCT_FEED_ELIGIBILITY_COLLECTION,
};

function fixture({ nativeNames = false, declared = true } = {}) {
  const products = new Map(['eligible', 'opted-out', 'unset'].map((id) => [id, {
    recordKind: 'catalog-item', itemId: id, name: id, sku: id.toUpperCase(),
    stockManagement: { mode: 'unmanaged' },
    commandId: 'internal-command', weightOz: 12,
  }]));
  const records = new Map([
    ['eligible', { recordKind: 'product-feed-eligibility', recordId: 'eligible', catalogItemId: 'eligible', channels: ['meta-catalog', 'google-merchant', 'google-merchant'], privateNote: 'not public' }],
    ['opted-out', { recordKind: 'product-feed-eligibility', recordId: 'opted-out', catalogItemId: 'opted-out', channels: [] }],
  ]);
  const collection = (rows) => ({
    async get(id) { return structuredClone(rows.get(id) ?? null); },
    async getMany(ids) { return new Map(ids.filter((id) => rows.has(id)).map((id) => [id, structuredClone(rows.get(id))])); },
    async query() { return { items: [...rows].map(([id, data]) => ({ id, data: structuredClone(data) })), hasMore: false }; },
    async put() { assert.fail('public catalog must not write storage'); },
  });
  const storage = Object.fromEntries(Object.keys(names).map((name) => [name, collection(new Map())]));
  storage.catalog_items = collection(products);
  storage.catalog_prices = collection(new Map([...products.keys()].map((id) => [id, {
    recordKind: 'catalog-price', recordId: id, catalogItemId: id,
    regular: { currency: 'USD', minor: '1250' },
  }])));
  storage.product_feed_eligibility = collection(records);
  if (!declared) delete storage.product_feed_eligibility;
  return {
    records,
    context(path) {
      return {
        storage: nativeNames ? Object.fromEntries(Object.entries(storage).map(([key, value]) => [names[key], value])) : storage,
        site: { url: 'https://shop.example.test' },
        request: new Request(`https://shop.example.test/${path}`),
      };
    },
  };
}

for (const [surface, plugin, nativeNames] of [
  ['native camelCase storage', createPlugin(), true],
  ['native snake_case storage fallback', createPlugin(), false],
  ['Registry snake_case storage', sandbox, false],
]) {
  const list = plugin.routes['catalog/public'];
  const item = plugin.routes['catalog/public/item'];
  const invoke = (route, context) => plugin === sandbox
    ? route.handler({ request: context.request }, context)
    : route.handler(context);

  test(`${surface}: anonymous list and item expose only approved feed channels`, async () => {
    for (const route of [list, item]) {
      assert.equal(route.public, true);
      assert.equal(route.permission, undefined);
      assert.deepEqual(route.methods, ['GET']);
      assert.equal(route.cacheControl, 'no-store');
    }
    const f = fixture({ nativeNames });
    const response = await invoke(list, f.context('catalog/public'));
    assert.deepEqual(response.products.map((product) => [product.id, product.feedChannels]), [
      ['eligible', ['google-merchant', 'meta-catalog']],
      ['opted-out', []],
      ['unset', []],
    ]);
    for (const product of response.products) {
      assert.deepEqual(Object.keys(product).sort(), ['availability', 'feedChannels', 'gallery', 'id', 'image', 'name', 'price', 'sku']);
      assert.deepEqual(await invoke(item, f.context(`catalog/public/item?itemId=${product.id}`)), product);
    }
    const facts = response.products.map((product) => ({
      product, eligibility: product.feedChannels ?? [],
      content: { canonicalUrl: `https://shop.example.test/products/${product.id}`, title: product.name },
    }));
    assert.match(buildGoogleMerchantFeed(facts), /<g:id>eligible<\/g:id>/);
    assert.doesNotMatch(buildGoogleMerchantFeed(facts), /<g:id>(opted-out|unset)<\/g:id>/);
    assert.match(buildMetaCatalogFeed(facts), /"eligible","eligible"/);
    assert.doesNotMatch(buildMetaCatalogFeed(facts), /"(opted-out|unset)","(opted-out|unset)"/);
    f.records.get('eligible').channels = [];
    assert.deepEqual((await invoke(item, f.context('catalog/public/item?itemId=eligible'))).feedChannels, []);
    assert.deepEqual((await invoke(list, f.context('catalog/public'))).products[0].feedChannels, []);
  });

  test(`${surface}: older adapters without eligibility storage never opt in`, async () => {
    const f = fixture({ nativeNames, declared: false });
    const response = await invoke(list, f.context('catalog/public'));
    assert.ok(response.products.every((product) => !('feedChannels' in product)));
    assert.equal('feedChannels' in await invoke(item, f.context('catalog/public/item?itemId=eligible')), false);
  });

  test(`${surface}: unsupported stored channel cannot escape on list or item`, async () => {
    const f = fixture({ nativeNames });
    f.records.get('eligible').channels = ['unapproved-channel'];
    await assert.rejects(() => invoke(list, f.context('catalog/public')), /unsupported product feed channel/);
    await assert.rejects(() => invoke(item, f.context('catalog/public/item?itemId=eligible')), /unsupported product feed channel/);
  });
}
