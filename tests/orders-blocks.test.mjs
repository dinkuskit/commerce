import test from 'node:test';
import assert from 'node:assert/strict';
import { ordersBlocks } from '../dist/admin/orders-blocks.js';
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
 const empty=await ordersBlocks(route,{storage:{checkout_carts:{query:async()=>({items:[],hasMore:false})}}});
 assert.ok(JSON.stringify(empty).includes('No orders recorded yet.'));
 const unavailable=await ordersBlocks(route,{storage:{checkout_carts:{query:async()=>{throw Error('offline');}}}});
 assert.ok(JSON.stringify(unavailable).includes('Orders unavailable'));
});
test('Pack builds the ticket command and does not record the order packed', async () => {
 const order = {
  orderId: 'order:hat', receiptId: 'receipt:hat', attemptId: 'hat',
  lines: [{ catalogItemId: 'hat', name: 'Hat', quantity: 3, unitPrice: { currency: 'USD', minor: '100' } }],
  total: { currency: 'USD', minor: '300' }, ticketIds: ['hat-ticket'],
 };
 let writes = 0;
 const storage = { checkout_carts: {
  query: async () => ({ items: [{ id: 'cart', data: { attempts: [{ attemptId: 'hat', phase: 'paid', order }] } }], hasMore: false }),
  put() { writes += 1; throw new Error('must not write'); },
  compareAndSet() { writes += 1; throw new Error('must not write'); },
 }};
 const packed = await ordersBlocks({ ...route, input: { type: 'block_action', action_id: 'orders.pack:' + encodeURIComponent(order.orderId) } }, { storage });
 const text = JSON.stringify(packed);
 assert.match(text, /Not packed/);
 assert.match(text, /stock\.pack/);
 assert.equal(text.includes('stock.pack_all'), false);
 assert.match(text, /Not recorded/);
 assert.equal(writes, 0);
 assert.equal(JSON.stringify(order).includes('packed'), false);
});
