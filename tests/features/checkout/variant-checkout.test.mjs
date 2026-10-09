import { withSyntheticCheckoutContact } from './fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createCatalogItem, addCatalogVariantOption, saveCatalogProductPrices, updateCatalogVariantLabels } from '../../../dist/features/catalog/kernel/index.js';
import { startCheckout, reconcileCheckout } from '../../../dist/features/checkout/index.js';
import { openStore, fixture } from './fixture.mjs';

function collection() {
  const records = new Map(), revisions = new Map();
  return {
    async get(id) { return structuredClone(records.get(id) ?? null); },
    async getVersioned(id) { const value = await this.get(id); return value ? { value, revision: revisions.get(id) } : null; },
    async put(id, value) { for (const [key, other] of records) for (const field of ['commandId', 'skuKey']) {
      if (key !== id && value[field] !== undefined && value[field] === other[field]) throw new Error(`UNIQUE constraint failed: index 'uidx_plugin_dinkus-commerce_catalogItems_${field}'`);
    } records.set(id, structuredClone(value)); revisions.set(id, crypto.randomUUID()); },
    async delete(id) { records.delete(id); revisions.delete(id); },
    async query({ where = {} } = {}) { return { items: [...records].filter(([,v]) => Object.entries(where).every(([k,x]) => v[k] === x)).map(([id,data]) => ({ id, data: structuredClone(data) })), hasMore: false }; },
    async compareAndSet(id, revision, value) { if ((revisions.get(id) ?? null) !== revision) return { applied: false }; await this.put(id, value); return { applied: true, revision: revisions.get(id) }; },
    async compareAndDelete(id, revision) { if (revisions.get(id) !== revision) return { applied: false }; await this.delete(id); return { applied: true }; },
  };
}

test('merchant variant writes deny Small before Payments and freeze Large money, labels, and fulfillment in one paid order', async t => {
  const opened = openStore(':memory:'); t.after(() => opened.db.close());
  const f = fixture(opened.store, false);
  const catalog = collection(), prices = collection(), availability = collection();
  const writes = { catalog, prices, availability, claims: collection() };
  Object.assign(f.execution.catalog, { catalog, prices, manualAvailability: availability });
  f.execution.resolveInventory = async () => { throw Error('unmanaged variants must not activate Inventory'); };
  const created = await createCatalogItem(catalog, { commandId: 'shirt', name: 'Proof shirt', sku: 'PROOF-SMALL', fulfillment: 'physical' }, { createId: () => 'small' });
  assert.equal(created.item.variantProduct.defaultMemberId, 'small');
  assert.equal(created.item.variantProduct.options.length, 0);
  const expanded = await addCatalogVariantOption(writes, { productId: 'small', optionId: 'size', optionLabel: 'Size', values: [
    { valueId: 's', label: 'Small', member: { catalogItemId: 'small', fulfillment: 'physical' } },
    { valueId: 'l', label: 'Large', member: { commandId: 'large', name: 'Proof shirt', sku: 'PROOF-LARGE', fulfillment: 'digital' } },
  ] }, { createId: () => 'large' });
  assert.equal(expanded.product.defaultMemberId, 'small');
  await saveCatalogProductPrices(writes, { catalogItemId: 'small', regular: '20', sale: '', stockStatus: 'out-of-stock', expectedRevision: null });
  await saveCatalogProductPrices(writes, { catalogItemId: 'large', regular: '24', sale: '', stockStatus: 'in-stock', expectedRevision: null });
  await assert.rejects(startCheckout(f.execution, 'small-cart', withSyntheticCheckoutContact([{ catalogItemId: 'small', quantity: 1 }])));
  assert.equal(f.sessions.size, 0);
  assert.equal(f.holds.size, 0);
  const started = await startCheckout(f.execution, 'large-cart', withSyntheticCheckoutContact([{ catalogItemId: 'large', quantity: 1 }]));
  assert.equal(started.payment.total.minor, '2400');
  const frozen = structuredClone(started.payment);
  assert.equal(started.variantSelections[0].selections[0].valueLabel, 'Large');
  assert.equal(started.variantSelections[0].fulfillment, 'digital');
  await saveCatalogProductPrices(writes, { catalogItemId: 'large', regular: '99', sale: '', stockStatus: 'out-of-stock', expectedRevision: (await prices.getVersioned('large')).revision });
  await updateCatalogVariantLabels(writes, { productId: 'small', expectedRevision: expanded.product.revision, optionLabel: 'Changed size', values: [{ valueId: 'l', label: 'Changed Large' }], members: [{ catalogItemId: 'large', fulfillment: 'physical' }] });
  f.setPayment('paid');
  const paid = await reconcileCheckout(f.execution, 'large-cart', started.attemptId);
  assert.equal(paid.phase, 'paid');
  assert.deepEqual(paid.payment, frozen);
  assert.equal(paid.order.total.minor, '2400');
  assert.equal(paid.order.variantSelections[0].selections[0].valueLabel, 'Large');
  assert.equal(paid.order.variantSelections[0].fulfillment, 'digital');
  assert.deepEqual((await reconcileCheckout(f.execution, 'large-cart', started.attemptId)).order, paid.order);
  assert.deepEqual((await opened.store.read('large-cart')).record.attempts[0].order, paid.order);
});
