import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBlockResponse } from '@emdash-cms/blocks/server';
import { commerceAdmin, productPanel } from '../../../dist/admin/index.js';
import { addCatalogVariantOption, createCatalogItem, linkProductPage, pageProduct, setProductPageOnSale } from '../../../dist/features/catalog/kernel/index.js';
import { CATALOG_BACKORDER_POLICIES_COLLECTION, CATALOG_COLLECTION, CATALOG_MANUAL_AVAILABILITY_COLLECTION, CATALOG_MEDIA_COLLECTION, CATALOG_PRICES_COLLECTION, PRODUCT_FEED_ELIGIBILITY_COLLECTION, readPublicCatalog, readPublicCatalogItem, setProductPageOnSaleRoute } from '../../../dist/features/catalog/index.js';

class Store {
  records = new Map(); revisions = new Map();
  constructor(index) { this.index = index; }
  async get(id) { return structuredClone(this.records.get(id) ?? null); }
  async getMany(ids) { const found = new Map(); for (const id of ids) { const row = await this.get(id); if (row !== null) found.set(id, row); } return found; }
  async getVersioned(id) { const value = await this.get(id); return value ? { value, revision: this.revisions.get(id) } : null; }
  async put(id, row) {
    if (this.index) for (const [key, other] of this.records) for (const field of ['commandId', 'skuKey']) {
      if (key !== id && row[field] !== undefined && row[field] === other[field]) throw new Error(`UNIQUE constraint failed: index 'uidx_plugin_dinkus-commerce_${this.index}_${field}'`);
    }
    this.records.set(id, structuredClone(row)); this.revisions.set(id, String(Number(this.revisions.get(id) ?? 0) + 1));
  }
  async delete(id) { this.records.delete(id); this.revisions.delete(id); }
  async deleteMany(ids) { for (const id of ids) await this.delete(id); return ids.length; }
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

async function shop() {
  const catalog = new Store('catalog_items'), pages = new Store(), empty = new Store();
  await createCatalogItem(catalog, { commandId: 'create-mug', name: 'Mug', sku: 'MUG', fulfillment: 'physical' }, { createId: () => 'mug', collection: 'catalog_items' });
  const storage = { catalog_items: catalog, product_pages: pages, catalog_prices: empty, catalog_manual_availability: empty,
    catalog_backorder_policies: empty, store_inventory_configurations: empty, storefront_availability_settings: empty,
    storefront_out_of_stock_listing: empty, catalog_media: empty, storefront_placeholder_image: empty, managed_sku_claims: empty };
  return { catalog, pages, ctx: { site: { url: 'https://shop.example.test' }, storage } };
}
const ui = (id = 'page-1') => ({ surface: 'content-editor-panel', locale: 'en', direction: 'ltr', extensionId: 'product', entry: { collection: 'products', id, locale: null, version: 1 } });
const panel = (input, ctx, id) => productPanel({ input, ui: ui(id) }, ctx);
const texts = (blocks) => JSON.stringify(blocks);
// The page's first Save (or a catalog API create) notes its product; tests note a seeded one directly.
const pick = (ctx, product, id = 'page-1') => linkProductPage({ catalog: ctx.storage.catalog_items, pages: ctx.storage.product_pages }, id, product);

test('the panel refuses to run outside a product page editor', async () => {
  const { ctx } = await shop();
  const out = await productPanel({ input: { type: 'panel_load' } }, ctx);
  assert.equal(out.toast?.type, 'error');
});

test('an unlinked page opens on the price form whose Save makes the product: every product is made for its page', async () => {
  const { ctx } = await shop();
  const out = await panel({ type: 'panel_load' }, ctx);
  assert.equal(validateBlockResponse(out).valid, true);
  const form = out.blocks.find((block) => block.type === 'form');
  assert.match(form.submit.action_id, /^sell:/);
  assert.equal(form.submit.label, 'Save');
  assert.deepEqual(form.fields.map((field) => field.action_id), ['regular', 'sale', 'sku', 'stockStatus', 'physical', 'weightOz']);
  assert.equal(form.fields.find((field) => field.action_id === 'stockStatus').initial_value, 'in-stock');
  assert.deepEqual(form.fields.find((field) => field.action_id === 'weightOz').condition, { field: 'physical', eq: true }, 'weight shows only for a physical product');
  assert.doesNotMatch(texts(out.blocks), /"mug"|Sell it here|Or its SKU|without a page/, 'no picking a product made elsewhere (catalog-product-needs-page-20261031)');
  // An older panel's attach button sells nothing and links nothing.
  const old = await panel({ type: 'form_submit', action_id: 'link', values: { product: 'mug' }, draft: { fields: {} } }, ctx);
  assert.equal(await pageProduct(ctx.storage.product_pages, 'page-1'), undefined);
  assert.equal(validateBlockResponse(old).valid, true);
  assert.equal(out.patch, undefined, 'loading never touches the page');
});

test('the first Save makes an unmanaged Draft and Commerce keeps the page\'s link', async () => {
  const { ctx, catalog, pages } = await shop();
  const writes = [], put = catalog.put.bind(catalog);
  catalog.put = async (id, row) => { writes.push(structuredClone(row)); return put(id, row); };
  const out = await panel({ type: 'form_submit', action_id: 'sell', values: { sku: '', manageStock: true }, draft: { fields: { title: 'Black hoodie' } } }, ctx);
  assert.equal(writes.find((row) => row.recordKind === 'catalog-item')?.offSale, true, 'the first write is already a Draft, so no stop leaves it on the shop');
  assert.notEqual(out.toast?.type, 'error', JSON.stringify(out));
  assert.equal(validateBlockResponse(out).valid, true);
  const made = [...catalog.records.values()].find((row) => row.name === 'Black hoodie' && row.itemId !== 'mug');
  assert.ok(made);
  assert.equal(made.offSale, true, 'a new product is a Draft until its page is published');
  assert.equal(made.fulfillment, 'physical');
  assert.equal(made.creationIntent?.manageStock ?? false, false);
  assert.match(made.sku, /^BLACK-HOODIE/);
  assert.equal(out.patch, undefined, 'the page has no product field to fill');
  assert.equal(out.toast?.message, 'Draft made. Publish the page to sell it.');
  assert.equal(await pageProduct(pages, 'page-1'), made.itemId);
  assert.equal(await readPublicCatalogItem(ctx, made.itemId), null, 'a Draft is not on the shop');
  const again = await panel({ type: 'panel_load' }, ctx);
  assert.match(texts(again.blocks), /Draft: publish to sell it/);
});

test('a refused first Save keeps the typed SKU', async () => {
  const { ctx } = await shop();
  const out = await panel({ type: 'form_submit', action_id: 'sell', values: { sku: 'MUG' }, draft: { fields: { title: 'Second mug' } } }, ctx);
  assert.equal(out.toast?.type, 'error');
  assert.equal(validateBlockResponse(out).valid, true);
  assert.match(texts(out.blocks), /"initial_value":"MUG"/);
});

test('a retried first Save resumes the product its first try made', async () => {
  const { ctx, catalog, pages } = await shop();
  const action = 'sell:' + crypto.randomUUID(), put = pages.put.bind(pages);
  pages.put = async () => { throw new Error('storage hiccup'); };
  const failed = await panel({ type: 'form_submit', action_id: action, values: { sku: '' }, draft: { fields: { title: 'Cap' } } }, ctx);
  assert.equal(failed.toast?.type, 'error');
  assert.match(texts(failed.blocks), new RegExp('"action_id":"' + action + '"'), 'the retry form keeps its create command');
  pages.put = put;
  const retried = await panel({ type: 'form_submit', action_id: action, values: { sku: '' }, draft: { fields: { title: 'Cap' } } }, ctx);
  assert.notEqual(retried.toast?.type, 'error', JSON.stringify(retried));
  const caps = [...catalog.records.values()].filter((row) => row.name === 'Cap');
  assert.equal(caps.length, 1, 'one product, not a second one');
  assert.equal(caps[0].offSale, true, 'the resumed product is still a Draft');
  assert.equal(await pageProduct(pages, 'page-1'), caps[0].itemId);
});

test('a page field naming another product changes nothing: Commerce holds the link', async () => {
  const { ctx, catalog, pages } = await shop();
  await createCatalogItem(catalog, { commandId: 'create-cap', name: 'Cap', sku: 'CAP', fulfillment: 'physical' }, { createId: () => 'cap', collection: 'catalog_items' });
  await pick(ctx, 'mug');
  // An older store's page still carries commerce_item_id; whatever it says, the panel acts on the linked product.
  const saved = await panel({ type: 'form_submit', action_id: 'save:mug', values: { regular: '9.00', sale: '' }, draft: { fields: { commerce_item_id: 'cap' } } }, ctx);
  assert.equal(await pageProduct(pages, 'page-1'), 'mug');
  assert.match(texts(saved.blocks), /"label":"SKU","value":"MUG"/);
  assert.equal(saved.patch, undefined);
  const loaded = await panel({ type: 'panel_load', draft: { fields: { commerce_item_id: 'cap' } } }, ctx);
  assert.match(texts(loaded.blocks), /"label":"SKU","value":"MUG"/);
  assert.equal((await ctx.storage.catalog_prices.get('cap')), null, 'the named product is not changed');
});

test('the publish check puts a product on sale and back to Draft, and a deleted page drops its link', async () => {
  const { ctx, catalog, pages } = await shop();
  const storage = { catalog, pages };
  await panel({ type: 'form_submit', action_id: 'sell', values: {}, draft: { fields: { title: 'Tee' } } }, ctx);
  const id = await pageProduct(pages, 'page-1');
  ctx.storage.catalog_prices = new Store();
  await ctx.storage.catalog_prices.put(id, { recordKind: 'catalog-price', recordId: id, catalogItemId: id, regular: { currency: 'USD', minor: '1500' } });
  assert.equal(await readPublicCatalogItem(ctx, id), null, 'a priced Draft is still off the shop');
  assert.deepEqual(await setProductPageOnSale(storage, { catalogItemId: id, entryId: 'page-1', onSale: true }), { changed: true });
  assert.equal((await readPublicCatalogItem(ctx, id))?.name, 'Tee', 'Published puts it on the shop');
  assert.match(JSON.stringify(await readPublicCatalog(ctx)), new RegExp(id));
  assert.deepEqual(await setProductPageOnSale(storage, { catalogItemId: id, entryId: 'page-1', onSale: true }), { changed: false });
  await setProductPageOnSale(storage, { catalogItemId: id, entryId: 'page-1', onSale: false });
  assert.equal(await readPublicCatalogItem(ctx, id), null);
  assert.ok(await pageProduct(pages, 'page-1'), 'unpublishing keeps the link');
  await setProductPageOnSale(storage, { catalogItemId: id, entryId: 'page-1', onSale: false, deleted: true });
  assert.equal(await pageProduct(pages, 'page-1'), undefined);
  await assert.rejects(setProductPageOnSale(storage, { catalogItemId: id, entryId: 'page-1', onSale: true, deleted: true }), (error) => error.code === 'INVALID_INPUT');
  await assert.rejects(setProductPageOnSale(storage, { catalogItemId: ' ', entryId: 'page-1', onSale: true }), (error) => error.code === 'INVALID_INPUT');
  await assert.rejects(setProductPageOnSale(storage, { catalogItemId: id, onSale: true }), (error) => error.code === 'INVALID_INPUT', 'the page is required');
  assert.equal(pages.records.size, 0);
});

test('the native publish route deletes a page\'s product with its own rows, as the Registry build does', async () => {
  const { ctx, catalog, pages } = await shop();
  await panel({ type: 'form_submit', action_id: 'sell', values: {}, draft: { fields: { title: 'Tee' } } }, ctx);
  const id = await pageProduct(pages, 'page-1');
  // The native build's exported collection names, as a host that mounts this route supplies them.
  const rows = [CATALOG_PRICES_COLLECTION, CATALOG_MANUAL_AVAILABILITY_COLLECTION, CATALOG_BACKORDER_POLICIES_COLLECTION, CATALOG_MEDIA_COLLECTION, PRODUCT_FEED_ELIGIBILITY_COLLECTION];
  assert.deepEqual(rows, ['catalogPrices', 'catalogManualAvailability', 'catalogBackorderPolicies', 'catalogMedia', 'productFeedEligibility']);
  const storage = { [CATALOG_COLLECTION]: catalog, product_pages: pages };
  for (const name of rows) { storage[name] = new Store(); await storage[name].put(id, { recordKind: name, catalogItemId: id }); }
  const route = input => setProductPageOnSaleRoute.handler({ request: { method: 'POST' }, input, storage });
  await route({ catalogItemId: id, entryId: 'page-1', onSale: false, deleted: true });
  assert.equal(await catalog.get(id), null, 'the product is deleted');
  for (const name of rows) assert.equal(await storage[name].get(id), null, `${name} is cleared with it`);
});

test('the publish check finds the page\'s product in Commerce, and the shop finds a product by its page', async () => {
  const { ctx, catalog, pages } = await shop();
  const storage = { catalog, pages };
  await createCatalogItem(catalog, { commandId: 'create-cap', name: 'Cap', sku: 'CAP', fulfillment: 'physical' }, { createId: () => 'cap', collection: 'catalog_items' });
  ctx.storage.catalog_prices = new Store();
  for (const id of ['mug', 'cap']) await ctx.storage.catalog_prices.put(id, { recordKind: 'catalog-price', recordId: id, catalogItemId: id, regular: { currency: 'USD', minor: '900' } });
  // A page Commerce holds no link for sells nothing; the template publishes it as a plain page.
  await assert.rejects(setProductPageOnSale(storage, { entryId: 'page-1', onSale: true }), (error) => error.code === 'CATALOG_ITEM_NOT_FOUND');
  assert.equal(pages.records.size, 0);
  await pick(ctx, 'mug');
  await setProductPageOnSale(storage, { entryId: 'page-1', onSale: true, name: 'Blue mug' });
  assert.equal((await catalog.get('mug')).pageId, 'page-1');
  const shown = await readPublicCatalogItem(ctx, 'page-1', true);
  assert.deepEqual([shown?.id, shown?.page, shown?.name], ['mug', 'page-1', 'Blue mug']);
  assert.equal((await readPublicCatalogItem(ctx, 'mug'))?.page, 'page-1', 'an item read names its page too');
  assert.equal((await readPublicCatalog(ctx)).products.find((p) => p.id === 'mug')?.page, 'page-1', 'the catalog lists each product\'s page');
  assert.equal((await readPublicCatalog(ctx)).products.find((p) => p.id === 'cap')?.page, undefined, 'a product no page has sold names none');
  assert.equal(await readPublicCatalogItem(ctx, 'page-2', true), null, 'a page that sells nothing');
  // An unsaved pick of the cap: the shop still shows what was published, and unpublishing takes that off.
  await pick(ctx, 'cap');
  assert.equal((await readPublicCatalogItem(ctx, 'page-1', true))?.id, 'mug');
  await setProductPageOnSale(storage, { entryId: 'page-1', onSale: false });
  assert.equal((await catalog.get('mug')).offSale, true);
  assert.equal(await readPublicCatalogItem(ctx, 'page-1', true), null, 'a Draft is off the shop');
  // Publishing again sells the panel's pick and gives the mug up.
  await setProductPageOnSale(storage, { entryId: 'page-1', onSale: true });
  assert.equal((await readPublicCatalogItem(ctx, 'page-1', true))?.id, 'cap');
  assert.equal((await catalog.get('mug')).pageId, undefined);
  await setProductPageOnSale(storage, { entryId: 'page-1', name: 'Red cap' });
  assert.equal((await catalog.get('cap')).name, 'Red cap', 'a title-only write renames what the page sells');
  // A product the page's last sale no longer holds is not shown for that page.
  await catalog.put('cap', { ...(await catalog.get('cap')), pageId: 'page-9' });
  assert.equal(await readPublicCatalogItem(ctx, 'page-1', true), null);
  await catalog.put('cap', { ...(await catalog.get('cap')), pageId: 'page-1' });
  await setProductPageOnSale(storage, { entryId: 'page-1', onSale: false, deleted: true });
  assert.equal(await pageProduct(pages, 'page-1'), undefined);
  assert.equal(await readPublicCatalogItem(ctx, 'page-1', true), null);
  await assert.rejects(setProductPageOnSale(storage, { entryId: 'page-1', onSale: true }), (error) => error.code === 'CATALOG_ITEM_NOT_FOUND', 'a deleted page names nothing');
});

test('deleting a page for good deletes its product, every variant and their rows, so the SKU can be used again', async () => {
  const { ctx, catalog, pages } = await shop();
  const names = ['catalog_prices', 'catalog_manual_availability', 'catalog_backorder_policies', 'catalog_media', 'product_feed_eligibility'];
  const rows = names.map(() => new Store());
  await addCatalogVariantOption({ catalog }, { productId: 'mug', optionId: 'size', optionLabel: 'Size', values: [
    { valueId: 'small', label: 'Small', member: { catalogItemId: 'mug', fulfillment: 'physical' } },
    { valueId: 'large', label: 'Large', member: { commandId: 'create-mug-large', name: 'Mug', sku: 'MUG-L', fulfillment: 'physical' } },
  ] }, { createId: () => 'mug-large', collection: 'catalog_items' });
  await createCatalogItem(catalog, { commandId: 'create-cap', name: 'Cap', sku: 'CAP', fulfillment: 'physical' }, { createId: () => 'cap', collection: 'catalog_items' });
  for (const row of rows) for (const id of ['mug', 'mug-large', 'cap']) await row.put(id, { catalogItemId: id });
  const storage = { catalog, pages, rows };
  await pick(ctx, 'mug');
  await setProductPageOnSale(storage, { entryId: 'page-1', onSale: true });
  await pick(ctx, 'cap', 'page-2');
  await setProductPageOnSale(storage, { entryId: 'page-2', onSale: true });
  // Moving the page to the trash keeps the product, to restore it.
  await setProductPageOnSale(storage, { entryId: 'page-1', onSale: false });
  assert.ok(await catalog.get('mug'));
  await setProductPageOnSale(storage, { entryId: 'page-1', onSale: false, deleted: true });
  for (const id of ['mug', 'mug-large']) {
    assert.equal(await catalog.get(id), null, `${id} is deleted`);
    rows.forEach((row, n) => assert.equal(row.records.has(id), false, `${id} keeps no ${names[n]} row`));
  }
  assert.equal((await catalog.get('cap')).pageId, 'page-2', 'a product another page sells is left alone');
  assert.ok(rows.every((row) => row.records.has('cap')));
  await createCatalogItem(catalog, { commandId: 'create-mug-again', name: 'Mug', sku: 'MUG', fulfillment: 'physical' }, { createId: () => 'mug-2', collection: 'catalog_items' });
  assert.equal((await catalog.get('mug-2')).sku, 'MUG', 'the SKU is free again');
  // A product a page lost to another page before it was deleted stays with that page.
  await catalog.put('cap', { ...(await catalog.get('cap')), pageId: 'page-3' });
  await pages.put('p:page-2', { entryId: 'page-2', catalogItemId: 'cap' });
  await setProductPageOnSale(storage, { entryId: 'page-2', onSale: false, deleted: true }).catch(() => {});
  assert.ok(await catalog.get('cap'));
});

test('a permanent delete that stops halfway holds its product until the same request finishes it', async () => {
  const { ctx, catalog, pages } = await shop();
  const names = ['catalog_prices', 'catalog_manual_availability', 'catalog_backorder_policies', 'catalog_media', 'product_feed_eligibility'];
  const rows = names.map(() => new Store());
  for (const row of rows) await row.put('mug', { catalogItemId: 'mug' });
  const storage = { catalog, pages, rows };
  await pick(ctx, 'mug');
  await setProductPageOnSale(storage, { entryId: 'page-1', onSale: true });
  const media = rows[3], deleteMany = media.deleteMany.bind(media);
  media.deleteMany = async () => { throw new Error('worker stopped'); };
  await assert.rejects(setProductPageOnSale(storage, { entryId: 'page-1', onSale: false, deleted: true }), /worker stopped/);
  assert.deepEqual([(await catalog.get('mug')).pageId, (await catalog.get('mug')).offSale], ['page-1', true], 'the deleted page still holds it, off the shop');
  // No other page can take a product halfway deleted.
  await assert.rejects(setProductPageOnSale(storage, { catalogItemId: 'mug', entryId: 'page-2', onSale: true }), (error) => error.code === 'PRODUCT_PAGE_CONFLICT');
  media.deleteMany = deleteMany;
  await setProductPageOnSale(storage, { entryId: 'page-1', onSale: false, deleted: true });
  assert.equal(await catalog.get('mug'), null);
  assert.ok(rows.every((row) => row.records.size === 0));
  assert.equal(pages.records.size, 0, 'the page\'s links go last');
});

test('a permanent delete that stopped after deleting one product finishes the rest on the same request', async () => {
  const { ctx, catalog, pages } = await shop();
  await createCatalogItem(catalog, { commandId: 'create-cap', name: 'Cap', sku: 'CAP', fulfillment: 'physical' }, { createId: () => 'cap', collection: 'catalog_items' });
  const rows = Array.from({ length: 5 }, () => new Store());
  for (const row of rows) for (const id of ['mug', 'cap']) await row.put(id, { catalogItemId: id });
  const storage = { catalog, pages, rows };
  // page-1 sold the mug, and a stopped check left the panel's pick, the cap, on sale under page-1 too.
  await setProductPageOnSale(storage, { catalogItemId: 'mug', entryId: 'page-1', onSale: true });
  const { offSale: _draft, ...cap } = await catalog.get('cap');
  await catalog.put('cap', { ...cap, pageId: 'page-1' });
  await pick(ctx, 'cap');
  const deleteMany = rows[0].deleteMany.bind(rows[0]);
  // Stopped before anything is deleted: the cap is already off the shop, still held by the page.
  rows[0].deleteMany = async () => { throw new Error('worker stopped'); };
  await assert.rejects(setProductPageOnSale(storage, { entryId: 'page-1', onSale: false, deleted: true }), /worker stopped/);
  assert.deepEqual([(await catalog.get('cap')).offSale, (await catalog.get('cap')).pageId, (await catalog.get('mug')).offSale], [true, 'page-1', true]);
  rows[0].deleteMany = async (ids) => { if (ids.includes('cap')) throw new Error('worker stopped'); return deleteMany(ids); };
  await assert.rejects(setProductPageOnSale(storage, { entryId: 'page-1', onSale: false, deleted: true }), /worker stopped/);
  assert.deepEqual([await catalog.get('mug'), (await catalog.get('cap')).pageId], [null, 'page-1'], 'the mug is gone, the cap still held');
  rows[0].deleteMany = deleteMany;
  await setProductPageOnSale(storage, { entryId: 'page-1', onSale: false, deleted: true });
  assert.equal(catalog.records.size, 0);
  assert.ok(rows.every((row) => row.records.size === 0));
  assert.equal(pages.records.size, 0);
  // Stopped after its last product, before its links: the same request clears the links.
  await createCatalogItem(catalog, { commandId: 'create-tee', name: 'Tee', sku: 'TEE', fulfillment: 'physical' }, { createId: () => 'tee', collection: 'catalog_items' });
  await setProductPageOnSale(storage, { catalogItemId: 'tee', entryId: 'page-2', onSale: true });
  await catalog.delete('tee');
  await setProductPageOnSale(storage, { entryId: 'page-2', onSale: false, deleted: true });
  assert.equal(pages.records.size, 0);
});

test('a variant added while its product is deleted for good is deleted too, or refused with nothing left', async () => {
  const { catalog, pages } = await shop();
  await addCatalogVariantOption({ catalog }, { productId: 'mug', optionId: 'size', optionLabel: 'Size', values: [
    { valueId: 'small', label: 'Small', member: { catalogItemId: 'mug', fulfillment: 'physical' } },
    { valueId: 'large', label: 'Large', member: { commandId: 'create-mug-large', name: 'Mug', sku: 'MUG-L', fulfillment: 'physical' } },
  ] }, { createId: () => 'mug-large', collection: 'catalog_items' });
  const addXl = (store, sku) => catalog.get('mug').then((mug) => addCatalogVariantOption({ catalog: store }, { productId: 'mug', expectedRevision: mug.variantProduct.revision,
    commandId: 'create-' + sku, name: 'Mug', sku, fulfillment: 'physical', selections: [{ optionId: 'size', valueId: sku, label: sku }] }, { createId: () => sku, collection: 'catalog_items' }));
  const rows = Array.from({ length: 5 }, () => new Store());
  const storage = { catalog, pages, rows };
  await setProductPageOnSale(storage, { catalogItemId: 'mug', entryId: 'page-1', onSale: true });
  // An agent adds an XL after the delete read the product: the product's own item is deleted only as read, so the XL goes too.
  let added = false;
  const deleteMany = rows[0].deleteMany.bind(rows[0]);
  rows[0].deleteMany = async (ids) => { if (!added) { added = true; await addXl(catalog, 'MUG-XL'); } return deleteMany(ids); };
  await setProductPageOnSale(storage, { entryId: 'page-1', onSale: false, deleted: true });
  assert.ok(added);
  assert.equal(catalog.records.size, 0, 'no variant is left behind');
  // An add that read the product just before it was deleted is refused, and its new variant is not kept.
  await createCatalogItem(catalog, { commandId: 'create-mug-again', name: 'Mug', sku: 'MUG', fulfillment: 'physical' }, { createId: () => 'mug', collection: 'catalog_items' });
  await addCatalogVariantOption({ catalog }, { productId: 'mug', optionId: 'size', optionLabel: 'Size', values: [
    { valueId: 'small', label: 'Small', member: { catalogItemId: 'mug', fulfillment: 'physical' } },
    { valueId: 'large', label: 'Large', member: { commandId: 'create-mug-large-2', name: 'Mug', sku: 'MUG-L', fulfillment: 'physical' } },
  ] }, { createId: () => 'mug-large', collection: 'catalog_items' });
  // An add that read the product before the delete began loses its commit to the delete and keeps nothing.
  await setProductPageOnSale(storage, { catalogItemId: 'mug', entryId: 'page-2', onSale: true });
  const stopped = rows[0].deleteMany;
  rows[0].deleteMany = async () => { throw new Error('worker stopped'); };
  const early = Object.create(catalog);
  early.getVersioned = async (id) => {
    const read = await catalog.getVersioned(id);
    if (id === 'mug') await assert.rejects(setProductPageOnSale(storage, { entryId: 'page-2', onSale: false, deleted: true }), /worker stopped/);
    return read;
  };
  await assert.rejects(addXl(early, 'MUG-3XL'), (error) => error.code === 'STORAGE_UNAVAILABLE');
  assert.equal(await catalog.get('MUG-3XL'), null, 'the lost variant is not kept while its product is being deleted');
  // The same for the first option of a product with none yet.
  await createCatalogItem(catalog, { commandId: 'create-tee', name: 'Tee', sku: 'TEE', fulfillment: 'physical' }, { createId: () => 'tee', collection: 'catalog_items' });
  await setProductPageOnSale(storage, { catalogItemId: 'tee', entryId: 'page-3', onSale: true });
  const teeEarly = Object.create(catalog);
  teeEarly.getVersioned = async (id) => {
    const read = await catalog.getVersioned(id);
    if (id === 'tee') await assert.rejects(setProductPageOnSale(storage, { entryId: 'page-3', onSale: false, deleted: true }), /worker stopped/);
    return read;
  };
  await assert.rejects(addCatalogVariantOption({ catalog: teeEarly }, { productId: 'tee', optionId: 'size', optionLabel: 'Size', values: [
    { valueId: 'small', label: 'Small', member: { catalogItemId: 'tee', fulfillment: 'physical' } },
    { valueId: 'large', label: 'Large', member: { commandId: 'create-tee-large', name: 'Tee', sku: 'TEE-L', fulfillment: 'physical' } },
  ] }, { createId: () => 'tee-large', collection: 'catalog_items' }), (error) => error.code === 'STORAGE_UNAVAILABLE');
  assert.equal(await catalog.get('tee-large'), null);
  rows[0].deleteMany = stopped;
  await setProductPageOnSale(storage, { entryId: 'page-3', onSale: false, deleted: true });
  await setProductPageOnSale(storage, { entryId: 'page-2', onSale: false, deleted: true });
  assert.equal(catalog.records.size, 0);
  await createCatalogItem(catalog, { commandId: 'create-mug-third', name: 'Mug', sku: 'MUG', fulfillment: 'physical' }, { createId: () => 'mug', collection: 'catalog_items' });
  await addCatalogVariantOption({ catalog }, { productId: 'mug', optionId: 'size', optionLabel: 'Size', values: [
    { valueId: 'small', label: 'Small', member: { catalogItemId: 'mug', fulfillment: 'physical' } },
    { valueId: 'large', label: 'Large', member: { commandId: 'create-mug-large-3', name: 'Mug', sku: 'MUG-L', fulfillment: 'physical' } },
  ] }, { createId: () => 'mug-large', collection: 'catalog_items' });
  const racing = Object.create(catalog);
  racing.getVersioned = async (id) => { const read = await catalog.getVersioned(id); if (id === 'mug') { for (const gone of ['mug', 'mug-large']) await catalog.delete(gone); } return read; };
  await assert.rejects(addXl(racing, 'MUG-2XL'), (error) => error.code === 'STORAGE_UNAVAILABLE');
  assert.equal(catalog.records.size, 0, 'the refused variant was not kept, so its SKU is free');
});

test('a variant added to the stray pick while its page is deleted for good is not kept', async () => {
  const { ctx, catalog, pages } = await shop();
  await createCatalogItem(catalog, { commandId: 'create-cap', name: 'Cap', sku: 'CAP', fulfillment: 'physical' }, { createId: () => 'cap', collection: 'catalog_items' });
  const rows = Array.from({ length: 5 }, () => new Store());
  const storage = { catalog, pages, rows };
  // page-1 sells the mug, and a stopped check left the panel's pick, the cap, under page-1 too: on sale, then already off.
  await setProductPageOnSale(storage, { catalogItemId: 'mug', entryId: 'page-1', onSale: true });
  await pick(ctx, 'cap');
  const deleteMany = rows[0].deleteMany.bind(rows[0]);
  for (const offSale of [undefined, true]) {
    const { offSale: _draft, ...cap } = await catalog.get('cap');
    await catalog.put('cap', { ...cap, pageId: 'page-1', offSale });
    // An agent's Add a variant read the cap just before the delete withdrew it, so its commit loses to the delete.
    rows[0].deleteMany = async () => { throw new Error('worker stopped'); };
    const early = Object.create(catalog);
    early.getVersioned = async (id) => {
      const read = await catalog.getVersioned(id);
      if (id === 'cap') await assert.rejects(setProductPageOnSale(storage, { entryId: 'page-1', onSale: false, deleted: true }), /worker stopped/);
      return read;
    };
    await assert.rejects(addCatalogVariantOption({ catalog: early }, { productId: 'cap', optionId: 'size', optionLabel: 'Size', values: [
      { valueId: 'small', label: 'Small', member: { catalogItemId: 'cap', fulfillment: 'physical' } },
      { valueId: 'large', label: 'Large', member: { commandId: 'create-cap-xl-' + offSale, name: 'Cap', sku: 'CAP-XL', fulfillment: 'physical' } },
    ] }, { createId: () => 'cap-xl', collection: 'catalog_items' }), (error) => error.code === 'STORAGE_UNAVAILABLE');
    assert.equal(await catalog.get('cap-xl'), null, 'the lost variant is not kept, so its SKU is not left taken');
    assert.equal((await catalog.get('cap')).deleting, true);
    const { deleting: _held, ...held } = await catalog.get('cap');
    await catalog.put('cap', held);
  }
  rows[0].deleteMany = deleteMany;
  await setProductPageOnSale(storage, { entryId: 'page-1', onSale: false, deleted: true });
  assert.equal(catalog.records.size, 0, 'no product or variant is left behind');
});

test('deleting the biggest product for good stays within the sandbox call budget', async () => {
  const { ctx, catalog, pages } = await shop();
  await addCatalogVariantOption({ catalog }, { productId: 'mug', optionId: 'size', optionLabel: 'Size', values: [
    { valueId: 'v0', label: 'V0', member: { catalogItemId: 'mug', fulfillment: 'physical' } },
    { valueId: 'v1', label: 'V1', member: { commandId: 'create-mug-1', name: 'Mug', sku: 'MUG-1', fulfillment: 'physical' } },
  ] }, { createId: () => 'mug-1', collection: 'catalog_items' });
  // Fifty variants, the most a product may have.
  const mug = await catalog.get('mug'), one = await catalog.get('mug-1'), [first, second] = mug.variantProduct.members;
  for (let n = 2; n < 50; n += 1) await catalog.put('mug-' + n, { ...one, itemId: 'mug-' + n, recordId: 'mug-' + n, commandId: 'create-mug-' + n, sku: 'MUG-' + n, skuKey: 'mug-' + n });
  await catalog.put('mug', { ...mug, variantProduct: { ...mug.variantProduct, members: [first, second, ...Array.from({ length: 48 }, (_, n) => ({ ...second, catalogItemId: 'mug-' + (n + 2) }))] } });
  const rows = Array.from({ length: 5 }, () => new Store());
  for (const row of rows) for (const id of catalog.records.keys()) await row.put(id, { catalogItemId: id });
  await pick(ctx, 'mug');
  await setProductPageOnSale({ catalog, pages, rows }, { entryId: 'page-1', onSale: true });
  assert.equal((await catalog.get('mug')).variantProduct.members.length, 50);
  let calls = 0;
  const counted = (store) => new Proxy(store, { get: (target, key) => typeof target[key] === 'function' ? (...args) => (calls += 1, target[key](...args)) : target[key] });
  await setProductPageOnSale({ catalog: counted(catalog), pages: counted(pages), rows: rows.map(counted) }, { entryId: 'page-1', onSale: false, deleted: true });
  assert.equal(catalog.records.size, 0, 'every variant is gone');
  assert.ok(rows.every((row) => row.records.size === 0));
  assert.ok(calls <= 32, `a permanent delete of fifty variants made ${calls} storage calls`);
});

test('publishing names the product from the page title, and only a publish does', async () => {
  const { ctx, catalog, pages } = await shop();
  const storage = { catalog, pages };
  await panel({ type: 'form_submit', action_id: 'sell', values: {}, draft: { fields: { title: 'Tee' } } }, ctx);
  const id = await pageProduct(pages, 'page-1');
  const shown = texts((await panel({ type: 'panel_load' }, ctx)).blocks);
  assert.match(shown, /Name \(page title\)/);
  assert.doesNotMatch(shown, /rename:|"Rename"/, 'the panel has no name of its own');
  ctx.storage.catalog_prices = new Store();
  await ctx.storage.catalog_prices.put(id, { recordKind: 'catalog-price', recordId: id, catalogItemId: id, regular: { currency: 'USD', minor: '1500' } });
  assert.deepEqual(await setProductPageOnSale(storage, { catalogItemId: id, entryId: 'page-1', onSale: true, name: '  Renamed Tee ' }), { changed: true });
  assert.equal((await readPublicCatalogItem(ctx, id))?.name, 'Renamed Tee', 'the shop shows the published title');
  assert.equal((await catalog.get(id)).creationPayload.name, 'Tee', 'the first creationPayload is kept');
  assert.deepEqual(await setProductPageOnSale(storage, { catalogItemId: id, entryId: 'page-1', onSale: true, name: 'Tee Two' }), { changed: false }, 'a rename alone is not a sale change');
  assert.equal((await catalog.get(id)).name, 'Tee Two');
  await setProductPageOnSale(storage, { catalogItemId: id, entryId: 'page-1', onSale: false, name: 'Ignored' });
  assert.equal((await catalog.get(id)).name, 'Tee Two', 'unpublishing never renames');
  for (const name of ['', ' ', 'x'.repeat(161), 'a\u0007b', 42]) {
    await assert.rejects(setProductPageOnSale(storage, { catalogItemId: id, entryId: 'page-1', onSale: true, name }), (error) => error.code === 'INVALID_INPUT');
  }
  assert.equal((await catalog.get(id)).name, 'Tee Two', 'a refused title changes nothing');
  assert.equal((await catalog.get(id)).offSale, true, 'and leaves the product a Draft');
  assert.deepEqual(await setProductPageOnSale(storage, { catalogItemId: id, entryId: 'page-1', name: 'Tee Three' }), { changed: false });
  assert.equal((await catalog.get(id)).name, 'Tee Three', 'a title-only write renames the page\'s product');
  assert.equal((await catalog.get(id)).offSale, true, 'and never puts it on sale');
  await setProductPageOnSale(storage, { catalogItemId: id, entryId: 'page-1', onSale: true });
  await setProductPageOnSale(storage, { catalogItemId: id, entryId: 'page-1', name: 'Tee Four' });
  assert.equal((await catalog.get(id)).offSale, undefined, 'nor takes it off');
  assert.equal((await catalog.get(id)).pageId, 'page-1');
  await setProductPageOnSale(storage, { catalogItemId: id, entryId: 'page-2', name: 'Not mine' });
  assert.equal((await catalog.get(id)).name, 'Tee Four', 'another page cannot rename it');
  await assert.rejects(setProductPageOnSale(storage, { catalogItemId: id, entryId: 'page-1', name: '' }), (error) => error.code === 'INVALID_INPUT');
  await assert.rejects(setProductPageOnSale(storage, { catalogItemId: id, entryId: 'page-1', name: 'x', deleted: true }), (error) => error.code === 'INVALID_INPUT');
});

test('the page that sells a product can always take it off sale, whatever other pages name it', async () => {
  const { catalog, pages } = await shop();
  const storage = { catalog, pages };
  await setProductPageOnSale(storage, { catalogItemId: 'mug', entryId: 'page-1', onSale: true });
  await assert.rejects(setProductPageOnSale(storage, { catalogItemId: 'mug', entryId: 'page-2', onSale: true }), (error) => error.code === 'PRODUCT_PAGE_CONFLICT');
  assert.deepEqual(await setProductPageOnSale(storage, { catalogItemId: 'mug', entryId: 'page-1', onSale: false }), { changed: true });
  await setProductPageOnSale(storage, { catalogItemId: 'mug', entryId: 'page-1', onSale: false, deleted: true });
  assert.equal(await pageProduct(pages, 'page-1'), undefined);
  // Once its page is gone for good, so is the product (catalog-permanent-delete-20261122).
  assert.equal(await catalog.get('mug'), null);
  await assert.rejects(setProductPageOnSale(storage, { catalogItemId: 'mug', entryId: 'page-2', onSale: true }), (error) => error.code === 'CATALOG_ITEM_NOT_FOUND');
});

test('upgrade: a published page with no link can still withdraw its product after another page linked it in the panel', async () => {
  const { ctx, catalog, pages } = await shop();
  // page-old was published before links existed; page-new picks the same product in its panel but is never saved.
  await pick(ctx, 'mug', 'page-new');
  assert.equal(await pageProduct(pages, 'page-new'), 'mug');
  assert.deepEqual(await setProductPageOnSale({ catalog, pages }, { catalogItemId: 'mug', entryId: 'page-old', onSale: false }), { changed: true });
  assert.equal((await catalog.get('mug')).pageId, 'page-old', 'the publish check records the page that names it');
  await assert.rejects(setProductPageOnSale({ catalog, pages }, { catalogItemId: 'mug', entryId: 'page-new', onSale: true }), (error) => error.code === 'PRODUCT_PAGE_CONFLICT');
});

test('two pages claiming one product at once: only one claim lands', async () => {
  const { catalog, pages } = await shop();
  const claims = await Promise.allSettled(['page-a', 'page-b'].map((entryId) => setProductPageOnSale({ catalog, pages }, { catalogItemId: 'mug', entryId, onSale: true })));
  assert.deepEqual(claims.map((c) => c.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(claims.find((c) => c.status === 'rejected').reason.code, 'PRODUCT_PAGE_CONFLICT');
  const owner = (await catalog.get('mug')).pageId;
  assert.deepEqual([...pages.records.keys()], ['p:' + owner]);
});

test('a page that gave its product up can never change it again, even with a request already in flight', async () => {
  const { ctx, catalog, pages } = await shop();
  await createCatalogItem(catalog, { commandId: 'create-cap', name: 'Cap', sku: 'CAP', fulfillment: 'physical' }, { createId: () => 'cap', collection: 'catalog_items' });
  await setProductPageOnSale({ catalog, pages }, { catalogItemId: 'mug', entryId: 'page-1', onSale: true });
  // An unsaved relink in the panel changes only the note: page-1 still sells the mug.
  await pick(ctx, 'cap', 'page-1');
  assert.equal((await catalog.get('mug')).pageId, 'page-1');
  // page-1 is published again selling the cap: the mug goes back to Draft with no page, and page-2 takes it.
  await setProductPageOnSale({ catalog, pages }, { catalogItemId: 'cap', entryId: 'page-1', onSale: true });
  assert.deepEqual([(await catalog.get('mug')).pageId, (await catalog.get('mug')).offSale], [undefined, true]);
  await setProductPageOnSale({ catalog, pages }, { catalogItemId: 'mug', entryId: 'page-2', onSale: true });
  // page-1's old unpublish, delayed until now, is refused in the same write that would change the mug.
  const before = await catalog.get('mug');
  for (const body of [{ onSale: false }, { onSale: false, deleted: true }]) {
    await assert.rejects(setProductPageOnSale({ catalog, pages }, { catalogItemId: 'mug', entryId: 'page-1', ...body }), (error) => error.code === 'PRODUCT_PAGE_CONFLICT');
  }
  assert.deepEqual(await catalog.get('mug'), before);
  assert.equal((await catalog.get('cap')).pageId, 'page-1');
});

test('of two overlapping publish checks for one page, the late one gives its product back', async () => {
  const { catalog, pages } = await shop();
  await createCatalogItem(catalog, { commandId: 'create-cap', name: 'Cap', sku: 'CAP', fulfillment: 'physical' }, { createId: () => 'cap', collection: 'catalog_items' });
  // The cap check reads the page's pointer, then the mug check runs to the end before the cap check writes.
  const read = pages.getVersioned.bind(pages);
  pages.getVersioned = async (key) => { pages.getVersioned = read; await setProductPageOnSale({ catalog, pages }, { catalogItemId: 'mug', entryId: 'page-1', onSale: true }); return null; };
  await assert.rejects(setProductPageOnSale({ catalog, pages }, { catalogItemId: 'cap', entryId: 'page-1', onSale: true }), (error) => error.code === 'PRODUCT_PAGE_CONFLICT');
  assert.equal((await pages.get('p:page-1')).catalogItemId, 'mug');
  assert.equal((await catalog.get('mug')).pageId, 'page-1');
  assert.deepEqual([(await catalog.get('cap')).pageId, (await catalog.get('cap')).offSale], [undefined, true]);
});

test('an old check giving a product up never takes it from a newer check by the same page', async () => {
  const { catalog, pages } = await shop();
  await createCatalogItem(catalog, { commandId: 'create-cap', name: 'Cap', sku: 'CAP', fulfillment: 'physical' }, { createId: () => 'cap', collection: 'catalog_items' });
  await setProductPageOnSale({ catalog, pages }, { catalogItemId: 'mug', entryId: 'page-1', onSale: true });
  // The page moves to the cap; before that check gives the mug up, a newer check moves the page back to the mug.
  const edit = catalog.compareAndSet.bind(catalog);
  let raced = false;
  catalog.compareAndSet = async (id, revision, value) => {
    if (id === 'mug' && !raced && value.offSale && !value.pageId) {
      raced = true;
      catalog.compareAndSet = edit;
      await setProductPageOnSale({ catalog, pages }, { catalogItemId: 'mug', entryId: 'page-1', onSale: true });
      return { applied: false };
    }
    return edit(id, revision, value);
  };
  await setProductPageOnSale({ catalog, pages }, { catalogItemId: 'cap', entryId: 'page-1', onSale: true }).catch(() => {});
  assert.ok(raced);
  const mug = await catalog.get('mug');
  assert.deepEqual([mug.pageId, mug.offSale], ['page-1', undefined], 'the newer check keeps the mug on sale');
});

test('a check that stops halfway is finished by the next one', async () => {
  const { catalog, pages } = await shop();
  await createCatalogItem(catalog, { commandId: 'create-cap', name: 'Cap', sku: 'CAP', fulfillment: 'physical' }, { createId: () => 'cap', collection: 'catalog_items' });
  await setProductPageOnSale({ catalog, pages }, { catalogItemId: 'mug', entryId: 'page-1', onSale: true });
  // The cap check claims the cap, then stops before it gives the mug up.
  const edit = catalog.compareAndSet.bind(catalog);
  catalog.compareAndSet = async (id, revision, value) => { if (id === 'mug') throw new Error('worker stopped'); return edit(id, revision, value); };
  await assert.rejects(setProductPageOnSale({ catalog, pages }, { catalogItemId: 'cap', entryId: 'page-1', onSale: true }));
  catalog.compareAndSet = edit;
  assert.equal((await pages.get('p:page-1')).catalogItemId, 'mug', 'the pointer has not moved');
  await setProductPageOnSale({ catalog, pages }, { catalogItemId: 'cap', entryId: 'page-1', onSale: true });
  const mug = await catalog.get('mug');
  assert.deepEqual([mug.pageId, mug.offSale], [undefined, true]);
  assert.equal((await pages.get('p:page-1')).catalogItemId, 'cap');
});

test('a check that sold the panel\'s pick and stopped before moving the pointer: trash or unpublish still takes that pick off the shop', async () => {
  const { ctx, catalog, pages } = await shop();
  const storage = { catalog, pages };
  await createCatalogItem(catalog, { commandId: 'create-cap', name: 'Cap', sku: 'CAP', fulfillment: 'physical' }, { createId: () => 'cap', collection: 'catalog_items' });
  ctx.storage.catalog_prices = new Store();
  for (const id of ['mug', 'cap']) await ctx.storage.catalog_prices.put(id, { recordKind: 'catalog-price', recordId: id, catalogItemId: id, regular: { currency: 'USD', minor: '900' } });
  await pick(ctx, 'mug');
  await setProductPageOnSale(storage, { entryId: 'page-1', onSale: true });
  // The editor picks the cap; the next publish check sells it, then stops before the page's pointer moves.
  await pick(ctx, 'cap');
  const move = pages.compareAndSet.bind(pages);
  pages.compareAndSet = async (id, ...rest) => { if (id === 'p:page-1') throw new Error('worker stopped'); return move(id, ...rest); };
  await assert.rejects(setProductPageOnSale(storage, { entryId: 'page-1', onSale: true }));
  pages.compareAndSet = move;
  assert.equal((await pages.get('p:page-1')).catalogItemId, 'mug', 'the pointer has not moved');
  assert.equal((await readPublicCatalogItem(ctx, 'cap'))?.name, 'Cap', 'the cap was left on sale');
  // Commerce has no Archive of its own (catalog-archive-is-page-trash-20261115): unpublishing the page withdraws it.
  assert.deepEqual(await setProductPageOnSale(storage, { entryId: 'page-1', onSale: false }), { changed: true });
  assert.deepEqual([(await catalog.get('cap')).offSale, (await catalog.get('cap')).pageId], [true, 'page-1']);
  assert.equal(await readPublicCatalogItem(ctx, 'cap'), null);
  assert.equal(await readPublicCatalogItem(ctx, 'mug'), null);
  // Deleted for good: the page's products go with it, the stray pick too.
  await setProductPageOnSale(storage, { entryId: 'page-1', onSale: false, deleted: true });
  assert.deepEqual([await catalog.get('cap'), await catalog.get('mug')], [null, null]);
});

test('a variant member is refused before any link changes', async () => {
  const { catalog, pages } = await shop();
  await catalog.put('mug-blue', { ...(await catalog.get('mug')), itemId: 'mug-blue', recordId: 'mug-blue', commandId: 'variant-blue', sku: 'MUG-BLUE', skuKey: 'mug-blue', variantProductId: 'mug' });
  await assert.rejects(setProductPageOnSale({ catalog, pages }, { catalogItemId: 'mug-blue', entryId: 'page-1', onSale: true }), (error) => error.code === 'CATALOG_ITEM_NOT_FOUND');
  assert.equal(pages.records.size, 0);
});

test('a refused publish check leaves the page links as they were', async () => {
  const { catalog, pages } = await shop();
  await createCatalogItem(catalog, { commandId: 'create-cap', name: 'Cap', sku: 'CAP', fulfillment: 'physical' }, { createId: () => 'cap', collection: 'catalog_items' });
  await setProductPageOnSale({ catalog, pages }, { catalogItemId: 'mug', entryId: 'page-1', onSale: true });
  const before = structuredClone([...pages.records]);
  await assert.rejects(setProductPageOnSale({ catalog, pages }, { catalogItemId: 'cap', entryId: 'page-1', onSale: 'false' }), (error) => error.code === 'INVALID_INPUT');
  await assert.rejects(setProductPageOnSale({ catalog, pages }, { catalogItemId: 'ghost', entryId: 'page-1', onSale: true }), (error) => error.code === 'CATALOG_ITEM_NOT_FOUND');
  assert.deepEqual([...pages.records], before);
  assert.equal(await pageProduct(pages, 'page-1'), 'mug');
});

test('a page naming a product another page sells changes nothing', async () => {
  const { ctx, catalog, pages } = await shop();
  const storage = { catalog, pages };
  await setProductPageOnSale(storage, { catalogItemId: 'mug', entryId: 'page-1', onSale: true });
  const before = await catalog.get('mug');
  for (const onSale of [true, false]) {
    await assert.rejects(setProductPageOnSale(storage, { catalogItemId: 'mug', entryId: 'page-2', onSale }), (error) => error.code === 'PRODUCT_PAGE_CONFLICT' && error.status === 409);
  }
  await assert.rejects(setProductPageOnSale(storage, { catalogItemId: 'mug', entryId: 'page-2', onSale: false, deleted: true }), (error) => error.code === 'PRODUCT_PAGE_CONFLICT');
  assert.deepEqual(await catalog.get('mug'), before);
  assert.equal(await pageProduct(pages, 'page-1'), 'mug');
  assert.equal(await pageProduct(pages, 'page-2'), undefined);
  assert.equal(ctx.storage.product_pages, pages);
});

test('Commerce settings has no Products without a page list: every product has its page', async () => {
  const { ctx } = await shop();
  ctx.storage.storefront_out_of_stock_listing = new Store();
  ctx.settings = { getVersioned: async () => null };
  const out = await commerceAdmin({ input: { type: 'page_load', page: '/settings' }, user: { role: 50 }, ui: { surface: 'admin-page', locale: 'en', direction: 'ltr' } }, ctx);
  assert.equal(validateBlockResponse(out).valid, true);
  const body = texts(out.blocks);
  assert.doesNotMatch(body, /Products without a page|Make a page/);
});

test('EmDash\'s timer publishing a product page sells its product only on a schedule an Editor or Admin set', async () => {
  const { default: plugin } = await import('../../../dist/plugin.js');
  const hook = (name) => plugin.hooks[name];
  const { ctx, catalog } = await shop();
  const warnings = [];
  ctx.log = { warn: (message, data) => warnings.push({ message, data }) };
  ctx.storage.scheduled_sales = new Store();
  ctx.storage.catalog_prices = new Store();
  await ctx.storage.catalog_prices.put('mug', { recordKind: 'catalog-price', recordId: 'mug', catalogItemId: 'mug', regular: { currency: 'USD', minor: '900' } });
  await pick(ctx, 'mug');
  const content = (at, title = 'Blue mug') => ({ id: 'page-1', scheduledAt: at, data: { title } });
  const at = '2026-11-22T18:00:00.000Z';
  const schedule = (role, when = at) => hook('content:beforeSchedule')({ collection: 'products', content: content(null), actor: role ? { id: 'u', role } : undefined, scheduledAt: when }, ctx);
  const publish = async (source, when = at) => {
    await hook('content:beforePublish')({ collection: 'products', content: content(when), origin: { source } }, ctx);
    await hook('content:afterPublish')({ collection: 'products', content: content(null, 'Old title') }, ctx);
  };
  const sold = async () => { const item = await catalog.get('mug'); return item.pageId === 'page-1' && !item.offSale; };
  // EmDash's timer has just published the page when Commerce sells it.
  ctx.content = { get: async (collection, id) => (collection === 'products' && id === 'page-1' ? { status: 'published' } : null) };
  // An Author's own publish and an Author's schedule sell nothing; the store's publish check decides a person's publish.
  await publish('user');
  assert.equal(await sold(), false);
  await schedule(30);
  await publish('scheduler');
  assert.equal(await sold(), false);
  // An Editor and an Author asking for the same moment sell nothing, in either order and when they overlap, because
  // either request may be the one EmDash keeps; each writes only its own record, so neither can undo the other.
  for (const order of [[40, 30], [30, 40]]) {
    for (const role of order) await schedule(role);
    await publish('scheduler');
    assert.equal(await sold(), false);
  }
  await Promise.all([schedule(40), schedule(30)]);
  await publish('scheduler');
  assert.equal(await sold(), false);
  // An Author's request for another moment, written after an Author's request for the Editor's moment, cannot hide it:
  // every request keeps its own record, whichever EmDash keeps.
  await schedule(40);
  await Promise.all([schedule(30), schedule(30, '2026-11-22T17:00:00.000Z')]);
  await publish('scheduler');
  assert.equal(await sold(), false);
  // An Author's request for another moment is not the one the timer publishes, so the Editor's schedule stands.
  await schedule(30, '2026-11-22T17:00:00.000Z');
  await schedule(40);
  // A person's publish of a page an Editor scheduled ends the schedule's sale.
  await publish('user');
  await publish('scheduler');
  assert.equal(await sold(), false);
  // The timer publishing a different moment than the Editor scheduled sells nothing.
  await schedule(40);
  await publish('scheduler', '2026-11-22T19:00:00.000Z');
  assert.equal(await sold(), false);
  // A sale Commerce could not write stays noted, and the background check tries it again while the page is published,
  // however many other pages have schedules waiting.
  for (let n = 0; n < 60; n += 1) await hook('content:beforeSchedule')({ collection: 'products', content: { id: `later-${n}` }, actor: { id: 'u', role: 40 }, scheduledAt: at }, ctx);
  await schedule(40);
  const put = catalog.put;
  catalog.put = async () => { throw new Error('D1 is busy'); };
  await publish('scheduler');
  assert.equal(await sold(), false);
  assert.deepEqual(warnings.at(-1), { message: 'Scheduled product page not put on sale', data: { pageId: 'page-1', code: undefined } });
  catalog.put = put;
  const background = (status) => plugin.hooks.cron.handler({ name: 'commerce-checkout-wakes' }, { ...ctx,
    content: { get: async (collection, id) => (collection === 'products' && id === 'page-1' && status ? { status } : null) } });
  const waiting = () => [...ctx.storage.scheduled_sales.records.keys()].filter((key) => !key.startsWith('later-'));
  assert.deepEqual(waiting(), ['page-1:go']);
  await background('draft').catch(() => {});
  assert.equal(await sold(), false, 'a page taken off the shop meanwhile is not sold');
  assert.deepEqual(waiting(), []);
  await schedule(40);
  catalog.put = async () => { throw new Error('D1 is busy'); };
  await publish('scheduler');
  catalog.put = put;
  await background('published').catch(() => {});
  // An Editor's schedule, published by EmDash's timer with nobody signed in, sells under the title it published.
  assert.equal(await sold(), true);
  assert.equal((await readPublicCatalogItem(ctx, 'page-1', true))?.name, 'Blue mug');
  assert.deepEqual(waiting(), []);
  // The background check has read a held sale when the owner takes the page off the shop and an Author publishes it
  // again: the product changed after EmDash's timer published the page, so the held sale is refused and nothing sells.
  await setProductPageOnSale({ catalog, pages: ctx.storage.product_pages }, { entryId: 'page-1', onSale: false });
  await schedule(40);
  catalog.put = async () => { throw new Error('D1 is busy'); };
  await publish('scheduler');
  catalog.put = put;
  assert.deepEqual(waiting(), ['page-1:go']);
  await plugin.hooks.cron.handler({ name: 'commerce-checkout-wakes' }, { ...ctx, content: { get: async () => {
    await setProductPageOnSale({ catalog, pages: ctx.storage.product_pages }, { entryId: 'page-1', onSale: false });
    await publish('user');
    return { status: 'published' };
  } } }).catch(() => {});
  assert.equal(await sold(), false, "an Editor's held sale does not survive a later withdrawal and an Author's publish");
  assert.equal(warnings.at(-1).data.code, 'COMMAND_CONFLICT');
  assert.deepEqual(waiting(), []);
  // Thirty requests for other moments are cleared in one call, so the publish stays inside the sandbox's call limit.
  for (let n = 0; n < 30; n += 1) await schedule(30, new Date(Date.parse(at) + (n + 1) * 60_000).toISOString());
  await schedule(40);
  let calls = 0;
  const counted = new Proxy(ctx.storage.scheduled_sales, { get: (store, name) => typeof store[name] === 'function' ? (...args) => { calls += 1; return store[name](...args); } : store[name] });
  await hook('content:beforePublish')({ collection: 'products', content: content(at), origin: { source: 'scheduler' } }, { ...ctx, storage: { ...ctx.storage, scheduled_sales: counted } });
  assert.equal(calls, 5);
  assert.deepEqual(waiting(), ['page-1:go']);
  await hook('content:afterPublish')({ collection: 'products', content: content(null) }, ctx);
  assert.equal(await sold(), true);
  assert.deepEqual(waiting(), []);
  // A page that sells nothing leaves no record behind to retry.
  await hook('content:beforeSchedule')({ collection: 'products', content: { id: 'page-9' }, actor: { id: 'u', role: 40 }, scheduledAt: at }, ctx);
  await hook('content:beforePublish')({ collection: 'products', content: { id: 'page-9', scheduledAt: at, data: {} }, origin: { source: 'scheduler' } }, ctx);
  await hook('content:afterPublish')({ collection: 'products', content: { id: 'page-9', data: {} } }, ctx);
  assert.deepEqual(waiting(), []);
  // A page outside Products is never looked at.
  await hook('content:beforeSchedule')({ collection: 'posts', content: content(null), actor: { id: 'u', role: 50 }, scheduledAt: at }, ctx);
  assert.deepEqual(waiting(), []);
});

test('a permanent delete whose product keeps changing gives up after 4 tries, and the next delete finishes it', async () => {
  const { catalog, pages } = await shop();
  const rows = Array.from({ length: 5 }, () => new Store());
  const storage = { catalog, pages, rows };
  await setProductPageOnSale(storage, { catalogItemId: 'mug', entryId: 'page-1', onSale: true });
  // The product changes after every read, so its own item never deletes as read.
  const compareAndDelete = catalog.compareAndDelete.bind(catalog);
  let tries = 0;
  catalog.compareAndDelete = async (id, revision) => id === 'mug' ? (tries++, { applied: false }) : compareAndDelete(id, revision);
  await assert.rejects(setProductPageOnSale(storage, { entryId: 'page-1', onSale: false, deleted: true }), (error) => error.code === 'STORAGE_UNAVAILABLE' && error.message === 'The product kept changing. Try again.');
  assert.equal(tries, 4, 'it stops instead of trying forever');
  assert.deepEqual([(await catalog.get('mug')).pageId, (await catalog.get('mug')).offSale], ['page-1', true], 'the deleted page still holds it, off the shop');
  assert.equal(await pageProduct(pages, 'page-1'), 'mug', 'the page keeps its link to finish the delete');
  catalog.compareAndDelete = compareAndDelete;
  await setProductPageOnSale(storage, { entryId: 'page-1', onSale: false, deleted: true });
  assert.equal(await catalog.get('mug'), null);
  assert.equal(pages.records.size, 0);
});
