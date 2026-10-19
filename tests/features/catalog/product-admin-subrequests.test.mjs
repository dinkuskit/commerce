import assert from 'node:assert/strict';
import test from 'node:test';
import { commerceAdmin } from '../../../dist/admin/index.js';
import { addCatalogVariantOption, createCatalogItem, listCatalogProducts, loadCatalogProduct, setCatalogProductArchived } from '../../../dist/features/catalog/kernel/index.js';

// Every storage call from a Registry plugin is one subrequest, and the sandbox allows only a
// few per call: EmDash's default is 10, Template Store raises it to 32. A product screen must
// cost the same in a big catalog as in a small one, archived products included.
const EMDASH_DEFAULT = 10;
const TEMPLATE_STORE = 32;

class Collection {
  records = new Map(); revisions = new Map();
  constructor(calls) { this.calls = calls; }
  count() { this.calls.n += 1; }
  async get(id) { this.count(); return structuredClone(this.records.get(id) ?? null); }
  async getMany(ids) {
    this.count();
    return new Map(ids.filter((id) => this.records.has(id)).map((id) => [id, structuredClone(this.records.get(id))]));
  }
  async getVersioned(id) {
    this.count();
    return this.records.has(id) ? { value: structuredClone(this.records.get(id)), revision: this.revisions.get(id) } : null;
  }
  async put(id, row) {
    this.count();
    // The catalog's unique indexes, which item creation proves are live.
    for (const [key, other] of this.records) for (const field of ['commandId', 'skuKey']) {
      if (key !== id && row[field] !== undefined && row[field] === other[field]) throw new Error(`UNIQUE constraint failed: index 'uidx_plugin_dinkus-commerce_catalogItems_${field}'`);
    }
    this.records.set(id, structuredClone(row)); this.revisions.set(id, crypto.randomUUID());
  }
  async delete(id) { this.count(); this.revisions.delete(id); return this.records.delete(id); }
  async compareAndSet(id, revision, row) {
    this.count();
    if ((this.revisions.get(id) ?? null) !== revision) return { applied: false };
    this.records.set(id, structuredClone(row)); this.revisions.set(id, crypto.randomUUID());
    return { applied: true, revision: this.revisions.get(id) };
  }
  async compareAndDelete(id, revision) {
    this.count();
    if (this.revisions.get(id) !== revision) return { applied: false };
    this.records.delete(id); this.revisions.delete(id); return { applied: true };
  }
  async query({ where = {}, limit = 50, cursor } = {}) {
    this.count();
    const rows = [...this.records].filter(([, row]) => Object.entries(where).every(([key, value]) => row[key] === value));
    const start = cursor ? Number(cursor) : 0;
    const end = start + Math.min(limit, 100);
    return { items: rows.slice(start, end).map(([id, data]) => ({ id, data: structuredClone(data) })), hasMore: end < rows.length, ...(end < rows.length ? { cursor: String(end) } : {}) };
  }
}

async function bigShop(count = 50) {
  const calls = { n: 0 };
  const names = ['catalog_items', 'catalog_prices', 'catalog_manual_availability', 'catalog_media', 'product_feed_eligibility'];
  const storage = Object.fromEntries(names.map((name) => [name, new Collection(calls)]));
  const catalog = storage.catalog_items;
  for (let i = 0; i < count; i += 1) {
    const id = 'p' + String(i).padStart(3, '0');
    await createCatalogItem(catalog, { commandId: 'create-' + id, name: 'Product ' + id, sku: 'SKU-' + id, fulfillment: 'physical' }, { createId: () => id });
    storage.catalog_prices.records.set(id, { recordKind: 'catalog-price', recordId: id, catalogItemId: id, regular: { currency: 'USD', minor: '1000' } });
    // Every Manage products run leaves an archived product behind; they still cost a read.
    if (i % 3 === 0) await setCatalogProductArchived(catalog, { catalogItemId: id, archived: true });
  }
  await addCatalogVariantOption({ catalog }, { productId: 'p001', optionId: 'size', optionLabel: 'Size', values: [
    { valueId: 'small', label: 'Small', member: { catalogItemId: 'p001', fulfillment: 'physical' } },
    { valueId: 'large', label: 'Large', member: { commandId: 'create-p001-large', name: 'Product p001', sku: 'SKU-p001-L', fulfillment: 'physical' } },
  ] }, { createId: () => 'p001-large' });
  const ctx = { site: { url: 'https://shop.example.test' }, storage, plugin: { id: 'dinkus-commerce' } };
  const run = async (input) => {
    calls.n = 0;
    const answer = await commerceAdmin({ input }, ctx);
    return { answer, calls: calls.n };
  };
  return { run, storage };
}

const submit = (action_id, values) => ({ type: 'form_submit', action_id, values });
const isError = (answer) => answer.toast?.type === 'error' || answer.blocks?.some((block) => block.type === 'banner' && block.variant === 'error');

const PAGES = new Set(['Products list', 'next Products page', 'product page', 'product page with choices']);

test('each product screen costs the same few storage calls however many products the store has', async () => {
  const costs = new Map();
  for (const size of [10, 50, 150]) {
    const { run } = await bigShop(size);
    const screens = {
      'Products list': { type: 'page_load', page: '/products' },
      'next Products page': { type: 'block_action', action_id: 'list', value: 25 },
      'product page': { type: 'block_action', action_id: 'open', value: 'p002' },
      'price save': submit('save:p002', { regular: '12.00', sale: '', stockStatus: 'in-stock' }),
      'weight save': submit('weight:p002', { 'w:p002': '8' }),
      'rename': submit('rename:p002', { name: 'Renamed' }),
      'archive': { type: 'block_action', action_id: 'archive', value: { id: 'p002', a: true } },
      'product page with choices': { type: 'block_action', action_id: 'open', value: 'p001' },
      'choice weight save': submit('weight:p001', { 'w:p001': '4', 'w:p001-large': '6' }),
    };
    for (const [screen, input] of Object.entries(screens)) {
      const { answer, calls } = await run(input);
      assert.equal(isError(answer), false, `${screen} with ${size} products answered ${JSON.stringify(answer).slice(0, 300)}`);
      assert.ok(calls <= (PAGES.has(screen) ? EMDASH_DEFAULT : TEMPLATE_STORE), `${screen} with ${size} products made ${calls} storage calls`);
      // The Products list reads 100 names per call; nothing else may grow with the catalog.
      const first = costs.get(screen) ?? calls;
      costs.set(screen, first);
      if (screen !== 'Products list' && screen !== 'next Products page') {
        assert.equal(calls, first, `${screen} cost ${first} calls with 10 products and ${calls} with ${size}`);
      }
    }
  }
});

test('a choice price save stays under the limit in a big store', async () => {
  const { run } = await bigShop(150);
  const opened = (await run({ type: 'block_action', action_id: 'open', value: 'p001' })).answer;
  const priceForm = opened.blocks.find((block) => block.type === 'form' && block.submit.action_id.startsWith('variant:["price","p001","p001-large"'));
  assert.ok(priceForm, 'the Large choice has its own price form');
  const { answer, calls } = await run(submit(priceForm.submit.action_id, { regular: '15.00', sale: '', stockStatus: 'in-stock' }));
  assert.deepEqual(answer.toast, { type: 'success', message: 'Changes saved' });
  assert.ok(calls <= TEMPLATE_STORE, `choice price save made ${calls} storage calls`);
});

test('storage adapters written for 0.2.x without getMany still list and load products', async () => {
  const { storage } = await bigShop(12);
  const getOnly = (collection) => ({ get: (id) => collection.get(id), getVersioned: (id) => collection.getVersioned(id), query: (options) => collection.query(options) });
  const batched = { catalog: storage.catalog_items, prices: storage.catalog_prices, availability: storage.catalog_manual_availability };
  const legacy = { catalog: getOnly(storage.catalog_items), prices: getOnly(storage.catalog_prices), availability: getOnly(storage.catalog_manual_availability) };
  assert.deepEqual(await listCatalogProducts(legacy), await listCatalogProducts(batched));
  for (const id of ['p001', 'p002', 'p003']) {
    assert.deepEqual(await loadCatalogProduct(legacy, id), await loadCatalogProduct(batched, id));
  }
  assert.equal((await loadCatalogProduct(legacy, 'p001')).variantProduct.members.length, 2);
  assert.equal(await loadCatalogProduct(legacy, 'p001-large'), null, 'a choice is not a listed product');
});
