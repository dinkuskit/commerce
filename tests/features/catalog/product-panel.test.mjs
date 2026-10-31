import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBlockResponse } from '@emdash-cms/blocks/server';
import { commerceAdmin, productPanel } from '../../../dist/admin/index.js';
import { createCatalogItem, linkProductPage, pageProduct, setProductPageOnSale } from '../../../dist/features/catalog/kernel/index.js';
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
// The page's Add price and stock (or a catalog API create) notes its product; tests note a seeded one directly.
const pick = (ctx, product, id = 'page-1') => linkProductPage({ catalog: ctx.storage.catalog_items, pages: ctx.storage.product_pages }, id, product);

test('the panel refuses to run outside a product page editor', async () => {
  const { ctx } = await shop();
  const out = await productPanel({ input: { type: 'panel_load' } }, ctx);
  assert.equal(out.toast?.type, 'error');
});

test('an unlinked page offers only Add price and stock: every product is made for its page', async () => {
  const { ctx } = await shop();
  const out = await panel({ type: 'panel_load' }, ctx);
  assert.equal(validateBlockResponse(out).valid, true);
  assert.match(texts(out.blocks), /Add price and stock/);
  assert.doesNotMatch(texts(out.blocks), /"mug"|Sell it here|Or its SKU|without a page/, 'no picking a product made elsewhere (catalog-product-needs-page-20261031)');
  // An older panel's attach button sells nothing and links nothing.
  const old = await panel({ type: 'form_submit', action_id: 'link', values: { product: 'mug' }, draft: { fields: {} } }, ctx);
  assert.equal(await pageProduct(ctx.storage.product_pages, 'page-1'), undefined);
  assert.equal(validateBlockResponse(old).valid, true);
  assert.equal(out.patch, undefined, 'loading never touches the page');
});

test('Add price and stock makes an unmanaged Draft and Commerce keeps the page\'s link', async () => {
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

test('a refused Add price and stock keeps the typed SKU', async () => {
  const { ctx } = await shop();
  const out = await panel({ type: 'form_submit', action_id: 'sell', values: { sku: 'MUG' }, draft: { fields: { title: 'Second mug' } } }, ctx);
  assert.equal(out.toast?.type, 'error');
  assert.equal(validateBlockResponse(out).valid, true);
  assert.match(texts(out.blocks), /"initial_value":"MUG"/);
});

test('a retried Add price and stock resumes the product its first try made', async () => {
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
  assert.match(texts(saved.blocks), /SKU MUG/);
  assert.equal(saved.patch, undefined);
  const loaded = await panel({ type: 'panel_load', draft: { fields: { commerce_item_id: 'cap' } } }, ctx);
  assert.match(texts(loaded.blocks), /SKU MUG/);
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

test('publishing names the product from the page title, and only a publish does', async () => {
  const { ctx, catalog, pages } = await shop();
  const storage = { catalog, pages };
  await panel({ type: 'form_submit', action_id: 'sell', values: {}, draft: { fields: { title: 'Tee' } } }, ctx);
  const id = await pageProduct(pages, 'page-1');
  const shown = texts((await panel({ type: 'panel_load' }, ctx)).blocks);
  assert.match(shown, /Name comes from the page title/);
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
  // Once its page is gone, another page may sell it.
  assert.deepEqual(await setProductPageOnSale(storage, { catalogItemId: 'mug', entryId: 'page-2', onSale: true }), { changed: true });
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
