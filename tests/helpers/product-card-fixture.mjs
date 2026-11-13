import { productPanel } from '../../dist/admin/index.js';
import { createProductForPage, addCatalogVariantOption } from '../../dist/features/catalog/kernel/index.js';
import { Collection } from './catalog-memory.mjs';

// Match the sandbox collection's unique-index name; the shared helper defaults
// to the native catalogItems spelling.
class CatalogCollection extends Collection {
  async put(id, row) {
    for (const [key, other] of this.records) for (const field of ['commandId', 'skuKey']) {
      if (key !== id && row[field] !== undefined && row[field] === other[field]) {
        throw new Error(`UNIQUE constraint failed: index 'uidx_plugin_dinkus-commerce_catalog_items_${field}'`);
      }
    }
    return super.put(id, row);
  }
}

// Disposable catalog only. Never contacts a store, CMS database or provider.
export async function productCardFixture(variants = false) {
  const calls = { n: 0 };
  const names = ['catalog_items', 'product_pages', 'catalog_prices', 'catalog_manual_availability',
    'catalog_backorder_policies', 'store_inventory_configurations', 'storefront_availability_settings',
    'storefront_out_of_stock_listing', 'catalog_media', 'storefront_placeholder_image', 'managed_sku_claims'];
  const storage = Object.fromEntries(names.map(name => [name,
    name === 'catalog_items' ? new CatalogCollection(calls) : new Collection(calls)]));
  const store = { catalog: storage.catalog_items, pages: storage.product_pages,
    prices: storage.catalog_prices, availability: storage.catalog_manual_availability };
  const made = await createProductForPage(store, { entryId: 'page-fixture', commandId: 'card-fixture',
    name: 'Fixture shirt', sku: 'FIXTURE', regular: '20', weightOz: '6' }, { collection: 'catalog_items' });
  if (variants) await addCatalogVariantOption(store, { productId: made.catalogItemId, optionId: 'size', optionLabel: 'Size',
    values: [{ valueId: 'm', label: 'M', member: { catalogItemId: made.catalogItemId, fulfillment: 'physical' } },
      { valueId: 'l', label: 'L', member: { commandId: 'card-fixture-l', name: 'Fixture shirt', sku: 'FIXTURE-L', fulfillment: 'physical' } }] }, { collection: 'catalog_items' });
  const ctx = { storage, site: { url: 'https://shop.example.test' } };
  const invoke = input => productPanel({ input, ui: { surface: 'content-editor-panel', locale: 'en', direction: 'ltr',
    extensionId: 'product', entry: { collection: 'products', id: 'page-fixture', locale: null, version: 1 } } }, ctx);
  const snapshot = () => structuredClone([...storage.catalog_items.records]);
  return { invoke, snapshot, id: made.catalogItemId };
}
