import assert from 'node:assert/strict';
import test from 'node:test';
import { productPanel } from '../../../dist/admin/index.js';

// Product editing lives in the Dinkus Commerce panel on each Content > Products page.
const commerceAdmin = (route, ctx) => productPanel({ ...route, ui: { surface: 'content-editor-panel', locale: 'en', direction: 'ltr', extensionId: 'product', entry: { collection: 'products', id: 'page-1', locale: null, version: 1 } } }, ctx);
import { addCatalogVariantOption, createCatalogItem, renameCatalogProduct, setCatalogProductOnSale, listCatalogProducts } from '../../../dist/features/catalog/kernel/index.js';
import { readPublicCatalog, readPublicCatalogItem } from '../../../dist/features/catalog/index.js';
import { quoteCatalogBasket, resolveManagedStorefrontAvailability } from '../../../dist/features/storefront-availability/kernel/index.js';

class Catalog {
  records = new Map(); revisions = new Map();
  async get(id) { return structuredClone(this.records.get(id) ?? null); }
  async getMany(ids) { const found = new Map(); for (const id of ids) { const row = await this.get(id); if (row !== null) found.set(id, row); } return found; }
  async getVersioned(id) { const value = await this.get(id); return value ? { value, revision: this.revisions.get(id) } : null; }
  async put(id, row) {
    // The catalog's unique indexes, which item creation proves are live.
    for (const [key, other] of this.records) for (const field of ['commandId', 'skuKey']) {
      if (key !== id && row[field] !== undefined && row[field] === other[field]) throw new Error(`UNIQUE constraint failed: index 'uidx_plugin_dinkus-commerce_catalogItems_${field}'`);
    }
    this.records.set(id, structuredClone(row)); this.revisions.set(id, String(Number(this.revisions.get(id) ?? 0) + 1)); }
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
const price = (id, minor) => ({ recordKind: 'catalog-price', recordId: id, catalogItemId: id, regular: { currency: 'USD', minor } });

async function shop() {
  const catalog = new Catalog(), prices = new Catalog(), empty = new Catalog();
  await createCatalogItem(catalog, { commandId: 'create-shirt', name: 'Proof shrit', sku: 'SHIRT', fulfillment: 'physical' }, { createId: () => 'shirt' });
  await addCatalogVariantOption({ catalog }, { productId: 'shirt', optionId: 'size', optionLabel: 'Size', values: [
    { valueId: 'small', label: 'Small', member: { catalogItemId: 'shirt', fulfillment: 'physical' } },
    { valueId: 'large', label: 'Large', member: { commandId: 'create-large', name: 'Proof shrit', sku: 'SHIRT-L', fulfillment: 'physical' } },
  ] }, { createId: () => 'shirt-large' });
  await createCatalogItem(catalog, { commandId: 'create-mug', name: 'Proof mug', sku: 'MUG', fulfillment: 'physical' }, { createId: () => 'mug' });
  for (const [id, minor] of [['shirt', '2000'], ['shirt-large', '2400'], ['mug', '1200']]) prices.records.set(id, price(id, minor));
  const storage = { catalog_items: catalog, product_pages: new Catalog(), catalog_prices: prices, catalog_manual_availability: empty,
    catalog_backorder_policies: empty, store_inventory_configurations: empty, storefront_availability_settings: empty,
    storefront_out_of_stock_listing: empty, catalog_media: empty, storefront_placeholder_image: empty, managed_sku_claims: empty };
  const quoteStorage = { catalog, prices, manualAvailability: empty, backorderPolicies: empty, configurations: empty, settings: empty, listing: empty };
  return { catalog, ctx: { site: { url: 'https://shop.example.test' }, storage }, quote: (ids) => quoteCatalogBasket(quoteStorage, ids, {}) };
}

test('renaming a product renames it for every choice, so cart and new orders carry the new name', async () => {
  const { catalog, ctx, quote } = await shop();
  assert.equal(await renameCatalogProduct(catalog, { catalogItemId: 'shirt', name: '  Proof shirt ' }), true);
  assert.equal((await catalog.get('shirt')).name, 'Proof shirt');
  assert.equal((await catalog.get('shirt-large')).name, 'Proof shrit', 'only the product record holds the name');
  assert.equal((await catalog.get('shirt')).creationPayload.name, 'Proof shrit', 'the create replay keeps its first payload');
  assert.equal((await readPublicCatalogItem(ctx, 'shirt')).name, 'Proof shirt');
  assert.deepEqual((await quote(['shirt', 'shirt-large'])).lines.map((line) => line.name), ['Proof shirt', 'Proof shirt']);
  assert.equal(await renameCatalogProduct(catalog, { catalogItemId: 'shirt', name: 'Proof shirt' }), false);
  await assert.rejects(renameCatalogProduct(catalog, { catalogItemId: 'shirt', name: ' ' }), (error) => error.code === 'INVALID_INPUT');
  await assert.rejects(renameCatalogProduct(catalog, { catalogItemId: 'shirt-large', name: 'Only large' }), (error) => error.code === 'CATALOG_ITEM_NOT_FOUND');
  await assert.rejects(renameCatalogProduct(catalog, { catalogItemId: 'missing', name: 'X' }), (error) => error.code === 'CATALOG_ITEM_NOT_FOUND');
});

test('a Draft product leaves the shop and checkout refuses it until it is on sale again', async () => {
  const { catalog, ctx, quote } = await shop();
  assert.equal(await setCatalogProductOnSale(catalog, { catalogItemId: 'shirt', onSale: false }), true);
  assert.equal((await catalog.get('shirt')).offSale, true);
  assert.equal('offSale' in await catalog.get('shirt-large'), false, 'only the product record holds the state');
  assert.deepEqual((await readPublicCatalog(ctx)).products.map((product) => product.id), ['mug']);
  assert.equal(await readPublicCatalogItem(ctx, 'shirt'), null);
  assert.equal(await readPublicCatalogItem(ctx, 'shirt-large'), null);
  assert.deepEqual(await quote(['mug', 'shirt-large']), { ok: false, reason: 'unavailable' });
  const listed = (await listCatalogProducts({ catalog, prices: ctx.storage.catalog_prices, availability: ctx.storage.catalog_manual_availability })).products;
  assert.equal(listed.find((product) => product.catalogItemId === 'shirt').offSale, true, 'the owner still finds it');
  assert.equal(await setCatalogProductOnSale(catalog, { catalogItemId: 'shirt', onSale: false }), false);
  assert.equal(await setCatalogProductOnSale(catalog, { catalogItemId: 'shirt', onSale: true }), true);
  assert.equal((await catalog.get('shirt')).offSale, undefined);
  assert.equal((await quote(['shirt-large'])).ok, true);
  await assert.rejects(setCatalogProductOnSale(catalog, { catalogItemId: 'shirt', onSale: 'yes' }), (error) => error.code === 'INVALID_INPUT');
});

// The panel draws its cards as accordions; forms and notes sit inside them.
const blocksOf = (blocks) => blocks.flatMap((block) => block.type === 'accordion' ? blocksOf(block.blocks) : [block]);
const stateOf = (out) => out.blocks.find((block) => block.type === 'fields')?.fields.find((field) => field.label === 'Status')?.value;
test('the product page panel names the product from the page title and leaves archiving to the page', async () => {
  const { catalog, ctx } = await shop();
  const opened = await commerceAdmin({ input: { type: 'block_action', action_id: 'open', value: 'mug' } }, ctx);
  assert.equal(opened.blocks.some((block) => block.type === 'code'), false, 'nobody copies an id any more');
  const grid = opened.blocks.find((block) => block.type === 'fields');
  assert.deepEqual(grid.fields.map((field) => [field.label, field.value]), [['Status', 'On sale'], ['SKU', 'MUG'], ['Name (page title)', 'Proof mug']]);
  assert.equal(opened.blocks.some((block) => block.type === 'form' && block.submit.action_id.startsWith('rename:')), false, 'the page title is the one name');
  // Archive is the page's own Move to trash, so the panel has no Archive or Restore of its own (catalog-archive-is-page-trash-20261115).
  assert.equal(blocksOf(opened.blocks).some((block) => block.type === 'actions' && block.elements.some((element) => element.action_id === 'archive')), false);
  const stale = await commerceAdmin({ input: { type: 'block_action', action_id: 'archive', value: { id: 'mug', a: true } } }, ctx);
  assert.notEqual(stale.toast?.message, 'Product archived');
  assert.equal('archivedAt' in await catalog.get('mug'), false, 'an old Archive press changes nothing');
  assert.equal(stateOf(await commerceAdmin({ input: { type: 'block_action', action_id: 'open', value: 'mug' } }, ctx)), 'On sale');
});

test('a choice added to a Draft product stays off the shop and out of checkout', async () => {
  const { catalog, ctx, quote } = await shop();
  await setCatalogProductOnSale(catalog, { catalogItemId: 'mug', onSale: false });
  await addCatalogVariantOption({ catalog }, { productId: 'mug', optionId: 'size', optionLabel: 'Size', values: [
    { valueId: 'small', label: 'Small', member: { catalogItemId: 'mug', fulfillment: 'physical' } },
    { valueId: 'large', label: 'Large', member: { commandId: 'create-mug-large', name: 'Proof mug', sku: 'MUG-L', fulfillment: 'physical' } },
  ] }, { createId: () => 'mug-large' });
  ctx.storage.catalog_prices.records.set('mug-large', price('mug-large', '1500'));
  assert.deepEqual(await quote(['mug-large']), { ok: false, reason: 'unavailable' });
  assert.equal(await readPublicCatalogItem(ctx, 'mug-large'), null);
  await setCatalogProductOnSale(catalog, { catalogItemId: 'mug', onSale: true });
  assert.equal((await quote(['mug-large'])).ok, true);
});

test('the managed-stock availability entry refuses a Draft product before asking Inventory', async () => {
  const catalog = new Catalog(), empty = new Catalog();
  await catalog.put('kit', { recordKind: 'catalog-item', itemId: 'kit', commandId: 'create-kit', kind: 'simple-product', name: 'Kit', sku: 'KIT', skuKey: 'KIT',
    state: 'draft', createdAt: '2026-10-01T00:00:00.000Z', creationIntent: { manageStock: true }, offSale: true,
    stockManagement: { mode: 'managed', status: 'active', inventorySku: 'KIT' } });
  const result = await resolveManagedStorefrontAvailability({ catalog, prices: empty, backorderPolicies: empty, configurations: empty, settings: empty },
    { catalogItemId: 'kit' }, { resolveProvider: () => { throw new Error('Inventory must not be asked'); } });
  assert.equal(result.sellable, false);
  assert.equal(result.listable, false);
});

test('an existing product without a creation record keeps create replay working after rename and Draft', async () => {
  const { catalog } = await shop();
  await createCatalogItem(catalog, { commandId: 'create-cap', name: 'Proof cap', sku: 'CAP' }, { createId: () => 'cap' });
  const legacy = await catalog.get('cap');
  delete legacy.creationPayload;
  await catalog.put('cap', legacy);
  await renameCatalogProduct(catalog, { catalogItemId: 'cap', name: 'Proof hat' });
  await setCatalogProductOnSale(catalog, { catalogItemId: 'cap', onSale: false });
  await setCatalogProductOnSale(catalog, { catalogItemId: 'cap', onSale: true });
  assert.equal((await catalog.get('cap')).creationPayload.name, 'Proof cap');
  const replay = await createCatalogItem(catalog, { commandId: 'create-cap', name: 'Proof cap', sku: 'CAP' }, { createId: () => 'other' });
  assert.equal(replay.item.itemId, 'cap');
  assert.equal(replay.item.name, 'Proof hat');
});

test('Save options keeps option and value ids that contain a colon', async () => {
  const { catalog, ctx } = await shop();
  await createCatalogItem(catalog, { commandId: 'create-cap', name: 'Proof cap', sku: 'CAP', fulfillment: 'physical' }, { createId: () => 'cap' });
  await addCatalogVariantOption({ catalog }, { productId: 'cap', optionId: 'fit:v1', optionLabel: 'Fit', values: [
    { valueId: 'size:small', label: 'Small', member: { catalogItemId: 'cap', fulfillment: 'physical' } },
    { valueId: 'size:large', label: 'Large', member: { commandId: 'create-cap-large', name: 'Proof cap', sku: 'CAP-L', fulfillment: 'physical' } },
  ] }, { createId: () => 'cap-large' });
  const opened = await commerceAdmin({ input: { type: 'block_action', action_id: 'open', value: 'cap' } }, ctx);
  const form = blocksOf(opened.blocks).find((block) => block.type === 'form' && block.submit.label === 'Save options');
  const values = Object.fromEntries(form.fields.map((field) => [field.action_id, field.initial_value]));
  values[form.fields.find((field) => field.initial_value === 'Small').action_id] = 'Petite';
  const saved = await commerceAdmin({ input: { type: 'form_submit', action_id: form.submit.action_id, values } }, ctx);
  assert.notEqual(saved.toast?.type, 'error');
  assert.deepEqual((await catalog.get('cap')).variantProduct.options[0].values.map((value) => [value.valueId, value.label]),
    [['size:small', 'Petite'], ['size:large', 'Large']]);
});

// catalog-panel-cards-20261031: a product is simple until it has an option. Its Variants card stays collapsed and asks for an
// option name and values, as Shopify's "Add options like size or color" does; a product with options opens on its variants.
test('a simple product keeps its Variants card collapsed with the option form, and a product with options opens it', async () => {
  const { ctx } = await shop();
  const variants = (out) => out.blocks.find((block) => block.type === 'accordion' && block.label.startsWith('Variants'));
  const mug = variants(await commerceAdmin({ input: { type: 'block_action', action_id: 'open', value: 'mug' } }, ctx));
  assert.equal(mug.label, 'Variants \u00b7 none');
  assert.equal(mug.default_open, false);
  assert.match(mug.blocks[0].text, /first variant/);
  const add = mug.blocks.find((block) => block.type === 'form');
  assert.equal(add.submit.label, 'Add options');
  assert.deepEqual(add.fields.map((field) => field.action_id), ['optionLabel', 'values']);
  const shirt = variants(await commerceAdmin({ input: { type: 'block_action', action_id: 'open', value: 'shirt' } }, ctx));
  assert.equal(shirt.label, 'Variants \u00b7 2');
  assert.equal(shirt.default_open, true);
  assert.equal(blocksOf(shirt.blocks).some((block) => block.type === 'context' && /first variant/.test(block.text)), false);
  // Each variant is its own card with its price form; the first one open.
  const cards = shirt.blocks.filter((block) => block.type === 'accordion');
  assert.deepEqual(cards.slice(0, 2).map((card) => [card.label, card.default_open, card.blocks.some((block) => block.type === 'form' && block.submit.label === 'Save')]), [['Small \u00b7 $20.00', true, true], ['Large \u00b7 $24.00', false, true]]);
  assert.deepEqual(cards.slice(2).map((card) => card.label), ['Edit options', 'Add another option', 'Add a variant']);
});

test('a product with no Regular price says so instead of Product saved or On sale', async () => {
  const { catalog, ctx } = await shop();
  const says = (out) => out.blocks.filter((block) => block.type === 'context').map((block) => block.text);
  const save = (regular) => commerceAdmin({ input: { type: 'form_submit', action_id: 'save:mug', values: { regular, sale: '' } } }, ctx);
  const opened = await commerceAdmin({ input: { type: 'block_action', action_id: 'open', value: 'mug' } }, ctx);
  assert.equal(says(opened).includes('Add a Regular price to sell it'), false);
  const cleared = await save('');
  assert.deepEqual(cleared.toast, { type: 'info', message: 'Add a Regular price to sell it' });
  assert.equal(stateOf(cleared), 'Published: off the shop');
  assert.ok(says(cleared).includes('Add a Regular price to sell it'));
  assert.equal(await readPublicCatalogItem(ctx, 'mug'), null, 'a missing price still keeps it off the shop');
  // A Draft keeps its state line and also names the missing price.
  await setCatalogProductOnSale(catalog, { catalogItemId: 'mug', onSale: false });
  const draft = await commerceAdmin({ input: { type: 'block_action', action_id: 'open', value: 'mug' } }, ctx);
  assert.match(stateOf(draft), /^Draft: publish to sell it/);
  assert.ok(says(draft).includes('Add a Regular price to sell it'));
  await setCatalogProductOnSale(catalog, { catalogItemId: 'mug', onSale: true });
  // An explicit zero is a price.
  const zero = await save('0');
  assert.deepEqual(zero.toast, { type: 'success', message: 'Product saved' });
  assert.equal(stateOf(zero), 'On sale');
  assert.equal(says(zero).includes('Add a Regular price to sell it'), false);
  // A refused save still says why.
  assert.equal((await save('abc')).toast.type, 'error');
});

test('a variant saved with no Regular price says so, and the product is unpriced only when no variant has one', async () => {
  const { ctx } = await shop();
  // Stored prices carry revisions, as real storage does, so each choice's form names the one it read.
  for (const [id, row] of [...ctx.storage.catalog_prices.records]) await ctx.storage.catalog_prices.put(id, row);
  const says = (out) => out.blocks.filter((block) => block.type === 'context').map((block) => block.text);
  const clear = async (out, member) => {
    const form = blocksOf(out.blocks).find((block) => block.type === 'form' && block.submit.action_id.startsWith('variant:') && JSON.parse(block.submit.action_id.slice(8))[2] === member);
    return commerceAdmin({ input: { type: 'form_submit', action_id: form.submit.action_id, values: { regular: '', sale: '' } } }, ctx);
  };
  const opened = await commerceAdmin({ input: { type: 'block_action', action_id: 'open', value: 'shirt' } }, ctx);
  const one = await clear(opened, 'shirt-large');
  assert.deepEqual(one.toast, { type: 'info', message: 'Add a Regular price to sell it' });
  assert.equal(stateOf(one), 'On sale', 'Small still has a price');
  assert.equal(says(one).includes('Add a Regular price to sell it'), false);
  const both = await clear(one, 'shirt');
  assert.equal(stateOf(both), 'Published: off the shop');
  assert.ok(says(both).includes('Add a Regular price to sell it'));
});
