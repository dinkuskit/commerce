import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaidOrderReceiver, listOrders, ordersBlocks } from '../../../dist/features/orders/index.js';

function collection() {
  const rows = new Map(); let version = 0, writes = 0;
  return { rows, get writes() { return writes; },
    async get(id) { return structuredClone(rows.get(id)?.value ?? null); },
    async getVersioned(id) { return structuredClone(rows.get(id) ?? null); },
    async compareAndSet(id, expected, value) {
      if ((rows.get(id)?.revision ?? null) !== expected) return { applied: false };
      const revision = String(++version);
      rows.set(id, { value: structuredClone(value), revision }); writes++;
      return { applied: true, revision };
    },
    async query() { return { items: [...rows].map(([id, row]) => ({ id, data: structuredClone(row.value) })), hasMore: false }; },
  };
}
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

test('native list sorts every order newest paid first before 25-row pagination, without changing storage order', async () => {
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

test('native chronology parses offsets, puts unknown times last, and breaks ties by number then exact ID', async () => {
  const orders = collection();
  const records = [
    ['a-unknown', undefined, undefined], ['z-known', '2026-01-01T10:00:00Z', 1008],
    ['a-offset', '2026-01-01T07:00:00-04:00', 1001],
    ['tie-low', '2026-01-01T09:00:00Z', 1002], ['tie-high', '2026-01-01T10:00:00+01:00', 1003],
    ['tie-b', '2026-01-01T08:00:00Z', undefined], ['tie-a', '2026-01-01T08:00:00Z', undefined],
    ['unknown-low', undefined, 1004], ['unknown-high', 'not-a-date', 1005],
    ['z-unknown', 'not-a-date', undefined],
  ];
  for (const [id, at, number] of records) await orders.compareAndSet(id, null,
    { paidOrder: paidOrder(id, at), ...(number === undefined ? {} : { number }), revision: 1 });
  const before = structuredClone([...orders.rows]), writes = orders.writes;
  const ctx = { storage: { orders } };
  const expected = ['a-offset', 'z-known', 'tie-high', 'tie-low', 'tie-a', 'tie-b', 'unknown-high', 'unknown-low', 'a-unknown', 'z-unknown'];
  assert.deepEqual(ids(await ordersBlocks(route(load), ctx)), expected);
  assert.deepEqual(ids(await ordersBlocks(route({ type: 'block_action', action_id: 'orders.list' }), ctx)), expected);
  assert.equal(orders.writes, writes);
  assert.deepEqual([...orders.rows], before);
});

test('native chronology still validates records beyond the visible page and refuses malformed history', async () => {
  const orders = collection();
  for (let i = 1; i <= 26; i++) await orders.compareAndSet('order-' + i, null,
    { paidOrder: paidOrder('order-' + i, new Date(Date.UTC(2026, 0, i)).toISOString()), number: 1000 + i });
  orders.rows.get('order-1').value.paidOrder.total.minor = '1.00';
  const writes = orders.writes;
  const view = await ordersBlocks(route(load), { storage: { orders } });
  assert.match(JSON.stringify(view), /Orders unavailable/);
  assert.deepEqual(ids(view), []);
  assert.equal(orders.writes, writes);
});
