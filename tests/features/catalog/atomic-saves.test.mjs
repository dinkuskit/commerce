import assert from 'node:assert/strict';
import test from 'node:test';
import { bigShop } from '../../helpers/catalog-memory.mjs';
import { loadCatalogProduct, resolveCatalogItemPrice, setCatalogItemManualAvailability } from '../../../dist/features/catalog/kernel/index.js';

const submit = (action_id, values) => ({ type: 'form_submit', action_id, values });
const weights = submit('weight:p001', { 'w:p001': '4', 'w:p001-large': '6' });
const price = submit('save:p002', { regular: '12', sale: '', stockStatus: 'out-of-stock', 'feed:google-merchant': true });
const snapshot = storage => JSON.stringify([...storage.catalog_items.records]);
const inspect = storage => {
  storage.catalog_items.calls.limit = Infinity;
  return loadCatalogProduct({ catalog: storage.catalog_items, prices: storage.catalog_prices, availability: storage.catalog_manual_availability }, 'p001');
};

test('one stock-10 save commits both weights; retry is an idempotent no-op', async () => {
  const { run, storage } = await bigShop(150);
  let commits = 0;
  const c = storage.catalog_items, cas = c.compareAndSet.bind(c);
  c.compareAndSet = (...args) => { commits++; return cas(...args); };
  assert.equal((await run(weights)).answer.toast.type, 'success');
  assert.deepEqual((await inspect(storage)).variantProduct.members.map(x => x.weightOz), [4, 6]);
  assert.equal(commits, 1);
  assert.equal((await run(weights)).answer.toast.type, 'success');
  assert.equal(commits, 1);
});

test('failure before commit leaves every choice unchanged', async () => {
  const { run, storage } = await bigShop();
  const before = snapshot(storage);
  storage.catalog_items.getVersioned = async () => { throw Error('offline'); };
  assert.equal((await run(weights)).answer.toast.type, 'error');
  assert.equal(snapshot(storage), before);
});

test('a refused atomic commit never leaves the first weight or price applied', async () => {
  for (const command of [weights, price]) {
    const { run, storage } = await bigShop();
    const before = snapshot(storage);
    storage.catalog_items.compareAndSet = async () => ({ applied: false });
    assert.equal((await run(command)).answer.toast.type, 'error');
    assert.equal(snapshot(storage), before);
    assert.equal(storage.catalog_prices.records.get('p002').regular.minor, '1000');
    assert.equal(storage.catalog_manual_availability.records.size, 0);
  }
});

test('lost acknowledgement is reconciled once; committed data is reported saved', async () => {
  const { run, storage } = await bigShop();
  const c = storage.catalog_items, cas = c.compareAndSet.bind(c);
  c.compareAndSet = async (...args) => { await cas(...args); throw Error('lost acknowledgement'); };
  assert.equal((await run(weights)).answer.toast.type, 'success');
  assert.deepEqual((await inspect(storage)).variantProduct.members.map(x => x.weightOz), [4, 6]);
});

test('an unresolvable write outcome offers a read, not a retry form', async () => {
  const { run, storage } = await bigShop();
  const c = storage.catalog_items;
  c.compareAndSet = async () => { c.getVersioned = async () => { throw Error('offline'); }; throw Error('timeout'); };
  const { answer } = await run(weights);
  assert.equal(answer.toast.type, 'info');
  assert.match(answer.toast.message, /outcome unknown/i);
  assert.ok(!answer.blocks.some(b => b.type === 'form'));
});

test('post-commit rendering failure reports saved and offers reload', async () => {
  const { run, storage } = await bigShop();
  const c = storage.catalog_items, cas = c.compareAndSet.bind(c);
  c.compareAndSet = async (...args) => {
    const result = await cas(...args);
    storage.catalog_prices.getMany = async () => { throw Error('renderer offline'); };
    return result;
  };
  const { answer } = await run(weights);
  assert.equal(answer.toast.type, 'success');
  assert.match(JSON.stringify(answer.blocks), /Reload product/);
  assert.equal(c.records.get('p001').catalogData.items['p001-large'].weightOz, 6);
});

test('price, manual availability and feed selection have one commit and one authority', async () => {
  const { run, storage } = await bigShop();
  assert.equal((await run(price)).answer.toast.type, 'success');
  storage.catalog_items.calls.limit = Infinity;
  assert.equal((await resolveCatalogItemPrice(storage.catalog_prices, 'p002', storage.catalog_items)).regular.minor, '1200');
  const data = storage.catalog_items.records.get('p002').catalogData;
  assert.equal(data.items.p002.availability.status, 'out-of-stock');
  assert.deepEqual(data.feedChannels, ['google-merchant']);
  assert.equal(storage.catalog_prices.records.get('p002').regular.minor, '1000', 'legacy rows are retained, not dual-written');
  assert.equal(storage.catalog_manual_availability.records.size, 0);
  await setCatalogItemManualAvailability({ catalog: storage.catalog_items, availability: storage.catalog_manual_availability }, { catalogItemId: 'p002', status: 'in-stock' });
  assert.equal((await resolveCatalogItemPrice(storage.catalog_prices, 'p002', storage.catalog_items)).regular.minor, '1200');
});

test('a stale rendered price form cannot overwrite a later save', async () => {
  const { run, storage } = await bigShop();
  const opened = (await run({ type: 'block_action', action_id: 'open', value: 'p002' })).answer;
  const form = opened.blocks.find(b => b.type === 'form' && b.submit.action_id.startsWith('save:'));
  assert.equal((await run(price)).answer.toast.type, 'success');
  const before = snapshot(storage);
  const result = (await run(submit(form.submit.action_id, { regular: '99', sale: '', stockStatus: 'in-stock' }))).answer;
  assert.equal(result.toast.type, 'error');
  assert.match(result.toast.message, /changed/);
  assert.equal(snapshot(storage), before);
});

test('oversized aggregate is refused before persistence', async () => {
  const { run, storage } = await bigShop();
  storage.catalog_items.records.get('p001').name = 'x'.repeat(1024 * 1024);
  const before = snapshot(storage);
  assert.equal((await run(weights)).answer.toast.type, 'error');
  assert.equal(snapshot(storage), before);
});

test('all fifty supported choice weights commit within stock ten', async () => {
  const { run, storage } = await bigShop();
  const c = storage.catalog_items, root = c.records.get('p001');
  for (let i = 2; i < 50; i++) {
    const id = `choice-${i}`, valueId = `size-${i}`;
    const member = structuredClone(c.records.get('p001-large'));
    Object.assign(member, { itemId: id, commandId: id, sku: id, skuKey: id, variantSelections: [{ optionId: 'size', valueId }] });
    c.records.set(id, member); c.revisions.set(id, crypto.randomUUID());
    root.variantProduct.options[0].values.push({ valueId, label: valueId });
    root.variantProduct.members.push({ catalogItemId: id, fulfillment: 'physical', selections: [{ optionId: 'size', valueId }] });
  }
  const values = Object.fromEntries(root.variantProduct.members.map((m, i) => ['w:' + m.catalogItemId, String(i + 1)]));
  const { answer, calls } = await run(submit('weight:p001', values));
  assert.equal(answer.toast.type, 'success');
  assert.ok(calls <= 10);
  assert.deepEqual((await inspect(storage)).variantProduct.members.map(m => m.weightOz), Array.from({ length: 50 }, (_, i) => i + 1));
});

test('clearing legacy values is authoritative and does not resurrect them', async () => {
  const { run, storage } = await bigShop();
  const item = storage.catalog_items.records.get('p002');
  item.weightOz = 8;
  assert.equal((await run(submit('save:p002', { regular: '', sale: '', stockStatus: 'in-stock' }))).answer.toast.type, 'info');
  assert.equal((await run(submit('weight:p002', { 'w:p002': '' }))).answer.toast.type, 'success');
  storage.catalog_items.calls.limit = Infinity;
  assert.equal((await resolveCatalogItemPrice(storage.catalog_prices, 'p002', storage.catalog_items)).listable, false);
  const loaded = await loadCatalogProduct({ catalog: storage.catalog_items, prices: storage.catalog_prices, availability: storage.catalog_manual_availability }, 'p002');
  assert.equal(loaded.weightOz, undefined);
  assert.equal(storage.catalog_prices.records.get('p002').regular.minor, '1000');
});
