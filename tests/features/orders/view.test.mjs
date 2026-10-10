import test from 'node:test';
import assert from 'node:assert/strict';
import { ordersView } from '../../../dist/features/orders/index.js';
import { validateBlocks } from '@emdash-cms/blocks/server';
import { paid, zero } from '../../../tools/orders-preview/fixtures.mjs';
const kept = paidOrder => ({ paidOrder });
const input = { status: 'available', orders: [kept(paid), kept(zero)] };
const fields = view => Object.fromEntries(view.blocks.filter(b => b.type === 'fields').flatMap(b => b.fields).map(f => [f.label, f.value]));
test('inspection preserves canonical IDs, recorded amounts and independent fulfillment', () => {
 const list = ordersView(input); assert.equal(validateBlocks(list.blocks).valid, true);
 assert.equal(list.blocks.filter(b => b.type === 'actions').length, 2);
 const detail = ordersView(input, paid.orderId); const f = fields(detail);
 const rendered = JSON.stringify(detail);
 for (const value of ['synthetic-order-paid-001','synthetic-receipt-paid-001','Provider-paid','Not recorded']) assert.ok(rendered.includes(value));
 assert.equal(f['Item subtotal'], 'USD 25.00'); assert.equal(f['Coupon discount'], 'USD 5.00'); assert.equal(f.Shipping, 'USD 5.00'); assert.equal(f['Order total'], 'USD 25.00');
 assert.equal(detail.blocks[1].elements[0].action_id, 'orders.list');
 assert.ok(JSON.stringify(ordersView(input, zero.orderId)).includes('Zero payable — no payment required'));
});
test('empty, outage, missing order and absent legacy breakdown remain distinct', () => {
 assert.match(JSON.stringify(ordersView({ status: 'available', orders: [] })), /No orders recorded yet/);
 assert.match(JSON.stringify(ordersView({ status: 'unavailable' })), /Orders unavailable/);
 assert.match(JSON.stringify(ordersView(input, 'missing')), /Order unavailable/);
 const legacy = { ...paid, pricing: undefined };
 assert.match(JSON.stringify(ordersView({ status: 'available', orders: [kept(legacy)] }, legacy.orderId)), /breakdown not recorded/);
});
test('invalid money fails closed and large valid money keeps every cent', () => {
 const large = { ...paid, total: { currency: 'USD', minor: '9007199254740991' } };
 assert.equal(fields(ordersView({ status: 'available', orders: [kept(large)] }, large.orderId))['Order total'], 'USD 90071992547409.91');
 const bad = { ...paid, total: { currency: 'USD', minor: '-1' } };
 assert.match(JSON.stringify(ordersView({ status: 'available', orders: [kept(bad)] })), /could not be displayed safely/);
});
test('Pack is offered only for orders with Inventory ticket ids', () => {
 const ticketed = { ...paid, ticketIds: ['hat-ticket'] };
 const detail = ordersView({ status: 'available', orders: [kept(ticketed)] }, ticketed.orderId);
 assert.equal(validateBlocks(detail.blocks).valid, true);
 const pack = detail.blocks.find(block => block.type === 'actions' && block.elements[0].label === 'Pack');
 assert.equal(pack.elements[0].action_id, 'orders.pack:' + encodeURIComponent(ticketed.orderId));
 assert.match(JSON.stringify(detail), /Not recorded/);
 assert.equal(JSON.stringify(detail).includes('hat-ticket'), false);
 const plain = ordersView(input, paid.orderId);
 assert.equal(plain.blocks.some(block => block.type === 'actions' && block.elements[0].label === 'Pack'), false);
});
