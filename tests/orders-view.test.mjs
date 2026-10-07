import test from 'node:test';
import assert from 'node:assert/strict';
import { ordersView } from '../dist/admin/orders-view.js';
import { validateBlocks } from '@emdash-cms/blocks/server';
import { paid, zero } from '../tools/orders-preview/fixtures.mjs';
const input = { status: 'available', orders: [paid, zero] };
const fields = view => Object.fromEntries(view.blocks.filter(b => b.type === 'fields').flatMap(b => b.fields).map(f => [f.label, f.value]));
test('inspection preserves canonical IDs, recorded amounts and independent fulfillment', () => {
 const list = ordersView(input); assert.equal(validateBlocks(list.blocks).valid, true);
 assert.equal(list.blocks.filter(b => b.type === 'actions').length, 2);
 const detail = ordersView(input, paid.orderId); const f = fields(detail);
 assert.equal(f.Order, 'synthetic-order-paid-001'); assert.equal(f.Receipt, 'synthetic-receipt-paid-001');
 assert.equal(f.Payment, 'Provider-paid'); assert.equal(f.Fulfillment, 'Not recorded');
 assert.equal(f['Item subtotal'], 'USD 25.00'); assert.equal(f['Coupon discount'], 'USD 5.00'); assert.equal(f.Shipping, 'USD 5.00'); assert.equal(f['Order total'], 'USD 25.00');
 assert.equal(detail.blocks[1].elements[0].action_id, 'orders.list');
 assert.equal(fields(ordersView(input, zero.orderId)).Payment, 'Zero payable — no payment required');
});
test('empty, outage, missing order and absent legacy breakdown remain distinct', () => {
 assert.match(JSON.stringify(ordersView({ status: 'available', orders: [] })), /No orders recorded yet/);
 assert.match(JSON.stringify(ordersView({ status: 'unavailable' })), /Orders unavailable/);
 assert.match(JSON.stringify(ordersView(input, 'missing')), /Order unavailable/);
 const legacy = { ...paid, pricing: undefined };
 assert.match(JSON.stringify(ordersView({ status: 'available', orders: [legacy] }, legacy.orderId)), /breakdown not recorded/);
});
test('invalid money fails closed and large valid money keeps every cent', () => {
 const large = { ...paid, total: { currency: 'USD', minor: '9007199254740991' } };
 assert.equal(fields(ordersView({ status: 'available', orders: [large] }, large.orderId))['Order total'], 'USD 90071992547409.91');
 const bad = { ...paid, total: { currency: 'USD', minor: '-1' } };
 assert.match(JSON.stringify(ordersView({ status: 'available', orders: [bad] })), /could not be displayed safely/);
});
