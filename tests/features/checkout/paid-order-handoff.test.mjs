import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CHECKOUT_PHASE_TRANSITIONS,
  assertCheckoutPhaseTransition,
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

test('late authoritative paid wake on an already-released attempt is retained as mismatch, never silently acknowledged', async () => {
  const { store } = openStore(join(mkdtempSync(join(tmpdir(), 'released-late-paid-')), 'db'));
  const f = fixture(store, false);
  const attempt = await startCheckout(f.execution, 'cart', withSyntheticCheckoutContact(cart));
  f.setPayment('expired-unpaid');
  const released = await reconcileCheckout(f.execution, 'cart', attempt.attemptId);
  assert.equal(released.phase, 'released');

  const wake = { eventId: 'evt-late-paid', attemptId: attempt.attemptId, bindingRef: attempt.payment.bindingRef, deliveryGeneration: 1, wokeAt: 3000 };
  const associations = { get: async () => ({ attemptId: attempt.attemptId, cartId: 'cart', bindingRef: attempt.payment.bindingRef }) };
  let acks = 0;
  const wakes = { list: async () => [wake], acknowledge: async () => { acks++; return true; } };

  // Late paid outcome from Payments must retain as mismatch rather than silently acking.
  f.setPayment('paid');
  const mismatch = await reconcilePaymentWakes(f.execution, associations, wakes);
  assert.deepEqual(mismatch, [{ wake, status: 'retained', reason: 'mismatch' }]);
  assert.equal(acks, 0);

  // Authoritative expired-unpaid on the released attempt can be acknowledged safely.
  f.setPayment('expired-unpaid');
  const acked = await reconcilePaymentWakes(f.execution, associations, wakes);
  assert.equal(acked[0].status, 'acknowledged');
  assert.equal(acks, 1);
});

test('explicit CHECKOUT_PHASE_TRANSITIONS rejects illegal phase jumps', () => {
  assert.deepEqual(CHECKOUT_PHASE_TRANSITIONS.paid, []);
  assert.deepEqual(CHECKOUT_PHASE_TRANSITIONS.released, []);
  assert.doesNotThrow(() => assertCheckoutPhaseTransition('reserving', 'paying'));
  assert.doesNotThrow(() => assertCheckoutPhaseTransition('paying', 'paid'));
  assert.doesNotThrow(() => assertCheckoutPhaseTransition('releasing', 'released'));
  assert.throws(() => assertCheckoutPhaseTransition('paid', 'released'), /Illegal checkout phase transition/);
  assert.throws(() => assertCheckoutPhaseTransition('released', 'paid'), /Illegal checkout phase transition/);
  assert.throws(() => assertCheckoutPhaseTransition('reserving', 'paid'), /Illegal checkout phase transition/);
});
