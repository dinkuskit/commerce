import assert from 'node:assert/strict';
import test from 'node:test';
import { commerceAdmin } from '../../../dist/admin/index.js';
import { addCatalogVariantOption, createCatalogItem, renameCatalogProduct, setCatalogProductArchived, listCatalogProducts } from '../../../dist/features/catalog/kernel/index.js';
import { readPublicCatalog, readPublicCatalogItem, renameCatalogProductRoute, setCatalogProductArchivedRoute } from '../../../dist/features/catalog/index.js';
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
  const storage = { catalog_items: catalog, catalog_prices: prices, catalog_manual_availability: empty,
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

test('an archived product leaves the shop and checkout refuses it; restoring brings it back', async () => {
  const { catalog, ctx, quote } = await shop();
  assert.equal(await setCatalogProductArchived(catalog, { catalogItemId: 'shirt', archived: true }, () => new Date('2026-10-17T21:00:00Z')), true);
  assert.equal((await catalog.get('shirt')).archivedAt, '2026-10-17T21:00:00.000Z');
  assert.equal('archivedAt' in await catalog.get('shirt-large'), false, 'only the product record holds the state');
  assert.deepEqual((await readPublicCatalog(ctx)).products.map((product) => product.id), ['mug']);
  assert.equal(await readPublicCatalogItem(ctx, 'shirt'), null);
  assert.equal(await readPublicCatalogItem(ctx, 'shirt-large'), null);
  assert.deepEqual(await quote(['mug', 'shirt-large']), { ok: false, reason: 'unavailable' });
  const listed = (await listCatalogProducts({ catalog, prices: ctx.storage.catalog_prices, availability: ctx.storage.catalog_manual_availability })).products;
  assert.equal(listed.find((product) => product.catalogItemId === 'shirt').archivedAt, '2026-10-17T21:00:00.000Z', 'the owner still finds it');
  assert.equal(await setCatalogProductArchived(catalog, { catalogItemId: 'shirt', archived: true }), false);
  assert.equal(await setCatalogProductArchived(catalog, { catalogItemId: 'shirt', archived: false }), true);
  assert.equal('archivedAt' in await catalog.get('shirt'), false);
  assert.deepEqual((await readPublicCatalog(ctx)).products.map((product) => product.id).sort(), ['mug', 'shirt']);
  assert.equal((await quote(['shirt-large'])).ok, true);
  await assert.rejects(setCatalogProductArchived(catalog, { catalogItemId: 'shirt', archived: 'yes' }), (error) => error.code === 'INVALID_INPUT');
});

test('native routes rename and archive with content:edit_any over POST', async () => {
  const { catalog } = await shop();
  for (const route of [renameCatalogProductRoute, setCatalogProductArchivedRoute]) {
    assert.equal(route.public, false);
    assert.equal(route.permission, 'content:edit_any');
  }
  const call = (route, input, method = 'POST') => route.handler({ request: { method }, input, storage: { catalogItems: catalog } });
  assert.deepEqual(await call(renameCatalogProductRoute, { catalogItemId: 'mug', name: 'Proof cup' }), { changed: true });
  assert.deepEqual(await call(setCatalogProductArchivedRoute, { catalogItemId: 'mug', archived: true }), { changed: true });
  await assert.rejects(call(renameCatalogProductRoute, { catalogItemId: 'mug', name: '' }), (error) => error.code === 'INVALID_INPUT');
  await assert.rejects(call(setCatalogProductArchivedRoute, {}, 'GET'), (error) => error.code === 'METHOD_NOT_ALLOWED');
});

test('the owner sees the product id, renames, archives and restores from the Products page', async () => {
  const { catalog, ctx } = await shop();
  const opened = await commerceAdmin({ input: { type: 'block_action', action_id: 'open', value: 'mug' } }, ctx);
  assert.ok(opened.blocks.some((block) => block.type === 'code' && block.code === 'mug'));
  const renameForm = opened.blocks.find((block) => block.type === 'form' && block.submit.action_id === 'rename:mug');
  assert.equal(renameForm.fields[0].initial_value, 'Proof mug');
  const refused = await commerceAdmin({ input: { type: 'form_submit', action_id: 'rename:mug', values: { name: '\u0007' } } }, ctx);
  assert.equal(refused.toast.type, 'error');
  assert.equal(refused.blocks.find((block) => block.type === 'form' && block.submit.action_id === 'rename:mug').fields[0].initial_value, '\u0007', 'typed name kept');
  const renamed = await commerceAdmin({ input: { type: 'form_submit', action_id: 'rename:mug', values: { name: 'Proof cup' } } }, ctx);
  assert.deepEqual(renamed.toast, { type: 'success', message: 'Product renamed' });
  assert.equal(renamed.blocks[0].text, 'Proof cup');
  const archive = renamed.blocks.flatMap((block) => block.type === 'actions' ? block.elements : []).find((element) => element.action_id === 'archive');
  assert.equal(archive.label, 'Archive product');
  assert.ok(archive.confirm, 'archiving asks first');
  const archived = await commerceAdmin({ input: { type: 'block_action', action_id: 'archive', value: archive.value } }, ctx);
  assert.deepEqual(archived.toast, { type: 'success', message: 'Product archived' });
  assert.ok(archived.blocks.some((block) => block.type === 'banner' && /Archived/.test(block.title)));
  const list = await commerceAdmin({ input: { type: 'page_load', page: '/products' } }, ctx);
  assert.ok(list.blocks.some((block) => block.type === 'section' && block.text === 'Proof cup — MUG · Archived'));
  const restore = archived.blocks.flatMap((block) => block.type === 'actions' ? block.elements : []).find((element) => element.action_id === 'archive');
  assert.equal(restore.label, 'Restore product');
  const restored = await commerceAdmin({ input: { type: 'block_action', action_id: 'archive', value: restore.value } }, ctx);
  assert.deepEqual(restored.toast, { type: 'success', message: 'Product restored' });
  assert.equal('archivedAt' in await catalog.get('mug'), false);
});

test('a choice added to an archived product stays off the shop and out of checkout', async () => {
  const { catalog, ctx, quote } = await shop();
  await setCatalogProductArchived(catalog, { catalogItemId: 'mug', archived: true });
  await addCatalogVariantOption({ catalog }, { productId: 'mug', optionId: 'size', optionLabel: 'Size', values: [
    { valueId: 'small', label: 'Small', member: { catalogItemId: 'mug', fulfillment: 'physical' } },
    { valueId: 'large', label: 'Large', member: { commandId: 'create-mug-large', name: 'Proof mug', sku: 'MUG-L', fulfillment: 'physical' } },
  ] }, { createId: () => 'mug-large' });
  ctx.storage.catalog_prices.records.set('mug-large', price('mug-large', '1500'));
  assert.deepEqual(await quote(['mug-large']), { ok: false, reason: 'unavailable' });
  assert.equal(await readPublicCatalogItem(ctx, 'mug-large'), null);
  await setCatalogProductArchived(catalog, { catalogItemId: 'mug', archived: false });
  assert.equal((await quote(['mug-large'])).ok, true);
});

test('the managed-stock availability entry refuses an archived product before asking Inventory', async () => {
  const catalog = new Catalog(), empty = new Catalog();
  await catalog.put('kit', { recordKind: 'catalog-item', itemId: 'kit', commandId: 'create-kit', kind: 'simple-product', name: 'Kit', sku: 'KIT', skuKey: 'KIT',
    state: 'draft', createdAt: '2026-10-01T00:00:00.000Z', creationIntent: { manageStock: true }, archivedAt: '2026-10-17T21:00:00.000Z',
    stockManagement: { mode: 'managed', status: 'active', inventorySku: 'KIT' } });
  const result = await resolveManagedStorefrontAvailability({ catalog, prices: empty, backorderPolicies: empty, configurations: empty, settings: empty },
    { catalogItemId: 'kit' }, { resolveProvider: () => { throw new Error('Inventory must not be asked'); } });
  assert.equal(result.sellable, false);
  assert.equal(result.listable, false);
});

test('an existing product without a creation record keeps create replay working after rename and archive', async () => {
  const { catalog } = await shop();
  await createCatalogItem(catalog, { commandId: 'create-cap', name: 'Proof cap', sku: 'CAP' }, { createId: () => 'cap' });
  const legacy = await catalog.get('cap');
  delete legacy.creationPayload;
  await catalog.put('cap', legacy);
  await renameCatalogProduct(catalog, { catalogItemId: 'cap', name: 'Proof hat' });
  await setCatalogProductArchived(catalog, { catalogItemId: 'cap', archived: true });
  await setCatalogProductArchived(catalog, { catalogItemId: 'cap', archived: false });
  assert.equal((await catalog.get('cap')).creationPayload.name, 'Proof cap');
  const replay = await createCatalogItem(catalog, { commandId: 'create-cap', name: 'Proof cap', sku: 'CAP' }, { createId: () => 'other' });
  assert.equal(replay.item.itemId, 'cap');
  assert.equal(replay.item.name, 'Proof hat');
});
