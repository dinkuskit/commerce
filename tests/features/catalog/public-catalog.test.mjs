import assert from 'node:assert/strict';
import test from 'node:test';
import { readPublicCatalog, readPublicCatalogItem } from '../../../dist/features/catalog/index.js';

function context({ hasMore = false, cursor, count = 1, status = 'in-stock', managed = false, priced = true, hide = false, mixed = false } = {}) {
  const record = { recordKind: 'catalog-item', itemId: 'hat', name: 'Hat', sku: 'HAT',
    stockManagement: managed ? { mode: 'managed', status: 'active', inventorySkuId: 'sku' } : { mode: 'unmanaged' } };
  const empty = { async get() { return null; }, async query() { return { items: [], hasMore: false }; } };
  return { site: { url: 'https://shop.example.test' }, storage: {
    catalog_items: { async get(id) { return id === 'hat' ? record : null; }, async query(options) {
      assert.equal(options.limit, 50);
      const rows = mixed
        ? [{ id: 'integrity-probe', data: { recordKind: 'integrity-probe', itemId: 'probe' } }]
        : [];
      return { items: rows.concat(Array.from({ length: count }, () => ({ id: 'hat', data: record }))), hasMore, cursor };
    } },
    catalog_prices: { async get() { return priced ? { recordKind: 'catalog-price', recordId: 'hat', catalogItemId: 'hat', regular: { currency: 'USD', minor: '400' }, sale: { currency: 'USD', minor: '300' } } : null; } },
    catalog_manual_availability: { async get() { return { recordKind: 'catalog-manual-availability', recordId: 'hat', catalogItemId: 'hat', status }; } },
    catalog_backorder_policies: empty, store_inventory_configurations: empty, storefront_availability_settings: empty,
    storefront_out_of_stock_listing: { async get() { return { recordKind: 'storefront-out-of-stock-listing', recordId: 'active', hideOutOfStock: hide, updatedAt: '2026-10-07T00:00:00Z' }; } },
    catalog_media: empty, storefront_placeholder_image: empty,
  } };
}

test('public projection preserves authoritative sale, listing and managed fail-closed rules', async () => {
  assert.equal((await readPublicCatalog(context())).products[0].price.minor, '300');
  assert.deepEqual((await readPublicCatalog(context({ priced: false }))).products, []);
  assert.deepEqual((await readPublicCatalog(context({ status: 'out-of-stock', hide: true }))).products, []);
  const managed = (await readPublicCatalog(context({ managed: true }))).products[0];
  assert.deepEqual(managed.availability, { status: 'availability-unavailable', sellable: false, listable: true });
  assert.deepEqual(Object.keys(managed).sort(), ['availability', 'gallery', 'id', 'image', 'name', 'price', 'sku']);
  assert.deepEqual([managed.image, managed.gallery], [null, []], 'no media record and no placeholder yields no image');
});

test('catalog page keeps continuation across filtered rows and refuses oversized/nonprogressing pages', async () => {
  assert.deepEqual(await readPublicCatalog(context({ priced: false, hasMore: true, cursor: 'next' })), { products: [], cursor: 'next' });
  await assert.rejects(() => readPublicCatalog(context({ count: 51 })), /Catalog unavailable/);
  await assert.rejects(() => readPublicCatalog(context({ hasMore: true })), /Catalog unavailable/);
  await assert.rejects(() => readPublicCatalog(context({ hasMore: true, cursor: 'same' }), 'same'), /Catalog unavailable/);
  await assert.rejects(() => readPublicCatalog(context(), 'x'.repeat(1025)), /Catalog unavailable/);
});

test('public catalog skips integrity and other non-catalog rows before validating item identity', async () => {
  const response = await readPublicCatalog(context({ mixed: true }));
  assert.equal(response.products.length, 1);
  assert.equal(response.products[0].id, 'hat');
});

test('single-item lookup uses the same public projection and never exposes page state', async () => {
  const result = await readPublicCatalogItem(context(), 'hat');
  assert.deepEqual(result, {
    id: 'hat',
    name: 'Hat',
    sku: 'HAT',
    price: { currency: 'USD', minor: '300' },
    availability: { status: 'in-stock', sellable: true, listable: true },
    image: null,
    gallery: [],
  });
  assert.equal('page' in result, false);
  assert.equal(await readPublicCatalogItem(context({ priced: false }), 'hat'), null);
  assert.equal(await readPublicCatalogItem(context(), 'missing'), null);
  await assert.rejects(() => readPublicCatalogItem(context(), ''), /Catalog unavailable/);
});
