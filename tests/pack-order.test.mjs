import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryPackCommand } from '../dist/admin/pack-order.js';
import { ordersBlocks } from '../dist/admin/orders-blocks.js';

const context = { siteId: 'site-test', poolId: 'pool-test' };
test('Pack builds stock.pack or stock.pack_all and omits the order number', () => {
  assert.deepEqual(inventoryPackCommand({ ...context, ticketIds: ['ticket-hats'] }), {
    schema: 'dinkuskit.inventory.command/v1', commandId: 'pack:ticket-hats', type: 'stock.pack',
    context, payload: { reservationId: 'ticket-hats' }, references: [],
  });
  const all = inventoryPackCommand({ ...context, ticketIds: ['ticket-hats', 'ticket-shirts'] });
  assert.equal(all.type, 'stock.pack_all');
  assert.deepEqual(all.payload, { reservationIds: ['ticket-hats', 'ticket-shirts'] });
  assert.equal(JSON.stringify(all).includes('order:'), false);
  assert.equal(inventoryPackCommand(undefined), null);
});

function order(orderId, hold) {
  return {
    orderId, receiptId: 'r-' + orderId, attemptId: 'a-' + orderId,
    lines: [{ catalogItemId: 'hats', name: 'Hats', quantity: 3, unitPrice: { currency: 'USD', minor: '100' } }],
    total: { currency: 'USD', minor: '300' }, ...(hold ? { inventoryHold: hold } : {}),
  };
}
function storage(record) {
  return { checkout_carts: {
    async query() { return { items: [{ id: 'cart', data: { attempts: [{ phase: 'paid', attemptId: record.attemptId, order: record }] } }], hasMore: false }; },
    compareAndSet() { throw new Error('pack must not write'); },
  } };
}
const route = (orderId) => ({ user: { role: 50 }, ui: { surface: 'admin-page' }, input: {
  type: 'block_action', action_id: 'orders.pack:' + encodeURIComponent(orderId),
} });

test('Pack fails closed and does not mark the order packed', async () => {
  const held = order('order:abc', { ...context, ticketIds: ['ticket-hats', 'ticket-shirts'] });
  const text = JSON.stringify(await ordersBlocks(route(held.orderId), { storage: storage(held) }));
  assert.match(text, /Not packed/);
  assert.match(text, /No pack route/);
  assert.match(text, /Not recorded/);
  assert.equal(text.includes('Delivered'), false);
  const legacy = JSON.stringify(await ordersBlocks(route('order:legacy'), { storage: storage(order('order:legacy')) }));
  assert.match(legacy, /No ticket ids/);
  assert.match(legacy, /Not recorded/);
});
