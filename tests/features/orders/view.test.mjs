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
test('only live orders drop the TEST mark, in the list and the detail', () => {
 const numbered = (order, number) => ({ paidOrder: order, number });
 const orders = [numbered({ ...paid, mode: 'live' }, 1001), numbered({ ...paid, orderId: 'order:test', mode: 'test' }, 1002), numbered({ ...zero }, 1003)];
 const list = ordersView({ status: 'available', orders });
 assert.equal(validateBlocks(list.blocks).valid, true);
 const labels = list.blocks.filter(b => b.type === 'fields').map(b => b.fields[0].value);
 assert.deepEqual(labels, ['#1001', '#1002 (TEST)', '#1003 (TEST)']);
 assert.deepEqual(list.blocks.filter(b => b.type === 'actions').map(b => b.elements[0].label), ['Inspect #1001', 'Inspect #1002 (TEST)', 'Inspect #1003 (TEST)']);
 assert.match(JSON.stringify(ordersView({ status: 'available', orders }, 'order:test')), /Order:\\n#1002 \(TEST\)/);
 assert.doesNotMatch(JSON.stringify(ordersView({ status: 'available', orders }, paid.orderId)), /TEST/);
});
test('a Processing order with an address links to Ship\'s label page when the store has Ship', () => {
 const delivery = { name: 'Fixture Shopper', line1: '1 Example Way', city: 'Testville', region: 'NC', postalCode: '28906', country: 'US' };
 const page = 'https://ship.example.test/stores/site/orders/' + encodeURIComponent(paid.orderId);
 const shipping = { paidOrder: paid, delivery };
 const elements = (record, labelPage) => ordersView({ status: 'available', orders: [record] }, paid.orderId, labelPage).blocks
   .find(b => b.type === 'actions' && b.elements.some(e => e.action_id?.startsWith('orders.finish:') || e.action_id?.startsWith('orders.reopen:'))).elements;
 const detail = ordersView({ status: 'available', orders: [shipping] }, paid.orderId, page);
 assert.equal(validateBlocks(detail.blocks).valid, true);
 assert.deepEqual(elements(shipping, page).map(e => e.label), ['Create shipping label', 'Complete order', 'Correct address']);
 assert.deepEqual(elements(shipping, page)[0], { type: 'link', label: 'Create shipping label', target: { kind: 'external', url: page }, appearance: 'primary' });
 // No Ship service, no address to ship to, or a Completed order: no link.
 assert.deepEqual(elements(shipping).map(e => e.label), ['Complete order', 'Correct address']);
 assert.deepEqual(elements(kept(paid), page).map(e => e.label), ['Complete order']);
 assert.deepEqual(elements({ ...shipping, completed: { at: '2026-10-10T20:00:00.000Z' } }, page).map(e => e.label), ['Move back to Processing']);
 // The list never links.
 assert.doesNotMatch(JSON.stringify(ordersView({ status: 'available', orders: [shipping] }, undefined, page)), /Create shipping label/);
});
test('the detail shows the customer and both addresses; billing reads Same when it matches', () => {
 const delivery = { name: 'Fixture Shopper', line1: '1 Example Way', city: 'Testville', region: 'NY', postalCode: '10001', country: 'US' };
 const contact = (extra) => ({ ...paid, contactSnapshot: { schema: 'dinkuskit.commerce.checkout-contact/v1', requirePhoneNumber: false, revision: null,
   contact: { email: 'shopper@example.test', delivery, ...extra } } });
 const text = (order, record = {}) => {
   const detail = ordersView({ status: 'available', orders: [{ ...record, paidOrder: order }] }, order.orderId);
   assert.equal(validateBlocks(detail.blocks).valid, true);
   return detail.blocks.find(block => block.type === 'section' && block.text.startsWith('Order:')).text;
 };
 const same = text(contact({ phone: '555 0101', billing: { ...delivery } }));
 assert.match(same, /\nEmail:\nshopper@example\.test\nPhone:\n555 0101\nShip to:\nFixture Shopper, 1 Example Way, Testville, NY, 10001, US\nBill to:\nSame as delivery address$/);
 const elsewhere = { name: 'Bill Payer', line1: '9 Billing Way', city: 'Toronto', region: 'ON', postalCode: 'M5V 1A1', country: 'CA' };
 assert.match(text(contact({ billing: elsewhere })), /\nPhone:\nNot recorded\n.*\nBill to:\nBill Payer, 9 Billing Way, Toronto, ON, M5V 1A1, CA$/s);
 // Once the owner corrects delivery, a billing copy of the old address is shown in full.
 assert.match(text(contact({ billing: { ...delivery } }), { delivery: { ...delivery, line1: '2 Corrected Road' } }), /\(corrected\)\nBill to:\nFixture Shopper, 1 Example Way, /);
 // Orders paid before billing was recorded.
 assert.match(text(contact({})), /\nBill to:\nNot recorded$/);
});
