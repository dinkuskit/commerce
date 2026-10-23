import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBlockResponse } from '@emdash-cms/blocks/server';
import { commerceAdmin, productPanel } from '../../../dist/admin/index.js';
import { createCatalogItem, pageProduct, setCatalogProductArchived, setProductPageOnSale } from '../../../dist/features/catalog/kernel/index.js';
import { readPublicCatalog, readPublicCatalogItem } from '../../../dist/features/catalog/index.js';

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

test('the panel refuses to run outside a product page editor', async () => {
  const { ctx } = await shop();
  const out = await productPanel({ input: { type: 'panel_load' } }, ctx);
  assert.equal(out.toast?.type, 'error');
});

test('an unlinked page offers Make this sellable and the products without a page', async () => {
  const { ctx } = await shop();
  const out = await panel({ type: 'panel_load' }, ctx);
  assert.equal(validateBlockResponse(out).valid, true);
  assert.match(texts(out.blocks), /Make this sellable/);
  assert.match(texts(out.blocks), /"mug"/);
  assert.equal(out.patch, undefined, 'loading never touches the page');
});

test('Make this sellable makes an unmanaged Draft and patches the unsaved page', async () => {
  const { ctx, catalog, pages } = await shop();
  const out = await panel({ type: 'form_submit', action_id: 'sell', values: { sku: '', manageStock: true }, draft: { fields: { title: 'Black hoodie' } } }, ctx);
  assert.notEqual(out.toast?.type, 'error', JSON.stringify(out));
  assert.equal(validateBlockResponse(out).valid, true);
  const made = [...catalog.records.values()].find((row) => row.name === 'Black hoodie' && row.itemId !== 'mug');
  assert.ok(made);
  assert.equal(made.offSale, true, 'a new product is a Draft until its page is published');
  assert.equal(made.fulfillment, 'physical');
  assert.equal(made.creationIntent?.manageStock ?? false, false);
  assert.match(made.sku, /^BLACK-HOODIE/);
  assert.deepEqual(out.patch, { type: 'editor-draft-patch', operations: [{ op: 'set', field: 'commerce_item_id', value: made.itemId }] });
  assert.equal(await pageProduct(pages, 'page-1'), made.itemId);
  assert.equal(await readPublicCatalogItem(ctx, made.itemId), null, 'a Draft is not on the shop');
  const again = await panel({ type: 'panel_load' }, ctx);
  assert.match(texts(again.blocks), /Draft: publish to sell it/);
});

test('picking a product without a page links it, and a page already holding that id gets no patch', async () => {
  const { ctx, pages } = await shop();
  const linked = await panel({ type: 'form_submit', action_id: 'link', values: { product: 'mug' }, draft: { fields: { title: 'Mug' } } }, ctx);
  assert.notEqual(linked.toast?.type, 'error', JSON.stringify(linked));
  assert.equal(linked.patch.operations[0].value, 'mug');
  assert.equal(await pageProduct(pages, 'page-1'), 'mug');
  const same = await panel({ type: 'form_submit', action_id: 'sell', values: {}, draft: { fields: { title: 'Mug', commerce_item_id: 'mug' } } }, ctx);
  assert.equal(same.patch, undefined, 'a page already holding the id gets no patch');
  // One product has one page, decided only by the publish check. A panel link is a note, so another page may pick it too...
  const moved = await panel({ type: 'form_submit', action_id: 'sell', values: {}, draft: { fields: { title: 'Mug', commerce_item_id: 'mug' } } }, ctx, 'page-2');
  assert.notEqual(moved.toast?.type, 'error', JSON.stringify(moved.toast));
  assert.equal(await pageProduct(pages, 'page-2'), 'mug');
  assert.equal((await ctx.storage.catalog_items.get('mug')).pageId, undefined, 'no panel step decides who sells it');
  // ...but once page-2's publish check records it, page-3 naming the product is refused and notes nothing.
  await setProductPageOnSale({ catalog: ctx.storage.catalog_items, pages }, { catalogItemId: 'mug', entryId: 'page-2', onSale: true });
  assert.equal((await ctx.storage.catalog_items.get('mug')).pageId, 'page-2');
  assert.deepEqual(await pages.get('p:page-2'), { entryId: 'page-2', catalogItemId: 'mug' });
  const typed = await panel({ type: 'form_submit', action_id: 'sell', values: {}, draft: { fields: { title: 'Mug', commerce_item_id: 'mug' } } }, ctx, 'page-3');
  assert.equal(typed.toast?.type, 'error');
  assert.match(typed.toast.message, /Another page sells this product/);
  assert.equal(await pageProduct(pages, 'page-3'), undefined);
  // page-1's own publish check is refused too, and page-2 keeps the product.
  await assert.rejects(setProductPageOnSale({ catalog: ctx.storage.catalog_items, pages }, { catalogItemId: 'mug', entryId: 'page-1', onSale: false }), (error) => error.code === 'PRODUCT_PAGE_CONFLICT');
  assert.equal((await ctx.storage.catalog_items.get('mug')).pageId, 'page-2');
  const unlinkedCount = (await panel({ type: 'panel_load' }, ctx, 'page-3'));
  assert.doesNotMatch(texts(unlinkedCount.blocks), /"mug"/, 'a linked product leaves the without-a-page list');
});

test('a typed SKU sells a product the list does not show', async () => {
  const { ctx, catalog, pages } = await shop();
  for (let i = 0; i < 55; i++) await createCatalogItem(catalog, { commandId: 'create-' + i, name: 'Tee ' + i, sku: 'TEE-' + i, fulfillment: 'physical' }, { createId: () => 'tee-' + i, collection: 'catalog_items' });
  const list = await panel({ type: 'panel_load' }, ctx);
  assert.equal(list.blocks.find((block) => block.block_id?.startsWith('link-')).fields[0].options.length, 50);
  const out = await panel({ type: 'form_submit', action_id: 'link', values: { sku: ' tee-3 ' }, draft: { fields: {} } }, ctx);
  assert.notEqual(out.toast?.type, 'error', JSON.stringify(out.toast));
  assert.equal(await pageProduct(pages, 'page-1'), 'tee-3');
  const missing = await panel({ type: 'form_submit', action_id: 'link', values: { sku: 'NOPE' }, draft: { fields: {} } }, ctx, 'page-2');
  assert.equal(missing.toast?.type, 'error');
  assert.equal(await pageProduct(pages, 'page-2'), undefined);
});

test('a refused Make this sellable keeps the typed SKU', async () => {
  const { ctx } = await shop();
  const out = await panel({ type: 'form_submit', action_id: 'sell', values: { sku: 'MUG' }, draft: { fields: { title: 'Second mug' } } }, ctx);
  assert.equal(out.toast?.type, 'error');
  assert.equal(validateBlockResponse(out).valid, true);
  assert.match(texts(out.blocks), /"initial_value":"MUG"/);
});

test('a retried Make this sellable resumes the product its first try made', async () => {
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
  assert.equal(await pageProduct(pages, 'page-1'), caps[0].itemId);
});

test('the page editor\'s commerce_item_id settles the link on the next step', async () => {
  const { ctx, catalog, pages } = await shop();
  await createCatalogItem(catalog, { commandId: 'create-cap', name: 'Cap', sku: 'CAP', fulfillment: 'physical' }, { createId: () => 'cap', collection: 'catalog_items' });
  // A page saved before the link list existed: Make this sellable opens its product and makes nothing new.
  const old = await panel({ type: 'form_submit', action_id: 'sell', values: {}, draft: { fields: { title: 'Mug', commerce_item_id: 'mug' } } }, ctx);
  assert.equal(old.patch, undefined);
  assert.match(texts(old.blocks), /SKU MUG/);
  assert.equal(catalog.records.size, 2);
  // The page now names another product: the next step opens that one, never the old link.
  const moved = await panel({ type: 'form_submit', action_id: 'save:mug', values: { regular: '9.00', sale: '' }, draft: { fields: { commerce_item_id: 'cap' } } }, ctx);
  assert.equal(await pageProduct(pages, 'page-1'), 'cap');
  assert.match(texts(moved.blocks), /SKU CAP/);
  assert.equal((await ctx.storage.catalog_prices.get('mug')), null, 'the old product is not changed');
  // A declined or unsaved link: the next step offers the link again.
  const declined = await panel({ type: 'block_action', action_id: 'open', value: 'cap', draft: { fields: { title: 'Cap' } } }, ctx);
  assert.deepEqual(declined.patch, { type: 'editor-draft-patch', operations: [{ op: 'set', field: 'commerce_item_id', value: 'cap' }] });
});

test('archived products without a page stay listed so they can be restored', async () => {
  const { ctx, catalog } = await shop();
  await setCatalogProductArchived(catalog, { catalogItemId: 'mug', archived: true });
  const out = await panel({ type: 'panel_load' }, ctx);
  assert.match(texts(out.blocks), /Mug \\u2014 MUG \(archived\)|Mug — MUG \(archived\)/);
});

test('linking a product that is gone links nothing', async () => {
  const { ctx, pages } = await shop();
  const out = await panel({ type: 'form_submit', action_id: 'link', values: { product: 'ghost' }, draft: { fields: {} } }, ctx);
  assert.equal(out.toast?.type, 'error');
  assert.equal(validateBlockResponse(out).valid, true);
  assert.match(texts(out.blocks), /Make this sellable/, 'the owner can retry from the same panel');
  assert.equal(await pageProduct(pages, 'page-1'), undefined);
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

test('the page that sells a product can always take it off sale, whatever other pages name it', async () => {
  const { catalog, pages } = await shop();
  const storage = { catalog, pages };
  await setProductPageOnSale(storage, { catalogItemId: 'mug', entryId: 'page-1', onSale: true });
  await assert.rejects(setProductPageOnSale(storage, { catalogItemId: 'mug', entryId: 'page-2', onSale: true }), (error) => error.code === 'PRODUCT_PAGE_CONFLICT');
  assert.deepEqual(await setProductPageOnSale(storage, { catalogItemId: 'mug', entryId: 'page-1', onSale: false }), { changed: true });
  await setProductPageOnSale(storage, { catalogItemId: 'mug', entryId: 'page-1', onSale: false, deleted: true });
  assert.equal(await pageProduct(pages, 'page-1'), undefined);
  // Once its page is gone, another page may sell it.
  assert.deepEqual(await setProductPageOnSale(storage, { catalogItemId: 'mug', entryId: 'page-2', onSale: true }), { changed: true });
});

test('upgrade: a published page with no link can still withdraw its product after another page linked it in the panel', async () => {
  const { ctx, catalog, pages } = await shop();
  // page-old was published before links existed; page-new picks the same product in its panel but is never saved.
  await panel({ type: 'form_submit', action_id: 'link', values: { product: 'mug' }, draft: { fields: {} } }, ctx, 'page-new');
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
  await panel({ type: 'form_submit', action_id: 'link', values: { product: 'cap' }, draft: { fields: {} } }, ctx, 'page-1');
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
  assert.deepEqual(await pages.get('p:page-1'), { entryId: 'page-1', catalogItemId: 'mug' });
  assert.equal((await catalog.get('mug')).pageId, 'page-1');
  assert.deepEqual([(await catalog.get('cap')).pageId, (await catalog.get('cap')).offSale], [undefined, true]);
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

test('Commerce settings lists products without a page with Make a page', async () => {
  const { ctx } = await shop();
  ctx.storage.storefront_out_of_stock_listing = new Store();
  ctx.settings = { getVersioned: async () => null };
  const out = await commerceAdmin({ input: { type: 'page_load', page: '/settings' }, user: { role: 50 }, ui: { surface: 'admin-page', locale: 'en', direction: 'ltr' } }, ctx);
  assert.equal(validateBlockResponse(out).valid, true);
  const body = texts(out.blocks);
  assert.match(body, /Products without a page/);
  assert.match(body, /Make a page/);
  assert.match(body, /"collection":"products","id":"new"/);
  await setCatalogProductArchived(ctx.storage.catalog_items, { catalogItemId: 'mug', archived: true });
  const archived = await commerceAdmin({ input: { type: 'page_load', page: '/settings' }, user: { role: 50 }, ui: { surface: 'admin-page', locale: 'en', direction: 'ltr' } }, ctx);
  assert.match(texts(archived.blocks), /MUG \(archived\)/);
});
