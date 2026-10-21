import assert from 'node:assert/strict';
import test from 'node:test';
import { readPublicCatalog, readPublicCatalogItem } from '../../../dist/features/catalog/index.js';
import { addCatalogVariantOption, createCatalogItem, setCatalogProductArchived } from '../../../dist/features/catalog/kernel/index.js';

// Every storage or Media Library call from a Registry plugin is one subrequest, and Template
// Store allows 32 per call (EmDash's default is 10). The shop list must page within that
// however many products, photos and archived products the store has.
const TEMPLATE_STORE = 32;

class Collection {
  records = new Map(); revisions = new Map();
  constructor(calls, batched = true) { this.calls = calls; if (!batched) this.getMany = undefined; }
  async get(id) { this.calls.n += 1; return structuredClone(this.records.get(id) ?? null); }
  async getMany(ids) {
    this.calls.n += 1;
    return new Map(ids.filter((id) => this.records.has(id)).map((id) => [id, structuredClone(this.records.get(id))]));
  }
  async getVersioned(id) {
    this.calls.n += 1;
    return this.records.has(id) ? { value: structuredClone(this.records.get(id)), revision: this.revisions.get(id) } : null;
  }
  async put(id, row) {
    this.calls.n += 1;
    for (const [key, other] of this.records) for (const field of ['commandId', 'skuKey']) {
      if (key !== id && row[field] !== undefined && row[field] === other[field]) throw new Error(`UNIQUE constraint failed: index 'uidx_plugin_dinkus-commerce_catalogItems_${field}'`);
    }
    this.records.set(id, structuredClone(row)); this.revisions.set(id, crypto.randomUUID());
  }
  async delete(id) { this.calls.n += 1; this.revisions.delete(id); return this.records.delete(id); }
  async compareAndSet(id, revision, row) {
    this.calls.n += 1;
    if ((this.revisions.get(id) ?? null) !== revision) return { applied: false };
    this.records.set(id, structuredClone(row)); this.revisions.set(id, crypto.randomUUID());
    return { applied: true, revision: this.revisions.get(id) };
  }
  async query({ where = {}, limit = 50, cursor } = {}) {
    this.calls.n += 1;
    const rows = [...this.records].filter(([, row]) => Object.entries(where).every(([key, value]) => row[key] === value));
    const start = cursor ? Number(cursor.slice(1)) : 0;
    const end = start + Math.min(limit, 100);
    return { items: rows.slice(start, end).map(([id, data]) => ({ id, data: structuredClone(data) })), hasMore: end < rows.length, ...(end < rows.length ? { cursor: 'c' + end } : {}) };
  }
}

const NAMES = ['catalog_items', 'catalog_prices', 'catalog_manual_availability', 'catalog_backorder_policies',
  'store_inventory_configurations', 'storefront_availability_settings', 'storefront_out_of_stock_listing',
  'catalog_media', 'storefront_placeholder_image', 'managed_sku_claims', 'product_feed_eligibility'];

/** A shop like a real one: archived and unpriced products, sold-out ones hidden, photos and galleries, choices. */
async function shop(count, { batched = true } = {}) {
  const calls = { n: 0 };
  const storage = Object.fromEntries(NAMES.map((name) => [name, new Collection(calls, batched)]));
  const catalog = storage.catalog_items;
  const set = (name, id, record) => storage[name].records.set(id, record);
  for (let i = 0; i < count; i += 1) {
    const id = 'p' + String(i).padStart(3, '0');
    await createCatalogItem(catalog, { commandId: 'create-' + id, name: 'Product ' + id, sku: 'SKU-' + id, fulfillment: 'physical' }, { createId: () => id });
    if (i % 2 === 0) set('product_feed_eligibility', id, { recordKind: 'product-feed-eligibility', recordId: id, catalogItemId: id, channels: ['google-merchant'] });
    if (i % 5 !== 4) set('catalog_prices', id, { recordKind: 'catalog-price', recordId: id, catalogItemId: id, regular: { currency: 'USD', minor: String(1000 + i) } });
    if (i % 7 === 6) set('catalog_manual_availability', id, { recordKind: 'catalog-manual-availability', recordId: id, catalogItemId: id, status: 'out-of-stock' });
    if (i % 11 === 10) set('catalog_manual_availability', id, { recordKind: 'catalog-manual-availability', recordId: id, catalogItemId: id, status: 'available-on-backorder' });
    if (i % 2 === 0) set('catalog_media', id, { recordKind: 'catalog-media', recordId: id, catalogItemId: id, image: { mediaId: 'img-' + id },
      gallery: i % 4 === 0 ? [1, 2, 3].map((n) => ({ mediaId: `gal-${id}-${n}` })) : [] });
    if (i % 3 === 0) await setCatalogProductArchived(catalog, { catalogItemId: id, archived: true });
  }
  await addCatalogVariantOption({ catalog }, { productId: 'p001', optionId: 'size', optionLabel: 'Size', values: [
    { valueId: 'small', label: 'Small', member: { catalogItemId: 'p001', fulfillment: 'physical' } },
    { valueId: 'large', label: 'Large', member: { commandId: 'create-p001-large', name: 'Product p001', sku: 'SKU-p001-L', fulfillment: 'physical' } },
  ] }, { createId: () => 'p001-large' });
  set('catalog_prices', 'p001-large', { recordKind: 'catalog-price', recordId: 'p001-large', catalogItemId: 'p001-large', regular: { currency: 'USD', minor: '2400' } });
  set('storefront_out_of_stock_listing', 'active', { recordKind: 'storefront-out-of-stock-listing', recordId: 'active', hideOutOfStock: true, updatedAt: '2026-10-19T00:00:00.000Z' });
  set('storefront_placeholder_image', 'active', { recordKind: 'storefront-placeholder-image', recordId: 'active', image: { mediaId: 'placeholder' }, updatedAt: '2026-10-19T00:00:00.000Z' });
  const media = { async get(id) { calls.n += 1; return { id, mimeType: 'image/jpeg', width: 800, height: 600, alt: 'Photo ' + id, status: 'ready' }; } };
  const ctx = { site: { url: 'https://shop.example.test' }, storage, media };
  return { ctx, calls };
}

async function wholeShop(ctx, calls) {
  const products = [];
  const costs = [];
  let cursor;
  do {
    calls.n = 0;
    const page = await readPublicCatalog(ctx, cursor);
    costs.push(calls.n);
    products.push(...page.products);
    cursor = page.cursor;
  } while (cursor !== undefined && costs.length < 200);
  return { products, costs };
}

test('each shop list page stays under the limit and the pages together list every product once', async () => {
  for (const size of [10, 50, 150]) {
    const { ctx, calls } = await shop(size);
    const { products, costs } = await wholeShop(ctx, calls);
    assert.ok(Math.max(...costs) <= TEMPLATE_STORE, `${size} products: pages cost ${costs.join(', ')} calls`);
    const legacy = await shop(size, { batched: false });
    assert.deepEqual(products, (await wholeShop(legacy.ctx, legacy.calls)).products, 'batched reads list exactly what single reads list');
    assert.equal(new Set(products.map((product) => product.id)).size, products.length);
    assert.ok(products.length > size / 3, `${size} products listed ${products.length}`);
    assert.ok(products.every((product) => product.availability.status !== 'out-of-stock'), 'hidden sold-out products stay hidden');
    assert.ok(!products.some((product) => Number(product.id.slice(1)) % 3 === 0), 'archived products stay off the shop');
  }
});

test('one product read stays well under the limit', async () => {
  const { ctx, calls } = await shop(150);
  const legacy = await shop(150, { batched: false });
  for (const id of ['p002', 'p001', 'p001-large', 'p004', 'p003', 'missing']) {
    calls.n = 0;
    const product = await readPublicCatalogItem(ctx, id);
    assert.ok(calls.n <= 12, `${id} cost ${calls.n} calls`);
    assert.deepEqual(product, await readPublicCatalogItem(legacy.ctx, id));
  }
  assert.equal((await readPublicCatalogItem(ctx, 'p001-large')).variants.members.length, 2);
});

test('the shop list refuses a cursor it did not issue', async () => {
  const { ctx } = await shop(3);
  for (const cursor of ['c50', '99.c50', 'x.c3']) {
    await assert.rejects(() => readPublicCatalog(ctx, cursor), /Catalog unavailable/);
  }
});
