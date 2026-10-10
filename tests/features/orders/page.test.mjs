import test from 'node:test';
import assert from 'node:assert/strict';
import { ordersBlocks } from '../../../dist/features/orders/index.js';
const input = { type:'page_load', page:'/orders' };
const route = { user:{role:50}, ui:{surface:'admin-page'}, input };
// These guard the new controller's trusted boundary; projection tests cannot exercise it.
test('Orders denies forged caller privileges before reading storage', async () => {
 const ctx={get storage(){throw Error('must not read');}};
 for(const host of [{},{user:{role:40},ui:{surface:'admin-page'}},{user:{role:50}},{user:{role:'invalid'},ui:{surface:'admin-page'}}]) {
  const response=await ordersBlocks({...host,input:{...input,user:{role:50},ui:{surface:'admin-page'}}},ctx);
  assert.equal(response.blocks[0].title,'Orders require plugins:manage');
 }
});
test('Orders distinguishes empty storage from unavailable storage', async()=>{
 const empty=await ordersBlocks(route,{storage:{orders:{query:async()=>({items:[],hasMore:false})}}});
 assert.ok(JSON.stringify(empty).includes('No orders recorded yet.'));
 const unavailable=await ordersBlocks(route,{storage:{orders:{query:async()=>{throw Error('offline');}}}});
 assert.ok(JSON.stringify(unavailable).includes('Orders unavailable'));
});
function packFixture(ticketIds) {
 const order = {
  orderId: 'order:hat', receiptId: 'receipt:hat', attemptId: 'hat',
  lines: [{ catalogItemId: 'hat', name: 'Hat', quantity: 3, unitPrice: { currency: 'USD', minor: '100' } }],
  total: { currency: 'USD', minor: '300' }, ticketIds,
 };
 const state = { writes: 0 };
 const storage = { orders: {
  query: async () => ({ items: [{ id: order.orderId, data: { paidOrder: { schema: 'dinkuskit.commerce.paid-order/v1', ...order } } }], hasMore: false }),
  get() { throw new Error('must not read for a write'); },
  put() { state.writes += 1; throw new Error('must not write'); },
  compareAndSet() { state.writes += 1; throw new Error('must not write'); },
 }};
 const pack = { ...route, input: { type: 'block_action', action_id: 'orders.pack:' + encodeURIComponent(order.orderId) } };
 return { order, state, storage, pack };
}
test('Pack without a connected Inventory fails closed and writes nothing', async () => {
 const f = packFixture(['hat-ticket']);
 const text = JSON.stringify(await ordersBlocks(f.pack, { storage: f.storage }));
 assert.match(text, /Not packed/);
 assert.match(text, /not connected/);
 assert.match(text, /Not recorded/);
 assert.equal(f.state.writes, 0);
});
test('Pack sends the exact ticket command to Inventory and reports its answer without writing', async () => {
 const f = packFixture(['hat-ticket', 'shirt-ticket']);
 const sent = [];
 const packed = await ordersBlocks(f.pack, { storage: f.storage }, { pack: { pack: async body => { sent.push(body); return 'packed'; } } });
 assert.equal(sent.length, 1);
 assert.equal(sent[0].type, 'stock.pack_all');
 assert.deepEqual(sent[0].reservationIds, ['hat-ticket', 'shirt-ticket']);
 assert.equal(JSON.stringify(sent[0]).includes('order:hat'), false);
 const text = JSON.stringify(packed);
 assert.match(text, /Packed in Inventory/);
 assert.match(text, /No label was bought/);
 assert.match(text, /Not recorded/);
 const refused = JSON.stringify(await ordersBlocks(f.pack, { storage: f.storage }, { pack: { pack: async () => 'not_packed' } }));
 assert.match(refused, /Not packed/);
 assert.match(refused, /did not confirm/);
 assert.equal(f.state.writes, 0);
 assert.equal(JSON.stringify(f.order).includes('packed'), false);
});
test('Pack on an order without ticket ids is unavailable, not a fabricated command', async () => {
 const f = packFixture(undefined);
 let called = 0;
 const text = JSON.stringify(await ordersBlocks(f.pack, { storage: f.storage }, { pack: { pack: async () => { called += 1; return 'packed'; } } }));
 assert.match(text, /Orders unavailable/);
 assert.equal(called, 0);
});

test('the Checkout to Orders handoff keeps the first copy and reports repeats and conflicts', async () => {
 const { createPaidOrderReceiver } = await import('../../../dist/features/orders/index.js');
 const records = new Map();
 const collection = { get: async id => records.get(id) ?? null,
  compareAndSet: async (id, version, value) => { if (version !== null || records.has(id)) return { applied: false }; records.set(id, structuredClone(value)); return { applied: true }; } };
 const receiver = createPaidOrderReceiver(collection);
 const order = { schema: 'dinkuskit.commerce.paid-order/v1', orderId: 'order:a', receiptId: 'receipt:a', attemptId: 'a',
  lines: [{ catalogItemId: 'hat', quantity: 1, name: 'Hat', unitPrice: { currency: 'USD', minor: '100' } }], total: { currency: 'USD', minor: '100' } };
 assert.equal(await receiver.receive(order), 'stored');
 // Same contents with keys in another order is the same order.
 const reordered = { total: order.total, lines: order.lines, attemptId: 'a', receiptId: 'receipt:a', orderId: 'order:a', schema: order.schema };
 assert.equal(await receiver.receive(reordered), 'duplicate');
 assert.equal(await receiver.receive({ ...order, total: { currency: 'USD', minor: '1' } }), 'conflict');
 assert.equal(records.get('order:a').paidOrder.total.minor, '100');
 const usd = minor => ({ currency: 'USD', minor });
 const pricing = { merchandiseSubtotal: usd('100'), couponDiscount: usd('0'), netMerchandise: usd('100'),
  shipping: { charge: usd('0') }, finalTotal: usd('100') };
 const fresh = { ...order, orderId: 'order:b', pricing, ticketIds: ['t1'], paymentId: 'p1', paidAt: '2026-10-10T00:00:00.000Z' };
 for (const bad of [{ ...order, schema: 'other' }, { ...order, orderId: '' }, { ...order, lines: null }, null,
  { ...fresh, lines: [] }, { ...fresh, total: { minor: '100' } }, { ...fresh, total: usd('1.00') },
  { ...fresh, lines: [{ ...order.lines[0], quantity: 0 }] }, { ...fresh, lines: [{ ...order.lines[0], unitPrice: { currency: 'EUR', minor: '1' } }] },
  { ...fresh, lines: [{ ...order.lines[0], name: 7 }] }, { ...fresh, pricing: { ...pricing, shipping: {} } },
  { ...fresh, pricing: { ...pricing, coupon: { code: '' } } }, { ...fresh, ticketIds: [''] }, { ...fresh, paidAt: 5 },
  { ...fresh, contactSnapshot: 'x' }, { ...fresh, contactSnapshot: {} }, { ...fresh, contactSnapshot: { contact: {} } },
  { ...fresh, contactSnapshot: { contact: { email: 'a@example.test', delivery: { name: 'A', line1: '1 Main St', city: 'X', postalCode: '1' } } } }])
  await assert.rejects(receiver.receive(bad), /Invalid paid order/);
 assert.equal(records.size, 1);
 assert.equal(await receiver.receive(fresh), 'stored');
});
