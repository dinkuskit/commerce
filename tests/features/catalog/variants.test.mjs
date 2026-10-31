import assert from 'node:assert/strict';
import test from 'node:test';
import { addCatalogVariantMember, addCatalogVariantOption, createCatalogItem, resolveCatalogVariantMember, updateCatalogVariantLabels, bulkSaveCatalogProductPrices, saveCatalogProductPrices, listCatalogProducts } from '../../../dist/features/catalog/kernel/index.js';
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
  const revision = 'catalog:' + (await catalog.getVersioned('product')).revision;
  const result = await bulkSaveCatalogProductPrices(storage, [
    { catalogItemId: 'large-item', regular: 'bad', sale: '', expectedRevision: revision },
    { catalogItemId: 'product', regular: '25', sale: '', expectedRevision: revision },
    { catalogItemId: 'large-item', regular: '25', sale: '', expectedRevision: 'stale' },
    { catalogItemId: 'large-item', regular: '25', sale: '', manageStock: true, stockStatus: 'out-of-stock', expectedRevision: revision },
  ]);
  assert.deepEqual(result.outcomes.map(r => [r.applied, r.code]), [[false, 'INVALID_INPUT'], [true, undefined], [false, 'CONFLICT'], [false, 'INVALID_INPUT']]);
  assert.equal((await catalog.get('product')).catalogData.items.product.price.regular.minor, '2500');
  assert.equal((await catalog.get('product')).catalogData.items['large-item'].price.regular.minor, '2400');
  assert.equal((await catalog.get('product')).catalogData.items.product.availability.status, 'out-of-stock');
});

test('variant bulk pricing refuses an ordinary product without changing its price or revision', async () => {
  const catalog = new Catalog(); await catalog.put('product', base);
  const prices = new Catalog(), availability = new Catalog();
  prices.put = availability.put = async function(id, value) { this.records.set(id, structuredClone(value)); this.revisions.set(id, crypto.randomUUID()); };
  const storage = { catalog, prices, availability, claims: new Catalog() };
  await saveCatalogProductPrices(storage, { catalogItemId: 'product', regular: '20', sale: '' });
  const before = await catalog.getVersioned('product');
  const result = await bulkSaveCatalogProductPrices(storage, [
    { catalogItemId: 'product', regular: '25', sale: '', expectedRevision: 'catalog:' + before.revision },
  ]);
  assert.deepEqual(result.outcomes.map(r => [r.applied, r.code]), [[false, 'CATALOG_ITEM_NOT_FOUND']]);
  assert.deepEqual(await catalog.getVersioned('product'), before);
});

test('a conflicting product save cannot overwrite a later identical price save', async () => {
  const catalog = new Catalog(); await catalog.put('product', base);
  const prices = new Catalog(), availability = new Catalog();
  const storage = { catalog, prices, availability };
  await saveCatalogProductPrices(storage, { catalogItemId: 'product', regular: '20', sale: '', stockStatus: 'out-of-stock' });
  const revision = 'catalog:' + (await catalog.getVersioned('product')).revision;
  await saveCatalogProductPrices(storage, { catalogItemId: 'product', regular: '24', sale: '', stockStatus: 'in-stock' });
  await assert.rejects(saveCatalogProductPrices(storage, { catalogItemId: 'product', regular: '99', sale: '', expectedRevision: revision }), e => e.code === 'COMMAND_CONFLICT');
  assert.equal((await catalog.get('product')).catalogData.items.product.price.regular.minor, '2400');
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

test('appending a second option requires explicit existing-member values, accepts sparse combinations, and renames any option or value under expectedRevision', async () => {
  const catalog = new Catalog(); await catalog.put('product', base);
  const first = await addCatalogVariantOption({ catalog }, input, { createId: () => 'large-item' });
  assert.equal(first.product.revision, 1);

  // Missing an existing member's value on the appended option is refused without mutating the parent or leaving orphans.
  await assert.rejects(addCatalogVariantOption({ catalog }, {
    productId: 'product', expectedRevision: 1, optionId: 'color', optionLabel: 'Color',
    values: [
      { valueId: 'oat', label: 'Oat', member: { catalogItemId: 'product', fulfillment: 'physical' } },
      { valueId: 'ink', label: 'Ink', member: { commandId: 'orphan-attempt', name: 'Proof shirt', sku: 'PROOF-ORPHAN', fulfillment: 'physical', selections: [{ optionId: 'size', valueId: 'small' }, { optionId: 'color', valueId: 'ink' }] } },
    ],
  }, { createId: () => 'orphan-item' }), error => error.code === 'INVALID_INPUT');
  assert.equal(await catalog.get('orphan-item'), null);
  assert.equal((await catalog.get('product')).variantProduct.revision, 1);

  // Appending an option or adding a member without the revision the caller read is refused, so a stale form cannot write old member values.
  await assert.rejects(addCatalogVariantOption({ catalog }, {
    productId: 'product', optionId: 'color', optionLabel: 'Color',
    values: [{ valueId: 'oat', label: 'Oat' }, { valueId: 'ink', label: 'Ink' }],
    members: [
      { catalogItemId: 'product', valueId: 'oat', fulfillment: 'digital' },
      { catalogItemId: 'large-item', valueId: 'oat', fulfillment: 'digital' },
    ],
  }), error => error.code === 'COMMAND_CONFLICT');
  await assert.rejects(addCatalogVariantMember({ catalog }, {
    productId: 'product', commandId: 'unfenced-member', name: 'Proof shirt', sku: 'PROOF-UNFENCED', fulfillment: 'physical',
    selections: [{ optionId: 'size', valueId: 'medium', label: 'Medium' }],
  }, { createId: () => 'unfenced-item' }), error => error.code === 'INVALID_INPUT');
  assert.equal(await catalog.get('unfenced-item'), null);
  assert.equal((await catalog.get('product')).variantProduct.revision, 1);

  // Appending Color with explicit values for both existing members (Small/Oat and Large/Oat) succeeds as a sparse matrix.
  const second = await addCatalogVariantOption({ catalog }, {
    productId: 'product', expectedRevision: 1, optionId: 'color', optionLabel: 'Color',
    values: [{ valueId: 'oat', label: 'Oat' }, { valueId: 'ink', label: 'Ink' }],
    members: [
      { catalogItemId: 'product', valueId: 'oat', fulfillment: 'physical' },
      { catalogItemId: 'large-item', valueId: 'oat', fulfillment: 'physical' },
    ],
  });
  assert.equal(second.changed, true);
  assert.equal(second.product.revision, 2);
  assert.deepEqual(second.product.options.map(o => o.optionId), ['size', 'color']);
  assert.deepEqual((await resolveCatalogVariantMember(catalog, 'large-item')).member.selections, [
    { optionId: 'size', valueId: 'large' },
    { optionId: 'color', valueId: 'oat' },
  ]);

  // Adding a sparse combination member (Medium / Ink) introduces Medium on Size and reuses Ink on Color.
  const added = await addCatalogVariantMember({ catalog }, {
    productId: 'product', expectedRevision: 2, commandId: 'create-medium-ink', name: 'Proof shirt',
    sku: 'PROOF-MEDIUM-INK', fulfillment: 'digital',
    selections: [
      { optionId: 'size', valueId: 'medium', label: 'Medium' },
      { optionId: 'color', valueId: 'ink' },
    ],
  }, { createId: () => 'medium-ink-item' });
  assert.equal(added.product.revision, 3);
  assert.equal(added.product.members.length, 3);
  assert.deepEqual(added.product.options[0].values.map(v => v.valueId), ['small', 'large', 'medium']);
  assert.deepEqual((await resolveCatalogVariantMember(catalog, 'medium-ink-item')).member, {
    catalogItemId: 'medium-ink-item',
    selections: [{ optionId: 'size', valueId: 'medium' }, { optionId: 'color', valueId: 'ink' }],
    fulfillment: 'digital',
  });

  // Duplicate combination (Medium / Ink again) is refused before creating a catalog item.
  await assert.rejects(addCatalogVariantMember({ catalog }, {
    productId: 'product', expectedRevision: 3, commandId: 'dup-medium-ink', name: 'Proof shirt',
    sku: 'PROOF-DUP', fulfillment: 'physical',
    selections: [
      { optionId: 'color', valueId: 'ink' },
      { optionId: 'size', valueId: 'medium' },
    ],
  }, { createId: () => 'dup-item' }), error => error.code === 'INVALID_INPUT');
  assert.equal(await catalog.get('dup-item'), null);

  // Stale expectedRevision is refused with COMMAND_CONFLICT on both member addition and label update.
  await assert.rejects(addCatalogVariantMember({ catalog }, {
    productId: 'product', expectedRevision: 2, commandId: 'stale-member', name: 'Proof shirt',
    sku: 'PROOF-STALE', fulfillment: 'physical',
    selections: [{ optionId: 'size', valueId: 'small' }, { optionId: 'color', valueId: 'ink' }],
  }), error => error.code === 'COMMAND_CONFLICT');

  // Any option label and any value label across options can be renamed under expectedRevision.
  const renamed = await updateCatalogVariantLabels({ catalog }, {
    productId: 'product', expectedRevision: 3,
    options: [{ optionId: 'size', label: 'Fit' }, { optionId: 'color', label: 'Shade' }],
    values: [
      { optionId: 'size', valueId: 'medium', label: 'M' },
      { optionId: 'color', valueId: 'oat', label: 'Sand' },
      { optionId: 'color', valueId: 'ink', label: 'Deep Ink' },
    ],
  });
  assert.equal(renamed.product.revision, 4);
  assert.deepEqual(renamed.product.options.map(o => [o.optionId, o.label]), [['size', 'Fit'], ['color', 'Shade']]);
  assert.deepEqual(renamed.product.options[1].values, [
    { valueId: 'oat', label: 'Sand' },
    { valueId: 'ink', label: 'Deep Ink' },
  ]);
});

test('multi-option commands enforce the 3-option cap, refuse duplicate assignments, and resume cleanly after a failed parent CAS', async () => {
  const catalog = new Catalog(); await catalog.put('product', base);
  await addCatalogVariantOption({ catalog }, input, { createId: () => 'large-item' });

  // Appending an option that assigns two existing members with the same prior selection to the same new value is impossible,
  // and assigning a new member with the same combination as an existing member is refused without creating an orphan.
  await assert.rejects(addCatalogVariantOption({ catalog }, {
    productId: 'product', expectedRevision: 1, optionId: 'color', optionLabel: 'Color',
    values: [{ valueId: 'oat', label: 'Oat' }, { valueId: 'ink', label: 'Ink' }],
    members: [
      { catalogItemId: 'product', valueId: 'oat', fulfillment: 'physical' },
      { catalogItemId: 'large-item', valueId: 'oat', fulfillment: 'physical' },
      { commandId: 'dup-combo', name: 'Proof shirt', sku: 'PROOF-DUP-COMBO', fulfillment: 'physical', valueId: 'oat', selections: [{ optionId: 'size', valueId: 'small' }] },
    ],
  }, { createId: () => 'dup-combo-item' }), error => error.code === 'INVALID_INPUT');
  assert.equal(await catalog.get('dup-combo-item'), null);

  // Appending option 2 with a new member when parent CAS fails, then resuming the same command reuses the created member identity.
  const appendColor = {
    productId: 'product', expectedRevision: 1, optionId: 'color', optionLabel: 'Color',
    values: [{ valueId: 'oat', label: 'Oat' }, { valueId: 'ink', label: 'Ink' }],
    members: [
      { catalogItemId: 'product', valueId: 'oat', fulfillment: 'physical' },
      { catalogItemId: 'large-item', valueId: 'oat', fulfillment: 'physical' },
      { commandId: 'create-small-ink', name: 'Proof shirt', sku: 'PROOF-SMALL-INK', fulfillment: 'physical', valueId: 'ink', selections: [{ optionId: 'size', valueId: 'small' }] },
    ],
  };
  catalog.rejectParent = true;
  await assert.rejects(addCatalogVariantOption({ catalog }, appendColor, { createId: () => 'small-ink-item' }), error => error.code === 'STORAGE_UNAVAILABLE');
  assert.equal(await resolveCatalogVariantMember(catalog, 'small-ink-item'), null);
  catalog.rejectParent = false;
  const resumed = await addCatalogVariantOption({ catalog }, appendColor, { createId: () => 'unused-id' });
  assert.equal(resumed.changed, true);
  assert.equal(await catalog.get('unused-id'), null);
  assert.equal((await resolveCatalogVariantMember(catalog, 'small-ink-item')).member.catalogItemId, 'small-ink-item');
  const replayed = await addCatalogVariantOption({ catalog }, appendColor, { createId: () => 'unused-id-2' });
  assert.equal(replayed.changed, false);

  // Appending option 3 (Material) succeeds up to the 3-option cap.
  const third = await addCatalogVariantOption({ catalog }, {
    productId: 'product', expectedRevision: resumed.product.revision, optionId: 'material', optionLabel: 'Material',
    values: [{ valueId: 'cotton', label: 'Cotton' }, { valueId: 'linen', label: 'Linen' }],
    members: [
      { catalogItemId: 'product', valueId: 'cotton', fulfillment: 'physical' },
      { catalogItemId: 'large-item', valueId: 'cotton', fulfillment: 'physical' },
      { catalogItemId: 'small-ink-item', valueId: 'linen', fulfillment: 'physical' },
    ],
  });
  assert.equal(third.product.options.length, 3);

  // Appending a 4th option is refused by the option cap.
  await assert.rejects(addCatalogVariantOption({ catalog }, {
    productId: 'product', expectedRevision: third.product.revision, optionId: 'fit', optionLabel: 'Fit',
    values: [{ valueId: 'regular', label: 'Regular' }, { valueId: 'relaxed', label: 'Relaxed' }],
    members: [
      { catalogItemId: 'product', valueId: 'regular', fulfillment: 'physical' },
      { catalogItemId: 'large-item', valueId: 'regular', fulfillment: 'physical' },
      { catalogItemId: 'small-ink-item', valueId: 'relaxed', fulfillment: 'physical' },
    ],
  }), error => error.code === 'INVALID_INPUT');
});

test('scoped value labels keep option/value pairs apart when ids contain colons', async () => {
  const catalog = new Catalog();
  await catalog.put('product', { ...base, variantProduct: {
    schema: 'dinkuskit.commerce.product-variants/v1', productId: 'product', revision: 1, defaultMemberId: 'product',
    options: [
      { optionId: 'a:b', label: 'First', values: [{ valueId: 'c', label: 'C' }, { valueId: 'x', label: 'X' }] },
      { optionId: 'a', label: 'Second', values: [{ valueId: 'b:c', label: 'BC' }, { valueId: 'y', label: 'Y' }] },
    ],
    members: [
      { catalogItemId: 'product', fulfillment: 'physical', selections: [{ optionId: 'a:b', valueId: 'c' }, { optionId: 'a', valueId: 'b:c' }] },
      { catalogItemId: 'other', fulfillment: 'physical', selections: [{ optionId: 'a:b', valueId: 'x' }, { optionId: 'a', valueId: 'y' }] },
    ],
  } });
  const one = await updateCatalogVariantLabels({ catalog }, { productId: 'product', expectedRevision: 1,
    values: [{ optionId: 'a:b', valueId: 'c', label: 'Renamed C' }] });
  assert.deepEqual(one.product.options.map(o => o.values[0].label), ['Renamed C', 'BC']);
  const both = await updateCatalogVariantLabels({ catalog }, { productId: 'product', expectedRevision: 2, values: [
    { optionId: 'a:b', valueId: 'c', label: 'C2' }, { optionId: 'a', valueId: 'b:c', label: 'BC2' },
  ] });
  assert.deepEqual(both.product.options.map(o => o.values[0].label), ['C2', 'BC2']);
});

async function pricedChoices() {
  const catalog = new Catalog(); await catalog.put('product', base);
  await addCatalogVariantOption({ catalog }, input, { createId: () => 'large-item' });
  const storage = { catalog, prices: new Catalog(), availability: new Catalog() };
  await saveCatalogProductPrices(storage, { catalogItemId: 'product', regular: '20', sale: '' });
  await saveCatalogProductPrices(storage, { catalogItemId: 'large-item', regular: '24', sale: '' });
  return storage;
}

test('native list returns usable root revisions after catalog prices are saved', async () => {
  const storage = await pricedChoices();
  const { products } = await listCatalogProducts(storage);
  for (const member of products[0].variantProduct.members) {
    assert.equal(member.priceRevision, products[0].revision);
    assert.match(member.priceRevision, /^catalog:/);
  }
  const member = products[0].variantProduct.members[1];
  assert.equal((await saveCatalogProductPrices(storage, {
    catalogItemId: member.catalogItemId, regular: '26', sale: '', expectedRevision: member.priceRevision,
  })).saved, true);
});

test('bulk stages valid sibling prices in one root commit', async () => {
  const storage = await pricedChoices();
  const before = await storage.catalog.getVersioned('product');
  const revision = 'catalog:' + before.revision;
  let commits = 0;
  const commit = storage.catalog.compareAndSet.bind(storage.catalog);
  storage.catalog.compareAndSet = async (...args) => { commits++; return commit(...args); };
  const { outcomes } = await bulkSaveCatalogProductPrices(storage, [
    { catalogItemId: 'product', regular: '25', sale: '', expectedRevision: revision },
    { catalogItemId: 'large-item', regular: 'bad', sale: '', expectedRevision: revision },
    { catalogItemId: 'large-item', regular: '28', sale: '', expectedRevision: revision },
  ]);
  assert.deepEqual(outcomes.map(row => [row.applied, row.code]), [[true, undefined], [false, 'INVALID_INPUT'], [true, undefined]]);
  assert.equal(commits, 1);
  const saved = (await storage.catalog.get('product')).catalogData.items;
  assert.equal(saved.product.price.regular.minor, '2500');
  assert.equal(saved['large-item'].price.regular.minor, '2800');
});

test('external write refuses every staged sibling without partially saving', async () => {
  const storage = await pricedChoices();
  const before = await storage.catalog.getVersioned('product');
  const commit = storage.catalog.compareAndSet.bind(storage.catalog);
  storage.catalog.compareAndSet = async (...args) => {
    const external = await storage.catalog.get('product'); external.brand = 'Other editor';
    await storage.catalog.put('product', external);
    return commit(...args);
  };
  const { outcomes } = await bulkSaveCatalogProductPrices(storage, ['product', 'large-item'].map(catalogItemId => ({
    catalogItemId, regular: '30', sale: '', expectedRevision: 'catalog:' + before.revision,
  })));
  assert.deepEqual(outcomes.map(row => [row.applied, row.code]), [[false, 'CONFLICT'], [false, 'CONFLICT']]);
  const after = await storage.catalog.get('product');
  assert.deepEqual(after.catalogData, before.value.catalogData);
  assert.equal(after.brand, 'Other editor');
});


test('bulk cleanup happens after the whole product commit and cannot misreport a saved price', async () => {
  const storage = await pricedChoices();
  const revision = 'catalog:' + (await storage.catalog.getVersioned('product')).revision;
  const cleaned = [];
  storage.releaseRegistrationClaims = async id => {
    const values = (await storage.catalog.get('product')).catalogData.items;
    assert.equal(values.product.price.regular.minor, '3000');
    assert.equal(values['large-item'].price.regular.minor, '3000');
    cleaned.push(id);
    throw new Error('cleanup unavailable');
  };
  const { outcomes } = await bulkSaveCatalogProductPrices(storage, ['product', 'large-item'].map(catalogItemId => ({
    catalogItemId, regular: '30', sale: '', expectedRevision: revision,
  })));
  assert.deepEqual(cleaned, ['product', 'large-item']);
  assert.ok(outcomes.every(row => row.applied && row.message.includes('cleanup is pending')));
});


test('native choice tracking and price share one commit, preserve dormant status and refuse races', async () => {
  const storage = await pricedChoices();
  const before = await storage.catalog.getVersioned('product');
  const enabled = await saveCatalogProductPrices(storage, { catalogItemId: 'large-item', regular: '28', sale: '', manageStock: true, expectedRevision: 'catalog:' + before.revision });
  assert.equal(enabled.manageStock, true);
  const visible = await readPublicCatalog(publicContext(storage.catalog, storage.prices));
  assert.equal(visible.products[0].variants.members.find(member => member.catalogItemId === 'large-item').availability.sellable, false);
  let choice = (await listCatalogProducts(storage)).products[0].variantProduct.members[1];
  assert.equal(choice.manageStock, true);
  assert.equal(choice.regular, '28.00');
  assert.equal((await resolveCatalogVariantMember(storage.catalog, 'large-item')).item.stockManagement.status, 'setup-required');
  const committed = await storage.catalog.getVersioned('product');
  storage.catalog.rejectParent = true;
  await assert.rejects(saveCatalogProductPrices(storage, { catalogItemId: 'large-item', regular: '99', sale: '', manageStock: false, expectedRevision: choice.priceRevision }), e => e.code === 'COMMAND_CONFLICT');
  assert.deepEqual(await storage.catalog.getVersioned('product'), committed);
  storage.catalog.rejectParent = false;
  const disabled = await saveCatalogProductPrices(storage, { catalogItemId: 'large-item', regular: '29', sale: '', manageStock: false, expectedRevision: choice.priceRevision });
  assert.equal(disabled.manageStock, false);
  assert.equal(disabled.stockStatus, 'in-stock');
  choice = (await listCatalogProducts(storage)).products[0].variantProduct.members[1];
  assert.equal(choice.manageStock, false);
  assert.equal(choice.regular, '29.00');
});
