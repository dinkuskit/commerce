import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeGtin,
  setCatalogItemIdentifiers,
  readPublicCatalogItem,
} from '../../../dist/features/catalog/index.js';

test('GTIN-8/12/13/14 check digits validate; bad check digits refuse', () => {
  assert.equal(normalizeGtin('036000291452'), '036000291452'); // GTIN-12
  assert.equal(normalizeGtin('4006381333931'), '4006381333931'); // GTIN-13
  assert.equal(normalizeGtin('0 36000 29145 2'), '036000291452');
  assert.throws(() => normalizeGtin('036000291453'), /check digit/);
  assert.throws(() => normalizeGtin('123'), /GTIN-8/);
});

function catalogMemory(item) {
  let revision = '1';
  let value = structuredClone(item);
  return {
    async get(id) {
      return id === value.itemId ? structuredClone(value) : null;
    },
    async getVersioned(id) {
      return id === value.itemId ? { value: structuredClone(value), revision } : null;
    },
    async compareAndSet(id, expected, next) {
      if (id !== value.itemId || expected !== revision) return { applied: false };
      value = structuredClone(next);
      revision = String(Number(revision) + 1);
      return { applied: true };
    },
    async put() {
      throw new Error('unused');
    },
    async query() {
      return { items: [], hasMore: false };
    },
    async delete() {},
  };
}

test('identifiers key on itemId and project only when set', async () => {
  const storage = catalogMemory({
    recordKind: 'catalog-item',
    itemId: 'hat',
    kind: 'simple-product',
    name: 'Hat',
    sku: 'HAT',
    skuKey: 'HAT',
    commandId: 'cmd',
    creationIntent: { manageStock: false },
    stockManagement: { mode: 'unmanaged' },
    state: 'draft',
    createdAt: '2026-10-08T00:00:00.000Z',
  });
  const saved = await setCatalogItemIdentifiers(storage, {
    catalogItemId: 'hat',
    gtin: '036000291452',
    brand: 'Example',
  });
  assert.equal(saved.changed, true);
  assert.equal(saved.item.gtin, '036000291452');
  assert.equal(saved.item.brand, 'Example');
  assert.equal(saved.item.mpn, undefined);

  const empty = {
    async get() {
      return null;
    },
    async query() {
      return { items: [], hasMore: false };
    },
  };
  const ctx = {
    site: { url: 'https://shop.example.test' },
    storage: {
      catalog_items: storage,
      catalog_prices: {
        async get() {
          return {
            recordKind: 'catalog-price',
            recordId: 'hat',
            catalogItemId: 'hat',
            regular: { currency: 'USD', minor: '500' },
          };
        },
      },
      catalog_manual_availability: {
        async get() {
          return {
            recordKind: 'catalog-manual-availability',
            recordId: 'hat',
            catalogItemId: 'hat',
            status: 'in-stock',
          };
        },
      },
      catalog_backorder_policies: empty,
      store_inventory_configurations: empty,
      storefront_availability_settings: empty,
      storefront_out_of_stock_listing: empty,
      catalog_media: empty,
      storefront_placeholder_image: empty,
    },
  };
  const publicItem = await readPublicCatalogItem(ctx, 'hat');
  assert.equal(publicItem.id, 'hat');
  assert.equal(publicItem.sku, 'HAT');
  assert.equal(publicItem.gtin, '036000291452');
  assert.equal(publicItem.brand, 'Example');
  assert.equal('mpn' in publicItem, false);

  await setCatalogItemIdentifiers(storage, { catalogItemId: 'hat', gtin: null, brand: null });
  const cleared = await readPublicCatalogItem(ctx, 'hat');
  assert.equal('gtin' in cleared, false);
  assert.equal('brand' in cleared, false);
});
