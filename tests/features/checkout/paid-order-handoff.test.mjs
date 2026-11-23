import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  reconcileCheckout,
  reconcilePaymentWakes,
  startCheckout,
} from '../../../dist/features/checkout/index.js';
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

test('payment wake is retained until paid-order handoff durably succeeds and never acks conflict', async () => {
  const { store } = openStore(join(mkdtempSync(join(tmpdir(), 'handoff-wake-')), 'db'));
  const f = fixture(store, false);
  let mode = 'throw';
  const received = [];
  f.execution.paidOrders = {
    async receive(order) {
      if (mode === 'throw') throw new Error('Orders storage offline');
      if (mode === 'conflict') return 'conflict';
      received.push(structuredClone(order));
      return 'stored';
    },
  };
  const attempt = await startCheckout(f.execution, 'cart', withSyntheticCheckoutContact(cart));
  const wake = { eventId: 'evt-handoff', attemptId: attempt.attemptId, bindingRef: attempt.payment.bindingRef, deliveryGeneration: 1, wokeAt: 2000 };
  const associations = { get: async () => ({ attemptId: attempt.attemptId, cartId: 'cart', bindingRef: attempt.payment.bindingRef }) };
  let acks = 0;
  const wakes = { list: async () => [wake], acknowledge: async () => { acks++; return true; } };

  f.setPayment('paid');
  const first = await reconcilePaymentWakes(f.execution, associations, wakes);
  assert.deepEqual(first, [{ wake, status: 'retained', reason: 'unavailable' }]);
  assert.equal(acks, 0);
  assert.equal(received.length, 0);

  mode = 'conflict';
  const second = await reconcilePaymentWakes(f.execution, associations, wakes);
  assert.deepEqual(second, [{ wake, status: 'retained', reason: 'mismatch' }]);
  assert.equal(acks, 0);

  mode = 'ok';
  const third = await reconcilePaymentWakes(f.execution, associations, wakes);
  assert.equal(third[0].status, 'acknowledged');
  assert.equal(acks, 1);
  assert.equal(received.length, 1);
  assert.equal(received[0].orderId, `order:${attempt.attemptId}`);
});

test('a payment Payments confirms after the checkout ended unpaid makes the order, marked paid after checkout ended', async () => {
  const { store } = openStore(join(mkdtempSync(join(tmpdir(), 'released-late-paid-')), 'db'));
  const f = fixture(store, false);
  const received = [];
  f.execution.paidOrders = { async receive(order) { received.push(structuredClone(order)); return 'stored'; } };
  const attempt = await startCheckout(f.execution, 'cart', withSyntheticCheckoutContact(cart));
  f.setPayment('expired-unpaid');
  const released = await reconcileCheckout(f.execution, 'cart', attempt.attemptId);
  assert.equal(released.phase, 'released');

  // The shopper's own status check never asks again about a checkout that ended.
  f.setPayment('paid');
  assert.equal((await reconcileCheckout(f.execution, 'cart', attempt.attemptId)).phase, 'released');
  assert.equal(received.length, 0);

  const wake = { eventId: 'evt-late-paid', attemptId: attempt.attemptId, bindingRef: attempt.payment.bindingRef, deliveryGeneration: 1, wokeAt: 3000 };
  const associations = { get: async () => ({ attemptId: attempt.attemptId, cartId: 'cart', bindingRef: attempt.payment.bindingRef }) };
  let acks = 0;
  const wakes = { list: async () => [wake], acknowledge: async () => { acks++; return true; } };

  // While Payments cannot answer, the wake stays.
  f.setPayment('unknown');
  assert.deepEqual(await reconcilePaymentWakes(f.execution, associations, wakes), [{ wake, status: 'retained', reason: 'unknown' }]);
  assert.equal(acks, 0);

  // A confirmed payment makes the order from what was frozen at checkout, and only then is the wake acknowledged.
  f.setPayment('paid');
  const made = await reconcilePaymentWakes(f.execution, associations, wakes);
  assert.equal(made[0].status, 'acknowledged');
  assert.equal(made[0].attempt.phase, 'paid');
  assert.equal(acks, 1);
  assert.equal(received.length, 1);
  assert.equal(received[0].orderId, `order:${attempt.attemptId}`);
  assert.equal(received[0].paidAfterEnd, true);
  assert.deepEqual(received[0].total, attempt.payment.total);
});

test('a wake for a checkout that ended unpaid is acknowledged once Payments still answers unpaid', async () => {
  const { store } = openStore(join(mkdtempSync(join(tmpdir(), 'released-unpaid-')), 'db'));
  const f = fixture(store, false);
  const attempt = await startCheckout(f.execution, 'cart', withSyntheticCheckoutContact(cart));
  f.setPayment('expired-unpaid');
  assert.equal((await reconcileCheckout(f.execution, 'cart', attempt.attemptId)).phase, 'released');
  const wake = { eventId: 'evt-unpaid', attemptId: attempt.attemptId, bindingRef: attempt.payment.bindingRef, deliveryGeneration: 1, wokeAt: 3000 };
  const associations = { get: async () => ({ attemptId: attempt.attemptId, cartId: 'cart', bindingRef: attempt.payment.bindingRef }) };
  let acks = 0;
  const wakes = { list: async () => [wake], acknowledge: async () => { acks++; return true; } };
  const acked = await reconcilePaymentWakes(f.execution, associations, wakes);
  assert.equal(acked[0].status, 'acknowledged');
  assert.equal(acked[0].attempt.phase, 'released');
  assert.equal(acks, 1);
});
