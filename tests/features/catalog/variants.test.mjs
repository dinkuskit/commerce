import assert from 'node:assert/strict';
import test from 'node:test';
import { addCatalogVariantOption, createCatalogItem, resolveCatalogVariantMember, updateCatalogVariantLabels, bulkSaveCatalogProductPrices, saveCatalogProductPrices } from '../../../dist/features/catalog/kernel/index.js';
import { readPublicCatalog, readPublicCatalogItem } from '../../../dist/features/catalog/index.js';

// Small isolated store retains the same unique indexes and revision fence as the catalog contract.
class Catalog {
  records = new Map(); revisions = new Map(); rejectParent = false;
  async get(id) { return structuredClone(this.records.get(id) ?? null); }
  async getVersioned(id) { const value = await this.get(id); return value ? { value, revision: this.revisions.get(id) } : null; }
  async put(id, row) {
    for (const [key, other] of this.records) for (const field of ['commandId', 'skuKey']) {
      if (key !== id && row[field] === other[field]) throw new Error(`UNIQUE constraint failed: index 'uidx_plugin_dinkus-commerce_catalogItems_${field}'`);
    }
    this.records.set(id, structuredClone(row)); this.revisions.set(id, String(Number(this.revisions.get(id) ?? 0) + 1));
  }
  async delete(id) { this.records.delete(id); this.revisions.delete(id); }
  async compareAndDelete(id, revision) { if (this.revisions.get(id) !== revision) return { applied: false }; await this.delete(id); return { applied: true }; }
  async query({ where = {}, limit = 50 } = {}) {
    const rows = [...this.records].filter(([, row]) => Object.entries(where).every(([key, value]) => row[key] === value));
    return { items: rows.slice(0, limit).map(([id, data]) => ({ id, data: structuredClone(data) })), hasMore: rows.length > limit };
  }
  async compareAndSet(id, revision, value) {
    if (id === 'product' && this.rejectParent || (this.revisions.get(id) ?? null) !== revision) return { applied: false };
    await this.put(id, value); return { applied: true, revision: this.revisions.get(id) };
  }
}
const base = { recordKind: 'catalog-item', itemId: 'product', commandId: 'create-product', kind: 'simple-product', name: 'Proof shirt', sku: 'PROOF-SMALL', skuKey: 'PROOF-SMALL', state: 'draft', stockManagement: { mode: 'unmanaged' }, creationIntent: { manageStock: false }, createdAt: '2026-10-08T00:00:00.000Z' };
const input = { productId: 'product', optionId: 'size', optionLabel: 'Size', values: [
  { valueId: 'small', label: 'Small', member: { catalogItemId: 'product', fulfillment: 'physical' } },
  { valueId: 'large', label: 'Large', member: { commandId: 'create-large', name: 'Proof shirt', sku: 'PROOF-LARGE', fulfillment: 'physical' } },
] };

function publicContext(catalog, prices) {
  const empty = new Catalog();
  return { site: { url: 'https://shop.example.test' }, storage: {
    catalog_items: catalog, catalog_prices: prices, catalog_manual_availability: empty,
    catalog_backorder_policies: empty, store_inventory_configurations: empty,
    storefront_availability_settings: empty, storefront_out_of_stock_listing: empty,
    catalog_media: empty, storefront_placeholder_image: empty,
  } };
}

test('hidden default member is absent from public list and lookup until priced', async () => {
  const catalog = new Catalog(), prices = new Catalog();
  await createCatalogItem(catalog, { commandId: 'hidden', name: 'Proof shirt', sku: 'HIDDEN', fulfillment: 'digital' }, { createId: () => 'product' });
  const ctx = publicContext(catalog, prices);
  assert.deepEqual((await readPublicCatalog(ctx)).products, []);
  assert.equal(await readPublicCatalogItem(ctx, 'product'), null);
  prices.records.set('product', { recordKind: 'catalog-price', recordId: 'product', catalogItemId: 'product', regular: { currency: 'USD', minor: '2400' } });
  const product = await readPublicCatalogItem(ctx, 'product');
  assert.equal(product.price.minor, '2400');
  assert.equal(product.availability.sellable, true);
});

test('public variant group retains priced members and excludes an unpriced sibling', async () => {
  const catalog = new Catalog(), prices = new Catalog(); await catalog.put('product', base);
  await addCatalogVariantOption({ catalog }, input, { createId: () => 'large-item' });
  prices.records.set('large-item', { recordKind: 'catalog-price', recordId: 'large-item', catalogItemId: 'large-item', regular: { currency: 'USD', minor: '2400' } });
  const product = (await readPublicCatalog(publicContext(catalog, prices))).products[0];
  const unpriced = product.variants.members.find(m => m.catalogItemId === 'product');
  if (unpriced) assert.deepEqual(unpriced.availability, { status: 'availability-unavailable', sellable: false, listable: false });
  assert.deepEqual(product.variants.members.map(m => m.catalogItemId), ['large-item']);
  assert.equal(product.variants.members[0].price.minor, '2400');
  assert.equal(product.variants.members[0].availability.sellable, true);
});

test('failed parent commit leaves additional rows unavailable to purchase', async () => {
  const catalog = new Catalog(); await catalog.put('product', base); catalog.rejectParent = true;
  await assert.rejects(addCatalogVariantOption({ catalog }, input, { createId: () => 'large-item' }));
  const orphan = await resolveCatalogVariantMember(catalog, 'large-item');
  assert.equal(orphan, null, 'an uncommitted member must never resolve as a standalone product');
});

test('same option label cannot make a different membership payload an idempotent success', async () => {
  const catalog = new Catalog(); await catalog.put('product', base);
  await addCatalogVariantOption({ catalog }, input, { createId: () => 'large-item' });
  const changed = structuredClone(input); changed.values[1].label = 'Different';
  await assert.rejects(addCatalogVariantOption({ catalog }, changed), error => error.code === 'COMMAND_CONFLICT');
});

test('explicit products start with one hidden default member and labels retain IDs', async () => {
  const catalog = new Catalog();
  const created = await createCatalogItem(catalog, {
    commandId: 'create-explicit', name: 'Proof shoe', sku: 'PROOF-SHOE', fulfillment: 'digital',
  }, { createId: () => 'shoe' });
  assert.deepEqual(created.item.variantProduct.members[0], {
    catalogItemId: 'shoe', selections: [], fulfillment: 'digital',
  });
  const expanded = await addCatalogVariantOption({ catalog }, {
    productId: 'shoe', optionId: 'size', optionLabel: 'Size',
    values: [
      { valueId: 'small', label: 'Small', member: { catalogItemId: 'shoe', fulfillment: 'digital' } },
      { valueId: 'large', label: 'Large', member: { commandId: 'create-large-shoe', name: 'Proof shoe', sku: 'PROOF-SHOE-LARGE', fulfillment: 'digital' } },
    ],
  }, { createId: () => 'shoe-large' });
  const renamed = await updateCatalogVariantLabels({ catalog }, {
    productId: 'shoe', expectedRevision: expanded.product.revision,
    optionLabel: 'Size', values: [{ valueId: 'small', label: 'S' }, { valueId: 'large', label: 'L' }],
  });
  assert.equal(renamed.product.options[0].optionId, 'size');
  assert.deepEqual(renamed.product.options[0].values.map(value => value.valueId), ['small', 'large']);
  await assert.rejects(updateCatalogVariantLabels({ catalog }, {
    productId: 'shoe', expectedRevision: expanded.product.revision, values: [],
  }), error => error.code === 'COMMAND_CONFLICT');
});

test('selection combination validation is independent of array order and rejects duplicate members', async () => {
  const catalog = new Catalog(); await catalog.put('product', base);
  await addCatalogVariantOption({ catalog }, input, { createId: () => 'large-item' });
  const parent = await catalog.get('product');
  parent.variantProduct.members[1].selections.reverse();
  parent.variantProduct.members.push(structuredClone(parent.variantProduct.members[1]));
  await catalog.put('product', parent);
  await assert.rejects(resolveCatalogVariantMember(catalog, 'product'), error => error.code === 'STORAGE_UNAVAILABLE');
});

test('bulk applies independent valid rows, reports stale and invalid rows, and preserves stock', async () => {
  const catalog = new Catalog(); await catalog.put('product', base);
  await addCatalogVariantOption({ catalog }, input, { createId: () => 'large-item' });
  const prices = new Catalog(), availability = new Catalog();
  // Price/availability collections have no catalog command/SKU indexes.
  prices.put = availability.put = async function(id, value) { this.records.set(id, structuredClone(value)); this.revisions.set(id, crypto.randomUUID()); };
  const storage = { catalog, prices, availability, claims: new Catalog() };
  await saveCatalogProductPrices(storage, { catalogItemId: 'product', regular: '20', sale: '', stockStatus: 'out-of-stock' });
  await saveCatalogProductPrices(storage, { catalogItemId: 'large-item', regular: '24', sale: '', stockStatus: 'in-stock' });
  const revision = (await prices.getVersioned('product')).revision;
  const result = await bulkSaveCatalogProductPrices(storage, [
    { catalogItemId: 'product', regular: '25', sale: '', expectedRevision: revision },
    { catalogItemId: 'large-item', regular: '25', sale: '', expectedRevision: 'stale' },
    { catalogItemId: 'large-item', regular: 'bad', sale: '', expectedRevision: (await prices.getVersioned('large-item')).revision },
    { catalogItemId: 'large-item', regular: '25', sale: '', manageStock: true, stockStatus: 'out-of-stock', expectedRevision: (await prices.getVersioned('large-item')).revision },
  ]);
  assert.deepEqual(result.outcomes.map(r => [r.applied, r.code]), [[true, undefined], [false, 'CONFLICT'], [false, 'INVALID_INPUT'], [false, 'INVALID_INPUT']]);
  assert.equal((await prices.get('product')).regular.minor, '2500');
  assert.equal((await prices.get('large-item')).regular.minor, '2400');
  assert.equal((await availability.get('product')).status, 'out-of-stock');
});

test('variant bulk pricing refuses an ordinary product without changing its price or revision', async () => {
  const catalog = new Catalog(); await catalog.put('product', base);
  const prices = new Catalog(), availability = new Catalog();
  prices.put = availability.put = async function(id, value) { this.records.set(id, structuredClone(value)); this.revisions.set(id, crypto.randomUUID()); };
  const storage = { catalog, prices, availability, claims: new Catalog() };
  await saveCatalogProductPrices(storage, { catalogItemId: 'product', regular: '20', sale: '' });
  const before = await prices.getVersioned('product');
  const result = await bulkSaveCatalogProductPrices(storage, [
    { catalogItemId: 'product', regular: '25', sale: '', expectedRevision: before.revision },
  ]);
  assert.deepEqual(result.outcomes.map(r => [r.applied, r.code]), [[false, 'CATALOG_ITEM_NOT_FOUND']]);
  assert.deepEqual(await prices.getVersioned('product'), before);
});

test('failed stock save cannot roll back a later identical price write', async () => {
  const catalog = new Catalog(); await catalog.put('product', base);
  const prices = new Catalog(), availability = new Catalog();
  prices.put = availability.put = async function(id, value) { this.records.set(id, structuredClone(value)); this.revisions.set(id, crypto.randomUUID()); };
  const storage = { catalog, prices, availability, claims: new Catalog() };
  await saveCatalogProductPrices(storage, { catalogItemId: 'product', regular: '20', sale: '', stockStatus: 'out-of-stock' });
  const revision = (await prices.getVersioned('product')).revision;
  availability.put = async () => {
    const later = await prices.get('product'); await prices.put('product', later);
    throw Error('stock unavailable after another writer saved the same price');
  };
  await assert.rejects(saveCatalogProductPrices(storage, { catalogItemId: 'product', regular: '24', sale: '', stockStatus: 'in-stock', expectedRevision: revision }));
  assert.equal((await prices.get('product')).regular.minor, '2400');
});

test('additional choices cannot adopt an unrelated existing catalog identity', async () => {
  const catalog = new Catalog(); await catalog.put('product', base);
  const changed = structuredClone(input); changed.values[1].member = { catalogItemId: 'unrelated', fulfillment: 'physical' };
  await assert.rejects(addCatalogVariantOption({ catalog }, changed), error => error.code === 'INVALID_INPUT');
  assert.equal((await catalog.get('product')).variantProduct, undefined);
});

test('retrying a refused parent commit resumes the same linked member', async () => {
  const catalog = new Catalog(); await catalog.put('product', base); catalog.rejectParent = true;
  await assert.rejects(addCatalogVariantOption({ catalog }, input, { createId: () => 'large-item' }));
  catalog.rejectParent = false;
  await addCatalogVariantOption({ catalog }, input, { createId: () => 'must-not-create-another-member' });
  assert.equal((await resolveCatalogVariantMember(catalog,'large-item')).member.catalogItemId,'large-item');
  assert.equal(await catalog.get('must-not-create-another-member'),null);
});
