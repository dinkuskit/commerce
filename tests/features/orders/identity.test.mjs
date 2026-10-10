import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBlocks } from '@emdash-cms/blocks/server';
import { createPaidOrderReceiver, listOrders, ordersBlocks, takeOrderNumber } from '../../../dist/features/orders/index.js';

// In-memory storage with revisions, enough for compare-and-set.
function collection() {
  const rows = new Map(); let n = 0;
  return { rows,
    async get(id) { return rows.get(id)?.value ?? null; },
    async getVersioned(id) { return rows.get(id) ? structuredClone(rows.get(id)) : null; },
    async compareAndSet(id, expected, value) {
      if ((rows.get(id)?.revision ?? null) !== expected) return { applied: false };
      rows.set(id, { value: structuredClone(value), revision: 'r' + ++n }); return { applied: true, revision: 'r' + n };
    },
    async query() { return { items: [...rows].map(([id, row]) => ({ id, data: structuredClone(row.value) })), hasMore: false }; },
  };
}
const usd = minor => ({ currency: 'USD', minor });
const delivery = { name: 'Fixture Shopper', line1: '1 Example Way', city: 'Testville', postalCode: '00000', country: 'US' };
const order = (id, paidAt, withAddress = true) => ({ schema: 'dinkuskit.commerce.paid-order/v1', orderId: id, receiptId: 'r-' + id, attemptId: 'a-' + id, paidAt,
  lines: [{ catalogItemId: 'hat', quantity: 1, name: 'Hat', unitPrice: usd('100') }], total: usd('100'),
  ...(withAddress ? { contactSnapshot: { schema: 'dinkuskit.commerce.checkout-contact/v1', requirePhoneNumber: false, revision: null, contact: { email: 'shopper@example.com', delivery } } } : {}) });
const route = input => ({ user: { role: 50 }, ui: { surface: 'admin-page' }, input });
const services = { shippingCountries: async () => ['US'] };

test('each kept order gets the next short number and version 1; a repeat takes no number', async () => {
  const orders = collection(), numbers = collection();
  const receiver = createPaidOrderReceiver(orders, numbers);
  assert.equal(await receiver.receive(order('b', '2026-10-10T02:00:00Z')), 'stored');
  assert.equal(await receiver.receive(order('a', '2026-10-10T03:00:00Z')), 'stored');
  assert.equal(await receiver.receive(order('a', '2026-10-10T03:00:00Z')), 'duplicate');
  const kept = await listOrders(orders);
  assert.deepEqual(kept.map(r => [r.paidOrder.orderId, r.number, r.revision]), [['a', 1002, 1], ['b', 1001, 1]]);
  assert.equal(await takeOrderNumber(numbers), 1003);
});

test('orders kept before numbering are numbered oldest paid first when Orders opens', async () => {
  const orders = collection(), numbers = collection();
  await orders.compareAndSet('late', null, { paidOrder: order('late', '2026-10-09T05:00:00Z') });
  await orders.compareAndSet('early', null, { paidOrder: order('early', '2026-10-09T01:00:00Z') });
  const list = JSON.stringify(await ordersBlocks(route({ type: 'page_load', page: '/orders' }), { storage: { orders, order_numbers: numbers } }));
  assert.ok(list.includes('#1001') && list.includes('#1002'));
  assert.deepEqual((await listOrders(orders)).map(r => [r.paidOrder.orderId, r.number]), [['early', 1001], ['late', 1002]]);
});

test('the owner corrects the address; the checkout copy stays and the version goes up', async () => {
  const orders = collection(), numbers = collection();
  await createPaidOrderReceiver(orders, numbers).receive(order('o1', '2026-10-10T01:00:00Z'));
  const storage = { storage: { orders, order_numbers: numbers } };
  const detail = await ordersBlocks(route({ type: 'block_action', action_id: 'orders.open:o1' }), storage, services);
  assert.ok(JSON.stringify(detail).includes('orders.address:o1'));
  const form = await ordersBlocks(route({ type: 'block_action', action_id: 'orders.address:o1' }), storage, services);
  assert.equal(validateBlocks(form.blocks).valid, true);
  const submit = form.blocks.find(b => b.type === 'form').submit.action_id;
  assert.equal(submit, 'orders.save:1:o1');
  const values = { ...delivery, line1: '2 Fixed Road', line2: '', region: '' };
  const saved = JSON.stringify(await ordersBlocks(route({ type: 'form_submit', action_id: submit, values }), storage, services));
  assert.match(saved, /Address saved/);
  assert.match(saved, /2 Fixed Road, Testville, 00000, US \(corrected\)/);
  const [record] = await listOrders(orders);
  assert.equal(record.revision, 2);
  assert.equal(record.paidOrder.contactSnapshot.contact.delivery.line1, '1 Example Way');
  // The form was opened at version 1, so a second save is refused.
  assert.match(JSON.stringify(await ordersBlocks(route({ type: 'form_submit', action_id: submit, values }), storage, services)), /changed since you opened/);
  assert.equal((await listOrders(orders))[0].revision, 2);
});

test('a correction must be complete and go to a country the store ships to', async () => {
  const orders = collection();
  await createPaidOrderReceiver(orders).receive(order('o1', '2026-10-10T01:00:00Z'));
  for (const values of [{ ...delivery, country: 'CA' }, { ...delivery, city: '' }]) {
    const refused = await ordersBlocks(route({ type: 'form_submit', action_id: 'orders.save:1:o1', values }), { storage: { orders } }, services);
    assert.match(JSON.stringify(refused), /Address not saved/);
    assert.equal(refused.blocks.find(b => b.type === 'form').fields.find(f => f.action_id === 'country').initial_value, values.country);
  }
  assert.equal((await listOrders(orders))[0].revision, 1);
  assert.equal((await listOrders(orders))[0].delivery, undefined);
});

test('a digital-only order offers no address correction', async () => {
  const orders = collection();
  await createPaidOrderReceiver(orders).receive(order('d1', '2026-10-10T01:00:00Z', false));
  const detail = JSON.stringify(await ordersBlocks(route({ type: 'block_action', action_id: 'orders.open:d1' }), { storage: { orders } }, services));
  assert.ok(detail.includes('No address'));
  assert.ok(!detail.includes('orders.address:'));
});
