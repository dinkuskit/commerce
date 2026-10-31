import assert from 'node:assert/strict';
import test from 'node:test';
import { productPanel } from '../../../dist/admin/index.js';

// Product editing lives in the Dinkus Commerce panel on each Content > Products page.
const commerceAdmin = (route, ctx) => productPanel({ ...route, ui: { surface: 'content-editor-panel', locale: 'en', direction: 'ltr', extensionId: 'product', entry: { collection: 'products', id: 'page-1', locale: null, version: 1 } } }, ctx);
import { addCatalogVariantOption, createCatalogItem, listCatalogProducts, loadCatalogProduct, setCatalogProductArchived } from '../../../dist/features/catalog/kernel/index.js';

// Every storage call from a Registry plugin is one subrequest, and the sandbox allows only a
// few per call: EmDash's default is 10, Template Store raises it to 32. A product screen must
// cost the same in a big catalog as in a small one, archived products included.
const EMDASH_DEFAULT = 10;
const TEMPLATE_STORE = 32;

import { bigShop } from '../../helpers/catalog-memory.mjs';
import { shop as catalogShop } from './catalog-store.mjs';

const submit = (action_id, values) => ({ type: 'form_submit', action_id, values });
const isError = (answer) => answer.toast?.type === 'error' || answer.blocks?.some((block) => block.type === 'banner' && block.variant === 'error');

const PAGES = new Set(['unlinked panel', 'product page', 'product page with variants']);

test('each product screen costs the same few storage calls however many products the store has', async () => {
  const costs = new Map();
  for (const size of [10, 50, 150]) {
    const { run } = await bigShop(size);
    const screens = {
      // An unlinked page's panel is the price form whose Save makes the product (catalog-product-needs-page-20261031).
      'unlinked panel': { type: 'panel_load' },
      'product page': { type: 'block_action', action_id: 'open', value: 'p002' },
      // A new SKU in the same Save costs one read, not the index proof every creation makes.
      'price save': submit('save:p002', { regular: '12.00', sale: '', sku: 'SKU-P002-B', stockStatus: 'in-stock' }),
      'weight save': submit('weight:p002', { 'w:p002': '8' }),
      'archive': { type: 'block_action', action_id: 'archive', value: { id: 'p002', a: true } },
      'product page with variants': { type: 'block_action', action_id: 'open', value: 'p001' },
      'variant weight save': submit('weight:p001', { 'w:p001': '4', 'w:p001-large': '6' }),
    };
    for (const [screen, input] of Object.entries(screens)) {
      const { answer, calls } = await run(input);
      assert.equal(isError(answer), false, `${screen} with ${size} products answered ${JSON.stringify(answer).slice(0, 300)}`);
      assert.ok(calls <= EMDASH_DEFAULT, `${screen} with ${size} products made ${calls} storage calls`);
      // No screen's cost grows with the catalog.
      const first = costs.get(screen) ?? calls;
      costs.set(screen, first);
      assert.equal(calls, first, `${screen} cost ${first} calls with 10 products and ${calls} with ${size}`);
    }
  }
});

test('a variant price save stays under the limit in a big store', async () => {
  const { run, storage } = await bigShop(150);
  const opened = (await run({ type: 'block_action', action_id: 'open', value: 'p001' })).answer;
  const blocksOf = (blocks) => blocks.flatMap((block) => block.type === 'accordion' ? blocksOf(block.blocks) : [block]);
  const priceForm = blocksOf(opened.blocks).find((block) => block.type === 'form' && block.submit.action_id.startsWith('variant:["price","p001","p001-large"'));
  assert.ok(priceForm, 'the Large variant has its own price form');
  const { answer, calls } = await run(submit(priceForm.submit.action_id, { regular: '15.00', sale: '', sku: 'SKU-P001-LG', stockStatus: 'in-stock' }));
  assert.deepEqual(answer.toast, { type: 'success', message: 'Changes saved' });
  assert.equal((await storage.catalog_items.get('p001-large')).sku, 'SKU-P001-LG', 'the variant SKU changed in the same Save');
  assert.ok(calls <= EMDASH_DEFAULT, `choice price save made ${calls} storage calls`);
});

test('storage adapters written for 0.2.x without getMany still list and load products', async () => {
  const { storage } = await bigShop(12);
  const getOnly = (collection) => ({ get: (id) => collection.get(id), getVersioned: (id) => collection.getVersioned(id), query: (options) => collection.query(options) });
  const batched = { catalog: storage.catalog_items, prices: storage.catalog_prices, availability: storage.catalog_manual_availability };
  const legacy = { catalog: getOnly(storage.catalog_items), prices: getOnly(storage.catalog_prices), availability: getOnly(storage.catalog_manual_availability) };
  assert.deepEqual(await listCatalogProducts(legacy), await listCatalogProducts(batched));
  for (const id of ['p001', 'p002', 'p003']) {
    assert.deepEqual(await loadCatalogProduct(legacy, id), await loadCatalogProduct(batched, id));
  }
  assert.equal((await loadCatalogProduct(legacy, 'p001')).variantProduct.members.length, 2);
  assert.equal(await loadCatalogProduct(legacy, 'p001-large'), null, 'a choice is not a listed product');
});

test('Add options makes up to seven new variants in one Save within the Template Store budget, and refuses more before writing', async () => {
  const { ctx } = catalogShop();
  const raw = ctx.storage.catalog_items;
  const calls = { n: 0, limit: 0 };
  for (const [name, collection] of Object.entries(ctx.storage)) ctx.storage[name] = new Proxy(collection, { get(target, key) {
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? (...args) => { calls.n += 1; if (calls.limit && calls.n > calls.limit) throw new Error('Invocation budget exceeded'); return value.apply(target, args); } : value;
  } });
  const run = async (input, limit = TEMPLATE_STORE) => { calls.n = 0; calls.limit = limit; return { answer: await commerceAdmin({ input }, ctx), calls: calls.n }; };
  const blocksOf = (blocks) => blocks.flatMap((block) => block.type === 'accordion' ? blocksOf(block.blocks) : [block]);
  await run({ type: 'form_submit', action_id: 'sell:11111111-aaaa-bbbb-cccc-eeeeeeeeeeee', values: { regular: '12', sale: '', sku: 'TEE', stockStatus: 'in-stock', physical: true }, draft: { fields: { title: 'Tee' } } }, 0);
  const add = blocksOf((await run({ type: 'panel_load' }, 0)).answer.blocks).find((block) => block.type === 'form' && block.submit.label === 'Add options');
  // Eight new variants is one more than a request makes: refused before anything is written, so no variant rows are left behind.
  const rows = raw.records.size;
  const tooMany = await run(submit(add.submit.action_id, { optionLabel: 'Size', values: 'A, B, C, D, E, F, G, H, I' }));
  assert.equal(tooMany.answer.toast.type, 'error');
  assert.match(tooMany.answer.toast.message, /Up to 7 new variants at once/);
  assert.equal(raw.records.size, rows, 'no variant row was written');
  assert.ok(tooMany.calls <= TEMPLATE_STORE, `the refusal made ${tooMany.calls} storage calls`);
  // Eight values, seven new variants: the indexes are proved once for the request, so it fits.
  const fits = await run(submit(add.submit.action_id, { optionLabel: 'Size', values: 'XS, S, M, L, XL, XXL, 3XL, 4XL' }));
  assert.deepEqual(fits.answer.toast, { type: 'success', message: 'Changes saved' });
  assert.ok(fits.calls <= TEMPLATE_STORE, `Add options with eight values made ${fits.calls} storage calls`);
  const product = [...raw.records.values()].find((row) => row.variantProduct);
  assert.equal(product.variantProduct.members.length, 8);
  assert.equal(raw.records.size, rows + 7);
});
