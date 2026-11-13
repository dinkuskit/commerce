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
test('each item displays its own frozen choices even when snapshots have a different order', () => {
 const line = id => ({ catalogItemId: id, name: 'Fixture shirt', quantity: 1, unitPrice: { currency: 'USD', minor: '100' } });
 const selection = (id, values) => ({ schema: 'dinkuskit.commerce.checkout-variant-selection/v1', productId: 'shirt', catalogItemId: id,
   fulfillment: 'physical', selections: values.map(([optionLabel, valueLabel], i) => ({ optionId: 'option-' + i, valueId: 'value-' + i, optionLabel, valueLabel })) });
 const order = { ...paid, lines: [line('medium'), line('large')], total: { currency: 'USD', minor: '200' }, pricing: undefined,
   variantSelections: [selection('large', [['Size', 'L']]), selection('medium', [['Size', 'M'], ['Color', 'Frozen blue']])] };
 const original = structuredClone(order);
 const detail = ordersView({ status: 'available', orders: [kept(order)] }, order.orderId);
 assert.equal(validateBlocks(detail.blocks).valid, true);
 const items = detail.blocks.filter(block => block.type === 'fields' && block.fields[0].label === 'Item');
 assert.equal(items.length, 2);
 for (const [i, text] of ['Size: M · Color: Frozen blue', 'Size: L'].entries()) {
   assert.deepEqual(detail.blocks[detail.blocks.indexOf(items[i]) + 1], { type: 'section', text });
 }
 assert.deepEqual(order, original);
 assert.equal(fields(detail)['Order total'], 'USD 2.00');
});
test('legacy, simple and unmatched snapshots never borrow another item\'s choices', () => {
 const render = variantSelections => ordersView({ status: 'available', orders: [kept({ ...paid, variantSelections })] }, paid.orderId);
 const plain = render(undefined);
 const simple = paid.lines.map(line => ({ catalogItemId: line.catalogItemId, selections: [] }));
 assert.deepEqual(render(simple), plain);
 assert.deepEqual(render([{ catalogItemId: 'foreign', selections: [{ optionLabel: 'Size', valueLabel: 'XL' }] }]), plain);
 const long = 'Frozen color '.repeat(15).trim();
 const detail = render([{ catalogItemId: paid.lines[0].catalogItemId, selections: [{ optionLabel: 'Color', valueLabel: long }] }]);
 assert.ok(detail.blocks.some(block => block.type === 'section' && block.text === 'Color: ' + long));
 assert.equal(validateBlocks(detail.blocks).valid, true);
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
 assert.ok(ordersView({ status: 'available', orders }, 'order:test').blocks.some(b => b.type === 'section' && b.text === 'Order: #1002 (TEST)'));
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
test('detail facts are separate wrapping sections, not newline-delimited or truncating cells', () => {
 const view = ordersView(input, paid.orderId);
 const rows = view.blocks.filter(block => block.type === 'section').map(block => block.text);
 assert.equal(validateBlocks(view.blocks).valid, true);
 assert.deepEqual(rows.slice(0, 4), ['Order: ' + paid.orderId + ' (TEST)', 'Order ID: ' + paid.orderId, 'Version: 1', 'Receipt: ' + paid.receiptId]);
 assert.ok(rows.includes('Checkout attempt: ' + paid.attemptId));
 assert.ok(rows.includes('Payment: Provider-paid'));
 assert.ok(rows.includes('Provider payment: ' + paid.paymentId));
 assert.ok(rows.includes('Status: Processing'));
 assert.ok(rows.every(text => !text.includes('\n')));
 // Completion facts retain their own rows too; no truncating fields block holds metadata.
 const completed = ordersView({ status: 'available', orders: [{ paidOrder: paid, completed: { at: '2026-10-10T20:00:00.000Z', carrier: 'USPS', tracking: 'SYNTHETIC-TRACKING-1' } }] }, paid.orderId);
 assert.deepEqual(completed.blocks.filter(b => b.type === 'section' && /^(Completed at|Carrier|Tracking number):/.test(b.text)).map(b => b.text),
   ['Completed at: 2026-10-10T20:00:00.000Z', 'Carrier: USPS', 'Tracking number: SYNTHETIC-TRACKING-1']);
 assert.ok(view.blocks.filter(b => b.type === 'fields').flatMap(b => b.fields).every(f => !['Order ID', 'Receipt', 'Ship to', 'Bill to'].includes(f.label)));
});
test('the detail shows the customer and both addresses; billing reads Same when it matches', () => {
 const delivery = { name: 'Fixture Shopper', line1: '1 Example Way', city: 'Testville', region: 'NY', postalCode: '10001', country: 'US' };
 const contact = (extra) => ({ ...paid, contactSnapshot: { schema: 'dinkuskit.commerce.checkout-contact/v1', requirePhoneNumber: false, revision: null,
   contact: { email: 'shopper@example.test', delivery, ...extra } } });
 const rows = (order, record = {}) => {
   const detail = ordersView({ status: 'available', orders: [{ ...record, paidOrder: order }] }, order.orderId);
   assert.equal(validateBlocks(detail.blocks).valid, true);
   return detail.blocks.filter(block => block.type === 'section').map(block => block.text);
 };
 const same = rows(contact({ phone: '555 0101', billing: { ...delivery } }));
 assert.deepEqual(same.slice(-4), ['Email: shopper@example.test', 'Phone: 555 0101',
   'Ship to: Fixture Shopper, 1 Example Way, Testville, NY, 10001, US', 'Bill to: Same as delivery address']);
 const elsewhere = { name: 'Bill Payer', line1: '9 Billing Way', city: 'Toronto', region: 'ON', postalCode: 'M5V 1A1', country: 'CA' };
 const different = rows(contact({ billing: elsewhere }));
 assert.ok(different.includes('Phone: Not recorded'));
 assert.equal(different.at(-1), 'Bill to: Bill Payer, 9 Billing Way, Toronto, ON, M5V 1A1, CA');
 // Once the owner corrects delivery, a billing copy of the old address is shown in full.
 const corrected = rows(contact({ billing: { ...delivery } }), { delivery: { ...delivery, line1: '2 Corrected Road' } });
 assert.equal(corrected.at(-2), 'Ship to: Fixture Shopper, 2 Corrected Road, Testville, NY, 10001, US (corrected)');
 assert.equal(corrected.at(-1), 'Bill to: Fixture Shopper, 1 Example Way, Testville, NY, 10001, US');
 // Orders paid before billing was recorded.
 assert.equal(rows(contact({})).at(-1), 'Bill to: Not recorded');
});
