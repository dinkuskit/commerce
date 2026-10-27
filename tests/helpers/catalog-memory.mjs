import { productPanel } from '../../dist/admin/index.js';
import { addCatalogVariantOption, createCatalogItem, setCatalogProductArchived } from '../../dist/features/catalog/kernel/index.js';
const EMDASH_DEFAULT = 10;
const commerceAdmin = (route, ctx) => productPanel({ ...route, ui: { surface: 'content-editor-panel', locale: 'en', direction: 'ltr', extensionId: 'product', entry: { collection: 'products', id: 'page-1', locale: null, version: 1 } } }, ctx);
export class Collection {
  records = new Map(); revisions = new Map();
  constructor(calls) { this.calls = calls; }
  count() { this.calls.n += 1; if (this.calls.limit && this.calls.n > this.calls.limit) throw new Error("Invocation budget exceeded"); }
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

export async function bigShop(count = 50) {
  const calls = { n: 0 };
  const names = ['catalog_items', 'catalog_prices', 'catalog_manual_availability', 'catalog_media', 'product_feed_eligibility', 'product_pages'];
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
    calls.n = 0; calls.limit = EMDASH_DEFAULT;
    const answer = await commerceAdmin({ input }, ctx);
    return { answer, calls: calls.n };
  };
  return { run, storage };
}
