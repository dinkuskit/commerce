import assert from 'node:assert/strict';
import test from 'node:test';
import { productPanel } from '../../../dist/admin/index.js';
import { createProductForPage, loadCatalogProduct, pageProduct } from '../../../dist/features/catalog/kernel/index.js';

// The panel's first Save makes the product (catalog-first-save-creates-20261031) through the one kernel function the
// catalog API's create and the CLI also call, and the panel is laid out as cards (catalog-panel-cards-20261031).
const commerceAdmin = (route, ctx) => productPanel({ ...route, ui: { surface: 'content-editor-panel', locale: 'en', direction: 'ltr', extensionId: 'product', entry: { collection: 'products', id: 'page-1', locale: null, version: 1 } } }, ctx);
const blocksOf = (blocks) => blocks.flatMap((block) => block.type === 'accordion' ? blocksOf(block.blocks) : [block]);
const forms = (out) => blocksOf(out.blocks).filter((block) => block.type === 'form');
const cards = (out) => out.blocks.filter((block) => block.type === 'accordion');

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
const unique = { collection: 'catalog_items' };
const product = (store, id) => loadCatalogProduct({ catalog: store.catalog, prices: store.prices, availability: store.availability }, id);

test('createProductForPage makes the Draft for its page with its price, stock status, fulfillment and weight in one call', async () => {
  const { store, pages } = shop();
  const made = await createProductForPage(store, { entryId: 'page-1', commandId: 'c1', name: 'Tote', sku: 'TOTE', regular: '24', sale: '', stockStatus: 'out-of-stock', weightOz: '8' }, unique);
  assert.equal(made.created, true);
  assert.equal(made.price.saved, true);
  assert.equal(await pageProduct(pages, 'page-1'), made.catalogItemId, 'claimed for its page');
  const shown = await product(store, made.catalogItemId);
  assert.deepEqual([shown.regular, shown.sale, shown.stockStatus, shown.fulfillment, shown.weightOz, shown.offSale], ['24.00', null, 'out-of-stock', 'physical', 8, true]);
  // The same command again finds the product and saves the price again, never a second product.
  const again = await createProductForPage(store, { entryId: 'page-1', commandId: 'c1', name: 'Tote', sku: 'TOTE', regular: '26', sale: '' }, unique);
  assert.deepEqual([again.created, again.catalogItemId], [false, made.catalogItemId]);
  assert.equal((await product(store, made.catalogItemId)).regular, '26.00');
  assert.equal(store.catalog.records.size, 1);
  // A digital product has no weight; without a price nothing is priced.
  const digital = await createProductForPage(store, { entryId: 'page-2', commandId: 'c2', name: 'Guide', sku: 'GUIDE', fulfillment: 'digital' }, unique);
  const guide = await product(store, digital.catalogItemId);
  assert.deepEqual([guide.fulfillment, guide.regular, digital.price], ['digital', null, undefined]);
});

test('createProductForPage refuses a bad weight before making anything, and keeps a Draft whose price was refused', async () => {
  const { store } = shop();
  await assert.rejects(createProductForPage(store, { entryId: 'page-1', commandId: 'c1', name: 'Tote', sku: 'TOTE', weightOz: 'heavy' }, unique), (error) => error.code === 'INVALID_INPUT');
  assert.equal(store.catalog.records.size, 0, 'nothing was made');
  // A price Commerce refuses, a bad amount or Sale above Regular, comes back in the answer: the Draft exists, linked, and the owner fixes it there.
  const typo = await createProductForPage(store, { entryId: 'page-1', commandId: 'c1', name: 'Tote', sku: 'TOTE', regular: 'abc', sale: '' }, unique);
  assert.equal(typo.price.saved, false);
  assert.match(typo.price.message, /dollar amount/);
  const made = await createProductForPage(store, { entryId: 'page-1', commandId: 'c1', name: 'Tote', sku: 'TOTE', regular: '10', sale: '12' }, unique);
  assert.deepEqual([made.created, made.catalogItemId, made.price.saved], [false, typo.catalogItemId, false]);
  assert.match(made.price.message, /Sale must be lower/);
  assert.equal(await pageProduct(store.pages, 'page-1'), made.catalogItemId);
  assert.equal((await product(store, made.catalogItemId)).regular, null);
  await assert.rejects(createProductForPage(store, { entryId: 'page-1', commandId: 'c9', name: 'Other', sku: 'OTHER' }, unique), (error) => error.code === 'PRODUCT_PAGE_CONFLICT');
  await assert.rejects(createProductForPage(store, { commandId: 'c9', name: 'Other', sku: 'OTHER' }, unique), (error) => error.code === 'INVALID_INPUT');
});

test("the panel's first Save makes a priced product; a bad weight keeps the form, a bad price keeps the typing on the product", async () => {
  const { ctx, pages, store } = shop();
  const heavy = await commerceAdmin({ input: { type: 'form_submit', action_id: 'sell:11111111-aaaa-bbbb-cccc-222222222222', values: { regular: '12', sale: '', sku: 'HAT', stockStatus: 'in-stock', physical: true, weightOz: 'heavy' }, draft: { fields: { title: 'Red hat' } } } }, ctx);
  assert.equal(heavy.toast.type, 'error');
  assert.equal(store.catalog.records.size, 0, 'a bad weight makes nothing');
  const form = forms(heavy)[0];
  assert.equal(form.submit.action_id, 'sell:11111111-aaaa-bbbb-cccc-222222222222', 'the retry keeps its create command');
  assert.deepEqual(form.fields.filter((f) => ['regular', 'sku', 'weightOz'].includes(f.action_id)).map((f) => f.initial_value), ['12', 'HAT', 'heavy']);
  const typo = await commerceAdmin({ input: { type: 'form_submit', action_id: 'sell:11111111-aaaa-bbbb-cccc-222222222222', values: { regular: 'twelve', sale: '', sku: 'HAT', stockStatus: 'in-stock', physical: false }, draft: { fields: { title: 'Red hat' } } } }, ctx);
  assert.equal(typo.toast.type, 'error');
  assert.match(typo.toast.message, /dollar amount/);
  const id = await pageProduct(pages, 'page-1');
  assert.ok(id, 'the Draft is made and linked; the price is refused on it');
  assert.equal(forms(typo).find((f) => f.submit.action_id.startsWith('save:')).fields.find((f) => f.action_id === 'regular').initial_value, 'twelve', 'the typing stays in the Pricing & stock form');
  const saved = await commerceAdmin({ input: { type: 'form_submit', action_id: 'sell:11111111-aaaa-bbbb-cccc-222222222222', values: { regular: '12', sale: '9.50', sku: 'HAT', stockStatus: 'on-backorder', physical: false }, draft: { fields: { title: 'Red hat' } } } }, ctx);
  assert.deepEqual(saved.toast, { type: 'success', message: 'Draft made. Publish the page to sell it.' });
  assert.equal(await pageProduct(pages, 'page-1'), id, 'the same command again finds the Draft and saves the price');
  const hat = await product(store, id);
  assert.deepEqual([hat.name, hat.sku, hat.regular, hat.sale, hat.stockStatus, hat.fulfillment, hat.offSale], ['Red hat', 'HAT', '12.00', '9.50', 'on-backorder', 'digital', true]);
  // The linked panel: status grid, Pricing & stock open, then cards; a digital product has no Shipping card.
  assert.equal(saved.blocks[0].type, 'fields');
  assert.deepEqual(saved.blocks[0].fields.map((f) => f.label), ['Status', 'SKU', 'Name (page title)']);
  assert.deepEqual(cards(saved).map((card) => [card.label, card.default_open]), [['Variants · none', false], ['Identifiers', false]]);
  assert.ok(saved.blocks.some((block) => block.type === 'header' && block.text === 'Pricing & stock'));
});

test('Add options makes a variant for each comma-separated value, and each variant card edits its own SKU', async () => {
  const { ctx, store } = shop();
  await commerceAdmin({ input: { type: 'form_submit', action_id: 'sell:11111111-aaaa-bbbb-cccc-333333333333', values: { regular: '20', sale: '', sku: 'TEE', stockStatus: 'in-stock', physical: true, weightOz: '6' }, draft: { fields: { title: 'Tee' } } } }, ctx);
  const id = await pageProduct(store.pages, 'page-1');
  const opened = await commerceAdmin({ input: { type: 'panel_load' } }, ctx);
  const add = forms(opened).find((form) => form.submit.label === 'Add options');
  const added = await commerceAdmin({ input: { type: 'form_submit', action_id: add.submit.action_id, values: { optionLabel: 'Size', values: ' Small, medium ,Large, small ' } } }, ctx);
  assert.notEqual(added.toast?.type, 'error', JSON.stringify(added.toast));
  const tee = await product(store, id);
  assert.deepEqual(tee.variantProduct.options[0].values.map((v) => [v.valueId, v.label]), [['small', 'Small'], ['medium', 'medium'], ['large', 'Large']], 'trimmed, distinct, in order');
  assert.deepEqual(tee.variantProduct.members.map((m) => [m.sku, m.fulfillment, m.regular]), [['TEE', 'physical', '20.00'], ['TEE-MEDIUM', 'physical', null], ['TEE-LARGE', 'physical', null]], 'the product is the first variant; the others take its SKU plus the value and its fulfillment');
  const variants = cards(added).find((card) => card.label.startsWith('Variants'));
  assert.deepEqual([variants.label, variants.default_open], ['Variants · 3', true]);
  assert.deepEqual(variants.blocks.filter((b) => b.type === 'accordion').map((c) => c.label), ['Small · $20.00', 'medium', 'Large', 'Edit options', 'Add another option', 'Add a variant']);
  // One value is refused before anything changes.
  const one = await commerceAdmin({ input: { type: 'form_submit', action_id: add.submit.action_id, values: { optionLabel: 'Size', values: 'Only' } } }, ctx);
  assert.equal(one.toast.type, 'error');
  // Each variant's card saves its price, stock status and SKU; a SKU another product has is refused first.
  const medium = tee.variantProduct.members[1];
  const priceForm = forms(added).find((form) => form.submit.action_id.startsWith('variant:["price"') && JSON.parse(form.submit.action_id.slice(8))[2] === medium.catalogItemId);
  assert.deepEqual(priceForm.fields.map((f) => f.action_id), ['regular', 'sale', 'sku', 'stockStatus']);
  const priced = await commerceAdmin({ input: { type: 'form_submit', action_id: priceForm.submit.action_id, values: { regular: '22', sale: '', sku: 'tee-m', stockStatus: 'in-stock' } } }, ctx);
  assert.deepEqual(priced.toast, { type: 'success', message: 'Changes saved' });
  const after = await product(store, id);
  assert.deepEqual([after.variantProduct.members[1].sku, after.variantProduct.members[1].regular], ['TEE-M', '22.00']);
  const fresh = forms(priced).find((form) => form.submit.action_id.startsWith('variant:["price"') && JSON.parse(form.submit.action_id.slice(8))[2] === medium.catalogItemId);
  const taken = await commerceAdmin({ input: { type: 'form_submit', action_id: fresh.submit.action_id, values: { regular: '23', sale: '', sku: 'TEE-LARGE', stockStatus: 'in-stock' } } }, ctx);
  assert.equal(taken.toast.type, 'error');
  assert.match(taken.toast.message, /already assigned/);
  assert.deepEqual([(await product(store, id)).variantProduct.members[1].regular, (await product(store, id)).variantProduct.members[1].sku], ['22.00', 'TEE-M'], 'the SKU is refused before anything is saved');
  const refilled = forms(taken).find((form) => form.submit.action_id === fresh.submit.action_id);
  assert.equal(refilled.fields.find((f) => f.action_id === 'sku').initial_value, 'TEE-LARGE', 'the refused form keeps what was typed');
  // Correcting the SKU on that refilled form saves both: its revision still holds, since nothing was saved.
  const corrected = await commerceAdmin({ input: { type: 'form_submit', action_id: refilled.submit.action_id, values: { regular: '23', sale: '', sku: 'TEE-M2', stockStatus: 'in-stock' } } }, ctx);
  assert.deepEqual(corrected.toast, { type: 'success', message: 'Changes saved' });
  assert.deepEqual([(await product(store, id)).variantProduct.members[1].regular, (await product(store, id)).variantProduct.members[1].sku], ['23.00', 'TEE-M2']);
  // The Pricing & stock form of a simple product changes its SKU the same way.
  const { ctx: other, store: otherStore } = shop();
  await commerceAdmin({ input: { type: 'form_submit', action_id: 'sell:11111111-aaaa-bbbb-cccc-444444444444', values: { regular: '5', sale: '', sku: 'CAP', stockStatus: 'in-stock', physical: true }, draft: { fields: { title: 'Cap' } } } }, other);
  const capId = await pageProduct(otherStore.pages, 'page-1');
  const capForm = forms(await commerceAdmin({ input: { type: 'panel_load' } }, other)).find((form) => form.submit.action_id.startsWith('save:'));
  const resku = await commerceAdmin({ input: { type: 'form_submit', action_id: capForm.submit.action_id, values: { regular: '5', sale: '', sku: 'cap-2', stockStatus: 'in-stock' } } }, other);
  assert.equal(resku.toast.type, 'success', JSON.stringify(resku.toast));
  assert.equal((await product(otherStore, capId)).sku, 'CAP-2');
  assert.equal(resku.blocks[0].fields.find((f) => f.label === 'SKU').value, 'CAP-2');
});

test('a stale form is refused whole, SKU included, for a product and for a variant; a reloaded form saves', async () => {
  const { ctx, store } = shop();
  await commerceAdmin({ input: { type: 'form_submit', action_id: 'sell:11111111-aaaa-bbbb-cccc-777777777777', values: { regular: '5', sale: '', sku: 'CAP', stockStatus: 'in-stock', physical: true }, draft: { fields: { title: 'Cap' } } } }, ctx);
  const id = await pageProduct(store.pages, 'page-1');
  const load = async () => commerceAdmin({ input: { type: 'panel_load' } }, ctx);
  const saveForm = (out) => forms(out).find((f) => f.submit.action_id.startsWith('save:'));
  const stale = saveForm(await load());
  // Another editor saves a newer price and stock status from their own form.
  const theirs = await commerceAdmin({ input: { type: 'form_submit', action_id: saveForm(await load()).submit.action_id, values: { regular: '6', sale: '', sku: 'CAP', stockStatus: 'out-of-stock' } } }, ctx);
  assert.equal(theirs.toast.type, 'success', JSON.stringify(theirs.toast));
  const refused = await commerceAdmin({ input: { type: 'form_submit', action_id: stale.submit.action_id, values: { regular: '5', sale: '', sku: 'CAP-OLD', stockStatus: 'in-stock' } } }, ctx);
  assert.equal(refused.toast.type, 'error');
  assert.match(refused.toast.message, /Product changed; reload/);
  const cap = await product(store, id);
  assert.deepEqual([cap.sku, cap.regular, cap.stockStatus], ['CAP', '6.00', 'out-of-stock'], 'nothing of the stale form was written, the SKU included');
  const refilled = saveForm(refused);
  assert.equal(refilled.submit.action_id, stale.submit.action_id, 'the refilled form still carries the revision it read, so it stays refused');
  assert.equal(refilled.fields.find((f) => f.action_id === 'sku').initial_value, 'CAP-OLD', 'with the typing kept');
  // The reloaded product gives a form that saves.
  const fresh = saveForm(await load());
  assert.notEqual(fresh.submit.action_id, stale.submit.action_id);
  const saved = await commerceAdmin({ input: { type: 'form_submit', action_id: fresh.submit.action_id, values: { regular: '7', sale: '', sku: 'CAP-NEW', stockStatus: 'in-stock' } } }, ctx);
  assert.equal(saved.toast.type, 'success', JSON.stringify(saved.toast));
  assert.deepEqual([(await product(store, id)).sku, (await product(store, id)).regular], ['CAP-NEW', '7.00']);
  // A variant's card is fenced the same way, through the product's revision.
  const add = forms(await load()).find((f) => f.submit.label === 'Add options');
  await commerceAdmin({ input: { type: 'form_submit', action_id: add.submit.action_id, values: { optionLabel: 'Size', values: 'S, L' } } }, ctx);
  const large = (await product(store, id)).variantProduct.members[1];
  const variantForm = (out) => forms(out).find((f) => f.submit.action_id.startsWith('variant:["price"') && JSON.parse(f.submit.action_id.slice(8))[2] === large.catalogItemId);
  const staleVariant = variantForm(await load());
  const theirVariant = await commerceAdmin({ input: { type: 'form_submit', action_id: variantForm(await load()).submit.action_id, values: { regular: '9', sale: '', sku: large.sku, stockStatus: 'in-stock' } } }, ctx);
  assert.equal(theirVariant.toast.type, 'success', JSON.stringify(theirVariant.toast));
  const refusedVariant = await commerceAdmin({ input: { type: 'form_submit', action_id: staleVariant.submit.action_id, values: { regular: '8', sale: '', sku: 'CAP-NEW-XL', stockStatus: 'out-of-stock' } } }, ctx);
  assert.equal(refusedVariant.toast.type, 'error');
  assert.match(refusedVariant.toast.message, /Product changed; reload/);
  const after = (await product(store, id)).variantProduct.members[1];
  assert.deepEqual([after.sku, after.regular, after.stockStatus], [large.sku, '9.00', 'in-stock']);
  assert.equal(variantForm(refusedVariant).submit.action_id, staleVariant.submit.action_id);
});

test("a variant whose SKU was changed and price refused in one Save comes back on a form that saves the corrected price", async () => {
  const { ctx, store } = shop();
  await commerceAdmin({ input: { type: 'form_submit', action_id: 'sell:11111111-aaaa-bbbb-cccc-888888888888', values: { regular: '20', sale: '', sku: 'TEE', stockStatus: 'in-stock', physical: true }, draft: { fields: { title: 'Tee' } } } }, ctx);
  const id = await pageProduct(store.pages, 'page-1');
  const add = forms(await commerceAdmin({ input: { type: 'panel_load' } }, ctx)).find((f) => f.submit.label === 'Add options');
  await commerceAdmin({ input: { type: 'form_submit', action_id: add.submit.action_id, values: { optionLabel: 'Size', values: 'S, L' } } }, ctx);
  // The first variant is the product itself, so its SKU change moves the product's revision.
  const rootForm = (out) => forms(out).find((f) => f.submit.action_id.startsWith('variant:["price"') && JSON.parse(f.submit.action_id.slice(8))[2] === id);
  const form = rootForm(await commerceAdmin({ input: { type: 'panel_load' } }, ctx));
  const refused = await commerceAdmin({ input: { type: 'form_submit', action_id: form.submit.action_id, values: { regular: 'abc', sale: '', sku: 'TEE-S', stockStatus: 'in-stock' } } }, ctx);
  assert.equal(refused.toast.type, 'error');
  assert.match(refused.toast.message, /dollar amount/, "Commerce's reason, not a generic one");
  assert.equal((await product(store, id)).sku, 'TEE-S', 'the SKU was changed before the price was refused');
  const refilled = rootForm(refused);
  assert.notEqual(refilled.submit.action_id, form.submit.action_id, 'the refilled form reads the product as it is after the SKU change');
  assert.deepEqual(refilled.fields.filter((f) => ['regular', 'sku'].includes(f.action_id)).map((f) => f.initial_value), ['abc', 'TEE-S']);
  const fixed = await commerceAdmin({ input: { type: 'form_submit', action_id: refilled.submit.action_id, values: { regular: '21', sale: '', sku: 'TEE-S', stockStatus: 'in-stock' } } }, ctx);
  assert.deepEqual(fixed.toast, { type: 'success', message: 'Changes saved' });
  assert.equal((await product(store, id)).variantProduct.members[0].regular, '21.00');
  // The old form, loaded before the SKU change, stays refused.
  const old = await commerceAdmin({ input: { type: 'form_submit', action_id: form.submit.action_id, values: { regular: '22', sale: '', sku: 'TEE-S', stockStatus: 'in-stock' } } }, ctx);
  assert.match(old.toast.message, /Product changed; reload/);
  assert.equal((await product(store, id)).variantProduct.members[0].regular, '21.00');
});

test('derived variant SKUs stay valid and distinct for look-alike values, long and segmented product SKUs', async () => {
  const { ctx, store } = shop();
  const long = 'L'.repeat(64);
  await commerceAdmin({ input: { type: 'form_submit', action_id: 'sell:11111111-aaaa-bbbb-cccc-555555555555', values: { regular: '9', sale: '', sku: long, stockStatus: 'in-stock', physical: true }, draft: { fields: { title: 'Long' } } } }, ctx);
  const id = await pageProduct(store.pages, 'page-1');
  const add = forms(await commerceAdmin({ input: { type: 'panel_load' } }, ctx)).find((form) => form.submit.label === 'Add options');
  const added = await commerceAdmin({ input: { type: 'form_submit', action_id: add.submit.action_id, values: { optionLabel: 'Fit', values: 'A B, A-B, Plain' } } }, ctx);
  assert.notEqual(added.toast?.type, 'error', JSON.stringify(added.toast));
  const skus = (await product(store, id)).variantProduct.members.map((m) => m.sku);
  assert.equal(skus[0], long);
  assert.deepEqual(skus.slice(1), [long.slice(0, 63 - 'a-b-2'.length) + '-A-B-2', long.slice(0, 63 - 'plain'.length) + '-PLAIN'], 'the suffix always fits, and look-alike values get distinct ids');
  assert.equal(new Set(skus).size, 3);
  // A product SKU cut on a segment boundary never leaves a double hyphen.
  const segmented = 'A'.repeat(57) + '-' + 'B'.repeat(6);
  const { ctx: c2, store: s2 } = shop();
  await commerceAdmin({ input: { type: 'form_submit', action_id: 'sell:11111111-aaaa-bbbb-cccc-999999999999', values: { regular: '9', sale: '', sku: segmented, stockStatus: 'in-stock', physical: true }, draft: { fields: { title: 'Segmented' } } } }, c2);
  const add2 = forms(await commerceAdmin({ input: { type: 'panel_load' } }, c2)).find((f) => f.submit.label === 'Add options');
  const added2 = await commerceAdmin({ input: { type: 'form_submit', action_id: add2.submit.action_id, values: { optionLabel: 'Size', values: 'Small, Large' } } }, c2);
  assert.notEqual(added2.toast?.type, 'error', JSON.stringify(added2.toast));
  assert.deepEqual((await product(s2, await pageProduct(s2.pages, 'page-1'))).variantProduct.members.map((m) => m.sku), [segmented, 'A'.repeat(57) + '-LARGE']);
  // Values whose numbered ids would collide take the next free number.
  const { ctx: c3, store: s3 } = shop();
  await commerceAdmin({ input: { type: 'form_submit', action_id: 'sell:11111111-aaaa-bbbb-cccc-aaaaaaaaaaaa', values: { regular: '9', sale: '', sku: 'FIT', stockStatus: 'in-stock', physical: true }, draft: { fields: { title: 'Fit' } } } }, c3);
  const add3 = forms(await commerceAdmin({ input: { type: 'panel_load' } }, c3)).find((f) => f.submit.label === 'Add options');
  const added3 = await commerceAdmin({ input: { type: 'form_submit', action_id: add3.submit.action_id, values: { optionLabel: 'Fit', values: 'A B, A-B-3, A-B' } } }, c3);
  assert.notEqual(added3.toast?.type, 'error', JSON.stringify(added3.toast));
  const fit = await product(s3, await pageProduct(s3.pages, 'page-1'));
  assert.deepEqual(fit.variantProduct.options[0].values.map((v) => v.valueId), ['a-b', 'a-b-3', 'a-b-2']);
  assert.deepEqual(fit.variantProduct.members.map((m) => m.sku), ['FIT', 'FIT-A-B-3', 'FIT-A-B-2']);
});

test('a blank SKU with a refused first price keeps the generated SKU, so fixing the price alone saves', async () => {
  const { ctx, store } = shop();
  const typo = await commerceAdmin({ input: { type: 'form_submit', action_id: 'sell:11111111-aaaa-bbbb-cccc-666666666666', values: { regular: 'nine', sale: '', sku: '', stockStatus: 'in-stock', physical: true }, draft: { fields: { title: 'Blank cap' } } } }, ctx);
  assert.equal(typo.toast.type, 'error');
  const id = await pageProduct(store.pages, 'page-1');
  const made = await product(store, id);
  const form = forms(typo).find((f) => f.submit.action_id.startsWith('save:'));
  assert.equal(form.fields.find((f) => f.action_id === 'sku').initial_value, made.sku, 'the generated SKU, not the blank that was typed');
  assert.match(made.sku, /^BLANK-CAP/);
  const fixed = await commerceAdmin({ input: { type: 'form_submit', action_id: form.submit.action_id, values: { regular: '9', sale: '', sku: made.sku, stockStatus: 'in-stock' } } }, ctx);
  assert.deepEqual(fixed.toast, { type: 'success', message: 'Product saved' });
  assert.deepEqual([(await product(store, id)).regular, (await product(store, id)).sku], ['9.00', made.sku]);
});
