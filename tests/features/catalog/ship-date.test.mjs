import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBlockResponse } from '@emdash-cms/blocks/server';
import { productPanel } from '../../../dist/admin/index.js';
import { pageProduct, setProductPageOnSale } from '../../../dist/features/catalog/kernel/index.js';
import { readPublicCatalogItem } from '../../../dist/features/catalog/index.js';

// A backorder's expected ship date, one per variant, for Google's availability_date (google-backorder-ship-date-20261124).
const commerceAdmin = (route, ctx) => productPanel({ ...route, ui: { surface: 'content-editor-panel', locale: 'en', direction: 'ltr', extensionId: 'product', entry: { collection: 'products', id: 'page-1', locale: null, version: 1 } } }, ctx);
const blocksOf = (blocks) => blocks.flatMap((block) => block.type === 'accordion' ? blocksOf(block.blocks) : [block]);
const forms = (out) => blocksOf(out.blocks).filter((block) => block.type === 'form');
const day = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

class Catalog {
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
function shop() {
  const catalog = new Catalog(), pages = new Catalog(), prices = new Catalog(), availability = new Catalog(), empty = new Catalog();
  const storage = { catalog_items: catalog, product_pages: pages, catalog_prices: prices, catalog_manual_availability: availability,
    catalog_backorder_policies: empty, store_inventory_configurations: empty, storefront_availability_settings: empty,
    storefront_out_of_stock_listing: empty, catalog_media: empty, storefront_placeholder_image: empty, managed_sku_claims: empty };
  return { catalog, pages, store: { catalog, pages, prices, availability }, ctx: { site: { url: 'https://shop.example.test' }, storage } };
}

async function hat(stockStatus = 'on-backorder') {
  const shopped = shop();
  await commerceAdmin({ input: { type: 'form_submit', action_id: 'sell:11111111-aaaa-bbbb-cccc-555555555555', values: { regular: '25', sale: '', sku: 'HAT', stockStatus, physical: true }, draft: { fields: { title: 'Hat' } } } }, shopped.ctx);
  const id = await pageProduct(shopped.store.pages, 'page-1');
  await setProductPageOnSale({ catalog: shopped.catalog, pages: shopped.pages }, { catalogItemId: id, entryId: 'page-1', onSale: true });
  return { ...shopped, id };
}
const pricing = (out) => forms(out).find((form) => form.submit.action_id.startsWith('save:'));
const save = async (ctx, values) => {
  const form = pricing(await commerceAdmin({ input: { type: 'panel_load' } }, ctx));
  return commerceAdmin({ input: { type: 'form_submit', action_id: form.submit.action_id, values: { regular: '25', sale: '', sku: 'HAT', ...values } } }, ctx);
};

test('the ship date box shows under Stock status only for a backorder, and saves with it', async () => {
  const { ctx, id } = await hat();
  const opened = await commerceAdmin({ input: { type: 'panel_load' } }, ctx);
  assert.equal(validateBlockResponse(opened).valid, true);
  const box = pricing(opened).fields.find((field) => field.action_id === 'shipBy');
  assert.deepEqual(pricing(opened).fields.map((field) => field.action_id).slice(-2), ['stockStatus', 'shipBy'], 'right under Stock status');
  assert.deepEqual([box.type, box.label, box.initial_value, box.condition], ['date_input', 'Expected ship date', undefined, { field: 'stockStatus', eq: 'on-backorder' }]);
  assert.equal((await readPublicCatalogItem(ctx, id)).availability.shipBy, undefined, 'no date yet');

  const date = day(20);
  const saved = await save(ctx, { stockStatus: 'on-backorder', shipBy: date });
  assert.equal(saved.toast.type, 'success');
  assert.equal(pricing(saved).fields.find((field) => field.action_id === 'shipBy').initial_value, date);
  assert.deepEqual((await readPublicCatalogItem(ctx, id)).availability, { status: 'available-on-backorder', sellable: true, listable: true, shipBy: date });

  const typo = await save(ctx, { stockStatus: 'on-backorder', shipBy: '12/12/2026' });
  assert.equal(typo.toast.type, 'error');
  assert.equal((await readPublicCatalogItem(ctx, id)).availability.shipBy, date, 'a refused date changes nothing');

  await save(ctx, { stockStatus: 'in-stock' });
  assert.equal((await readPublicCatalogItem(ctx, id)).availability.shipBy, undefined, 'back in stock, the shop shows no date');
  await save(ctx, { stockStatus: 'on-backorder', shipBy: '' });
  assert.equal((await readPublicCatalogItem(ctx, id)).availability.shipBy, undefined, 'an empty box clears it');
});

test('a passed date says so in the panel and asks for a new one', async () => {
  const { ctx, id } = await hat();
  const passed = day(-3);
  const saved = await save(ctx, { stockStatus: 'on-backorder', shipBy: passed });
  const box = pricing(saved).fields.find((field) => field.action_id === 'shipBy');
  assert.deepEqual([box.label, box.initial_value], ['Expected ship date (passed: pick a new one)', passed]);
  // The shop still has it; the storefront and feeds count a passed date as none (backorderShipDate).
  assert.equal((await readPublicCatalogItem(ctx, id)).availability.shipBy, passed);
  const today = await save(ctx, { stockStatus: 'on-backorder', shipBy: day(0) });
  assert.equal(pricing(today).fields.find((field) => field.action_id === 'shipBy').label, 'Expected ship date', 'today has not passed yet');
});

test('each variant keeps its own date', async () => {
  const { ctx, id } = await hat('in-stock');
  const opened = await commerceAdmin({ input: { type: 'panel_load' } }, ctx);
  const add = forms(opened).find((form) => form.submit.label === 'Add options');
  const added = await commerceAdmin({ input: { type: 'form_submit', action_id: add.submit.action_id, values: { optionLabel: 'Flavor', values: 'Mint, Cherry' } } }, ctx);
  const cherry = forms(added).filter((form) => form.submit.action_id.startsWith('variant:["price"'))[1];
  const cherryId = JSON.parse(cherry.submit.action_id.slice(8))[2];
  assert.ok(cherry.fields.some((field) => field.action_id === 'shipBy'), 'every variant card has the box');
  const date = day(40);
  const saved = await commerceAdmin({ input: { type: 'form_submit', action_id: cherry.submit.action_id, values: { regular: '26', sale: '', sku: 'HAT-CHERRY', stockStatus: 'on-backorder', shipBy: date } } }, ctx);
  assert.equal(saved.toast.type, 'success', JSON.stringify(saved.toast));
  const members = (await readPublicCatalogItem(ctx, id)).variants.members;
  assert.deepEqual(members.map((member) => [member.catalogItemId === cherryId ? 'cherry' : 'mint', member.availability.status, member.availability.shipBy]),
    [['mint', 'in-stock', undefined], ['cherry', 'available-on-backorder', date]]);
  const reopened = forms(saved).find((form) => form.submit.action_id.startsWith('variant:["price"') && JSON.parse(form.submit.action_id.slice(8))[2] === cherryId);
  assert.equal(reopened.fields.find((field) => field.action_id === 'shipBy').initial_value, date);
});
