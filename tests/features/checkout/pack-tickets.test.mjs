import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCheckout, reconcileCheckout } from '../../../dist/features/checkout/index.js';
import { openStore, fixture, cart } from './fixture.mjs';

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'checkout-pack-'));
  const opened = openStore(join(dir, 'store.sqlite'));
  t.after(() => { opened.db.close(); rmSync(dir, { recursive: true, force: true }); });
  return fixture(opened.store);
}
const merged = [...cart, { catalogItemId: 'one', quantity: 1 }];

test('a legacy reserved string leaves the paid order without ticket ids', async (t) => {
  const f = setup(t);
  f.setPayment('paid');
  const paid = await startCheckout(f.execution, 'legacy-cart', merged);
  assert.equal(paid.phase, 'paid');
  assert.deepEqual(paid.stock.requirements.map((line) => [line.skuId, line.quantity]), [['sku-one', 3], ['sku-two', 1]]);
  assert.equal('inventoryHold' in paid.order, false);
});

test('reserve ticket ids are stored on the order and a short list is refused', async (t) => {
  const f = setup(t);
  const ids = ['ticket-hats', 'ticket-shirts'];
  f.execution.resolveInventory = async () => ({
    async reserve() { return { outcome: 'reserved', ticketIds: ids }; },
    async release() { return 'released'; },
  });
  f.setPayment('paid');
  const paid = await startCheckout(f.execution, 'ticket-cart', merged);
  assert.deepEqual(paid.order.inventoryHold, { siteId: 'site-test', poolId: 'pool-test', ticketIds: ids });
  assert.equal(JSON.stringify(paid.order.inventoryHold).includes(paid.order.orderId), false);
  assert.deepEqual((await reconcileCheckout(f.execution, 'ticket-cart', paid.attemptId)).order.inventoryHold.ticketIds, ids);
  const short = setup(t);
  short.execution.resolveInventory = async () => ({
    async reserve() { return { outcome: 'reserved', ticketIds: ['only-one'] }; },
    async release() { return 'released'; },
  });
  await assert.rejects(startCheckout(short.execution, 'short-cart', cart), /Invalid reservation outcome/);
  const stored = (await short.execution.store.read('short-cart')).record.attempts[0];
  assert.equal(stored.phase, 'reserving');
  assert.equal(stored.order, undefined);
});
