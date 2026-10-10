import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reconcileCheckout, startCheckout } from '../../../dist/features/checkout/index.js';
import { cart, fixture, openStore, withSyntheticCheckoutContact } from './fixture.mjs';

function receiver(fail = false) {
  const received = [];
  return { received, setFail: v => { fail = v; }, async receive(order) {
    if (fail) throw new Error('Orders storage offline');
    received.push(structuredClone(order));
    return 'stored';
  } };
}

test('Checkout hands Orders one paid-order record built from its own frozen order', async () => {
  const { store } = openStore(join(mkdtempSync(join(tmpdir(), 'handoff-')), 'db'));
  const f = fixture(store);
  const orders = receiver();
  f.execution.paidOrders = orders;
  f.setPayment('paid');
  const paid = await startCheckout(f.execution, 'cart', withSyntheticCheckoutContact(cart));
  assert.equal(paid.phase, 'paid');
  assert.equal(orders.received.length, 1);
  const [record] = orders.received;
  assert.equal(record.schema, 'dinkuskit.commerce.paid-order/v1');
  assert.deepEqual({ ...record, schema: undefined }, { ...paid.order, schema: undefined });
  assert.equal(record.paidAt, new Date(1000 * 1000).toISOString());
  assert.deepEqual(record.ticketIds, paid.order.ticketIds);
});

test('a failed hand-off never changes the shopper outcome and the next check retries it', async () => {
  const { store } = openStore(join(mkdtempSync(join(tmpdir(), 'handoff-')), 'db'));
  const f = fixture(store, false);
  const orders = receiver(true);
  f.execution.paidOrders = orders;
  f.setPayment('paid');
  const paid = await startCheckout(f.execution, 'cart', withSyntheticCheckoutContact(cart));
  assert.equal(paid.phase, 'paid');
  assert.equal(orders.received.length, 0);
  orders.setFail(false);
  const again = await reconcileCheckout(f.execution, 'cart', paid.attemptId);
  assert.deepEqual(again.order, paid.order);
  assert.equal(orders.received.length, 1);
  assert.equal(orders.received[0].orderId, paid.order.orderId);
});

test('unpaid attempts hand nothing to Orders', async () => {
  const { store } = openStore(join(mkdtempSync(join(tmpdir(), 'handoff-')), 'db'));
  const f = fixture(store);
  const orders = receiver();
  f.execution.paidOrders = orders;
  const open = await startCheckout(f.execution, 'cart', withSyntheticCheckoutContact(cart));
  assert.equal(open.phase, 'paying');
  assert.equal(orders.received.length, 0);
});
