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
      'price save': submit('save:p002', { regular: '12.00', sale: '', stockStatus: 'in-stock' }),
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
  const { run } = await bigShop(150);
  const opened = (await run({ type: 'block_action', action_id: 'open', value: 'p001' })).answer;
  const blocksOf = (blocks) => blocks.flatMap((block) => block.type === 'accordion' ? blocksOf(block.blocks) : [block]);
  const priceForm = blocksOf(opened.blocks).find((block) => block.type === 'form' && block.submit.action_id.startsWith('variant:["price","p001","p001-large"'));
  assert.ok(priceForm, 'the Large variant has its own price form');
  const { answer, calls } = await run(submit(priceForm.submit.action_id, { regular: '15.00', sale: '', stockStatus: 'in-stock' }));
  assert.deepEqual(answer.toast, { type: 'success', message: 'Changes saved' });
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
