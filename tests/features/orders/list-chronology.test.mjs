import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaidOrderReceiver, listOrders, ordersBlocks } from '../../../dist/features/orders/index.js';
import { ordersMemory } from '../../helpers/orders-memory.mjs';
const collection = ordersMemory;
const money = { currency: 'USD', minor: '100' };
const paidOrder = (orderId, paidAt) => ({ schema: 'dinkuskit.commerce.paid-order/v1', orderId,
  receiptId: 'receipt-' + orderId, attemptId: 'attempt-' + orderId, mode: 'test',
  ...(paidAt === undefined ? {} : { paidAt }),
  lines: [{ catalogItemId: 'synthetic-hat', name: 'Synthetic hat', quantity: 1, unitPrice: money }], total: money });
const route = input => ({ user: { role: 50 }, ui: { surface: 'admin-page' }, input });
const load = { type: 'page_load', page: '/orders' };
const elements = view => view.blocks.flatMap(block => block.elements ?? []);
const ids = view => elements(view).filter(e => e.action_id?.startsWith('orders.open:')).map(e => decodeURIComponent(e.action_id.slice(12)));
const page = element => route({ type: 'block_action', action_id: element.action_id, value: element.value });

test('the native list shows the newest kept order first, 25 a page, without changing storage order', async () => {
  const orders = collection(), numbers = collection();
  const receiver = createPaidOrderReceiver(orders, numbers);
  const chronologicalIds = [];
  for (let i = 1; i <= 26; i++) {
    const id = i === 26 ? 'zz-newest' : 'aa-' + String(i).padStart(2, '0');
    chronologicalIds.push(id);
    assert.equal(await receiver.receive(paidOrder(id, new Date(Date.UTC(2026, 0, i)).toISOString())), 'stored');
  }
  const storageOrder = await listOrders(orders);
  assert.deepEqual(storageOrder.map(r => r.paidOrder.orderId), chronologicalIds);
  const before = structuredClone([...orders.rows]), writes = orders.writes + numbers.writes;
  let shipCalls = 0;
  const ctx = { storage: { orders, order_numbers: numbers } }, services = { ship: async () => { shipCalls++; } };
  const first = await ordersBlocks(route(load), ctx, services);
  assert.deepEqual(ids(first), chronologicalIds.toReversed().slice(0, 25));
  const summaries = first.blocks.filter(block => block.type === 'fields');
  assert.equal(summaries.length, 25);
  for (const summary of summaries) {
    assert.deepEqual(summary.fields.find(field => field.label === 'Total'), { label: 'Total', value: '$1.00' });
    assert.deepEqual(summary.fields.find(field => field.label === 'Payment'), { label: 'Payment', value: 'Payment not recorded' });
  }
  const next = elements(first).find(e => e.label === 'Next');
  assert.ok(next);
  const second = await ordersBlocks(page(next), ctx, services);
  assert.deepEqual(ids(second), [chronologicalIds[0]]);
  assert.equal(new Set([...ids(first), ...ids(second)]).size, 26);
  const previous = elements(second).find(e => e.label === 'Previous');
  assert.ok(previous);
  assert.deepEqual(ids(await ordersBlocks(page(previous), ctx, services)), ids(first));
  for (const id of [chronologicalIds[0], chronologicalIds[25]]) {
    const detail = await ordersBlocks(route({ type: 'block_action', action_id: 'orders.open:' + encodeURIComponent(id) }), ctx, services);
    assert.match(JSON.stringify(detail), new RegExp('receipt-' + id));
    assert.deepEqual(ids(await ordersBlocks(route({ type: 'block_action', action_id: 'orders.list' }), ctx, services)), ids(first));
  }
  assert.equal(shipCalls, 1);
  assert.equal(orders.writes + numbers.writes, writes);
  assert.deepEqual([...orders.rows], before);
  assert.deepEqual(await listOrders(orders), storageOrder);
});

test('the list follows when Orders kept each order, newest first with ties by order id; orders kept before that time was recorded come first', async () => {
  const orders = collection();
  // paidKey is "<time Orders kept it> <order id>"; orders kept before 22 Nov 2026 have none.
  const records = [
    ['a-old', undefined, 1001], ['b-old', undefined, 1002],
    ['k-first', '2026-11-23T08:00:00.000Z k-first', 1003], ['k-last', '2026-11-23T10:00:00.000Z k-last', 1005],
    ['k-middle', '2026-11-23T09:00:00.000Z k-middle', 1004],
  ];
  for (const [id, paidKey, number] of records) await orders.compareAndSet(id, null,
    { paidOrder: paidOrder(id, '2026-01-01T00:00:00Z'), number, revision: 1, ...(paidKey && { paidKey }) });
  const before = structuredClone([...orders.rows]), writes = orders.writes;
  const ctx = { storage: { orders } };
  const expected = ['b-old', 'a-old', 'k-last', 'k-middle', 'k-first'];
  assert.deepEqual(ids(await ordersBlocks(route(load), ctx)), expected);
  assert.deepEqual(ids(await ordersBlocks(route({ type: 'block_action', action_id: 'orders.list' }), ctx)), expected);
  assert.equal(orders.writes, writes);
  assert.deepEqual([...orders.rows], before);
});

const kept = (orders, count) => Promise.all(Array.from({ length: count }, (_, k) => {
  const i = k + 1, id = 'order-' + String(i).padStart(5, '0');
  return orders.compareAndSet(id, null, { paidOrder: paidOrder(id, '2026-01-01T00:00:00Z'), number: 1000 + i, revision: 1,
    paidKey: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() + ' ' + id });
}));

test('a malformed order on the shown page makes Orders unavailable; one on a later page leaves this page alone and cannot be opened', async () => {
  const orders = collection();
  await kept(orders, 26);
  orders.rows.get('order-00026').value.paidOrder.total.minor = '1.00';
  const writes = orders.writes;
  const shown = await ordersBlocks(route(load), { storage: { orders } });
  assert.match(JSON.stringify(shown), /Orders unavailable/);
  assert.deepEqual(ids(shown), []);
  orders.rows.get('order-00026').value.paidOrder.total.minor = '100';
  orders.rows.get('order-00001').value.paidOrder.total.minor = '1.00';
  const first = await ordersBlocks(route(load), { storage: { orders } });
  assert.equal(ids(first).length, 25);
  assert.equal(ids(first)[0], 'order-00026');
  const opened = await ordersBlocks(route({ type: 'block_action', action_id: 'orders.open:order-00001' }), { storage: { orders } });
  assert.match(JSON.stringify(opened), /Orders unavailable/);
  assert.equal(orders.writes, writes);
});

test('a store with more than 10,000 orders still opens Orders, reading only what the page shows', async () => {
  const orders = collection();
  await kept(orders, 10_050);
  let reads = 0;
  const query = orders.query;
  orders.query = options => { reads++; return query(options); };
  const ctx = { storage: { orders } };
  const first = await ordersBlocks(route(load), ctx);
  assert.deepEqual(ids(first), Array.from({ length: 25 }, (_, k) => 'order-' + String(10_050 - k).padStart(5, '0')));
  assert.equal(reads, 1);
  const next = elements(first).find(e => e.label === 'Next');
  assert.equal(next.value, 25);
  // The last page is reached by its offset; it reads through earlier rows 100 at a time and never fails.
  reads = 0;
  const last = await ordersBlocks(page({ ...next, value: 10_025 }), ctx);
  assert.deepEqual(ids(last), Array.from({ length: 25 }, (_, k) => 'order-' + String(25 - k).padStart(5, '0')));
  assert.equal(reads, 101);
  assert.equal(elements(last).find(e => e.label === 'Next'), undefined);
});
