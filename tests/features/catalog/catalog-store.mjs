// In-memory storage with the unique indexes and conditional writes the catalog API relies on.
import { catalogApi } from '../../../dist/admin/index.js';

export class Store {
  records = new Map(); revisions = new Map();
  async get(id) { return structuredClone(this.records.get(id) ?? null); }
  async getMany(ids) { const found = new Map(); for (const id of ids) { const row = await this.get(id); if (row !== null) found.set(id, row); } return found; }
  async getVersioned(id) { const value = await this.get(id); return value ? { value, revision: this.revisions.get(id) } : null; }
  async put(id, row) {
    for (const [key, other] of this.records) for (const field of ['commandId', 'skuKey']) {
      if (key !== id && row[field] !== undefined && row[field] === other[field]) throw new Error(`UNIQUE constraint failed: index 'uidx_plugin_dinkus-commerce_catalog_items_${field}'`);
    }
    this.records.set(id, structuredClone(row)); this.revisions.set(id, String(Number(this.revisions.get(id) ?? 0) + 1));
  }
  async delete(id) { this.records.delete(id); this.revisions.delete(id); }
  async query({ where = {}, limit = 50 } = {}) {
    const rows = [...this.records].filter(([, row]) => Object.entries(where).every(([key, value]) => row[key] === value));
    return { items: rows.slice(0, limit).map(([id, data]) => ({ id, data: structuredClone(data) })), hasMore: rows.length > limit };
  }
  async compareAndSet(id, revision, value) {
    if ((this.revisions.get(id) ?? null) !== revision) return { applied: false };
    await this.put(id, value); return { applied: true, revision: this.revisions.get(id) };
  }
  async compareAndDelete(id, revision) {
    if ((this.revisions.get(id) ?? null) !== revision) return { applied: false };
    await this.delete(id); return { applied: true };
  }
}

export function shop() {
  const names = ['catalog_items', 'catalog_prices', 'catalog_manual_availability', 'catalog_media', 'product_pages', 'product_feed_eligibility',
    'catalog_backorder_policies', 'store_inventory_configurations', 'storefront_availability_settings', 'storefront_out_of_stock_listing',
    'storefront_placeholder_image', 'managed_sku_claims'];
  const ctx = { plugin: { id: 'dinkus-commerce' }, site: { url: 'https://shop.example.test' }, storage: Object.fromEntries(names.map(name => [name, new Store()])) };
  return { ctx, call: input => catalogApi({ input }, ctx) };
}
