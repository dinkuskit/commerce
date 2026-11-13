import test from 'node:test';
import assert from 'node:assert/strict';
import { ordersView } from '../../../dist/features/orders/index.js';
import { validateBlocks } from '@emdash-cms/blocks/server';
import { paid, zero } from '../../../tools/orders-preview/fixtures.mjs';
const kept = paidOrder => ({ paidOrder });
const input = { status: 'available', orders: [kept(paid), kept(zero)] };
// Every block on the page, including those inside columns and the Order record fold.
const flat = blocks => blocks.flatMap(b => [b, ...flat(b.type === 'columns' ? b.columns.flat() : b.blocks ?? [])]);
const sections = view => flat(view.blocks).filter(b => b.type === 'section').map(b => b.text);
const tables = view => flat(view.blocks).filter(b => b.type === 'table');
const items = view => tables(view)[0].rows;
const payment = view => Object.fromEntries(tables(view)[1].rows.map(row => [row.name, row.value]));
const column = (view, i) => view.blocks.find(b => b.type === 'columns').columns[i].map(b => b.text ?? b.elements.map(e => e.label).join());
// Buttons and links in page order: action rows (columns included) and section accessories.
const controls = view => flat(view.blocks).flatMap(b => b.type === 'actions' ? b.elements : b.accessory ? [b.accessory] : []);
test('inspection preserves canonical IDs, recorded amounts and independent fulfillment', () => {
 const list = ordersView(input); assert.equal(validateBlocks(list.blocks).valid, true);
 assert.equal(list.blocks.filter(b => b.type === 'actions').length, 2);
 const detail = ordersView(input, paid.orderId);
 assert.equal(validateBlocks(detail.blocks).valid, true);
 const record = detail.blocks.find(b => b.type === 'accordion');
 assert.equal(record.label, 'Order record');
 assert.deepEqual(record.blocks.map(b => b.text).slice(0, 5), ['Order ID: synthetic-order-paid-001', 'Version: 1', 'Receipt: synthetic-receipt-paid-001',
   'Checkout attempt: synthetic-attempt-paid-001', 'Provider payment: synthetic-payment-001']);
 assert.deepEqual(payment(detail), { 'Items subtotal': '$25.00', 'Coupon SYNTHETIC5': '−$5.00', Shipping: '$5.00', 'Order total': '$25.00' });
 assert.equal(tables(detail)[1].columns[0].label, 'Paid');
 assert.equal(detail.blocks[1].elements[0].action_id, 'orders.list');
 assert.equal(tables(ordersView(input, zero.orderId))[1].columns[0].label, 'Nothing to pay');
});
test('who and where come first, then what ships, the action that finishes it, and the items', () => {
 const detail = ordersView(input, paid.orderId);
 assert.deepEqual(detail.blocks.slice(2).map(b => b.type), ['header', 'context', 'banner', 'columns', 'divider', 'section', 'table', 'table', 'accordion']);
 assert.equal(detail.blocks[2].text, 'Order synthetic-order-paid-001 (TEST)');
 assert.equal(detail.blocks[3].text, 'Paid · Processing');
 assert.deepEqual(detail.blocks.find(b => b.type === 'columns').columns.map(c => c[0].text), ['Ship to', 'Customer']);
 assert.equal(detail.blocks[7].text, '2 items ready to ship');
 assert.equal(detail.blocks[7].accessory.label, 'Complete order');
 assert.deepEqual(items(detail), [{ item: 'Synthetic sample item', options: '', price: '$12.50', quantity: '× 2', total: '$25.00' }]);
 const single = { ...paid, lines: [{ ...paid.lines[0], quantity: 1 }] };
 assert.equal(ordersView({ status: 'available', orders: [kept(single)] }, paid.orderId).blocks[7].text, '1 item ready to ship');
 const dated = ordersView({ status: 'available', orders: [{ paidOrder: { ...paid, paidAt: '2026-11-12T19:42:00.000Z', mode: 'live' }, number: 1001 }] }, paid.orderId);
 assert.equal(dated.blocks[3].text, 'Paid Nov 12, 2026, 7:42 PM UTC · Processing');
 assert.equal(dated.blocks.some(b => b.type === 'banner'), false);
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
 assert.deepEqual(items(detail).map(row => row.options), ['Size: M · Color: Frozen blue', 'Size: L']);
 assert.deepEqual(order, original);
 assert.deepEqual(payment(detail), { 'Order total': '$2.00' });
 // Catalog IDs stay findable in the Order record fold.
 assert.ok(sections(detail).includes('Fixture shirt: medium') && sections(detail).includes('Fixture shirt: large'));
});
test('legacy, simple and unmatched snapshots never borrow another item\'s choices', () => {
 const render = variantSelections => ordersView({ status: 'available', orders: [kept({ ...paid, variantSelections })] }, paid.orderId);
 const plain = render(undefined);
 const simple = paid.lines.map(line => ({ catalogItemId: line.catalogItemId, selections: [] }));
 assert.deepEqual(render(simple), plain);
 assert.deepEqual(render([{ catalogItemId: 'foreign', selections: [{ optionLabel: 'Size', valueLabel: 'XL' }] }]), plain);
 const long = 'Frozen color '.repeat(15).trim();
 const detail = render([{ catalogItemId: paid.lines[0].catalogItemId, selections: [{ optionLabel: 'Color', valueLabel: long }] }]);
 assert.equal(items(detail)[0].options, 'Color: ' + long);
 assert.equal(validateBlocks(detail.blocks).valid, true);
});
test('empty, outage, missing order and absent legacy breakdown remain distinct', () => {
 assert.match(JSON.stringify(ordersView({ status: 'available', orders: [] })), /No orders recorded yet/);
 assert.match(JSON.stringify(ordersView({ status: 'unavailable' })), /Orders unavailable/);
 assert.match(JSON.stringify(ordersView(input, 'missing')), /Order unavailable/);
 const legacy = { ...paid, pricing: undefined };
 assert.deepEqual(payment(ordersView({ status: 'available', orders: [kept(legacy)] }, legacy.orderId)), { 'Order total': '$25.00' });
});
test('invalid money fails closed and large valid money keeps every cent', () => {
 const large = { ...paid, pricing: undefined, total: { currency: 'USD', minor: '9007199254740991' } };
 assert.equal(payment(ordersView({ status: 'available', orders: [kept(large)] }, large.orderId))['Order total'], '$90,071,992,547,409.91');
 const bad = { ...paid, total: { currency: 'USD', minor: '-1' } };
 assert.match(JSON.stringify(ordersView({ status: 'available', orders: [kept(bad)] })), /could not be displayed safely/);
});
test('Pack is offered only for orders with Inventory ticket ids', () => {
 const ticketed = { ...paid, ticketIds: ['hat-ticket'] };
 const detail = ordersView({ status: 'available', orders: [kept(ticketed)] }, ticketed.orderId);
 assert.equal(validateBlocks(detail.blocks).valid, true);
 const pack = detail.blocks.find(block => block.type === 'actions' && block.elements[0].label === 'Pack');
 assert.equal(pack.elements[0].action_id, 'orders.pack:' + encodeURIComponent(ticketed.orderId));
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
 const test = ordersView({ status: 'available', orders }, 'order:test');
 assert.ok(test.blocks.some(b => b.type === 'header' && b.text === 'Order #1002 (TEST)'));
 assert.ok(test.blocks.some(b => b.type === 'banner' && b.title === 'Test order'));
 assert.doesNotMatch(JSON.stringify(ordersView({ status: 'available', orders }, paid.orderId)), /TEST|Test order/);
});
test('a Processing order with an address links to Ship\'s label page when the store has Ship', () => {
 const delivery = { name: 'Fixture Shopper', line1: '1 Example Way', city: 'Testville', region: 'NC', postalCode: '28906', country: 'US' };
 const page = 'https://ship.example.test/stores/site/orders/' + encodeURIComponent(paid.orderId);
 const shipping = { paidOrder: paid, delivery };
 const elements = (record, labelPage) => controls(ordersView({ status: 'available', orders: [record] }, paid.orderId, labelPage))
   .filter(e => e.label !== 'Back to orders');
 const detail = ordersView({ status: 'available', orders: [shipping] }, paid.orderId, page);
 assert.equal(validateBlocks(detail.blocks).valid, true);
 // Correct address sits under Ship to; the ready-to-ship line carries the main action.
 assert.deepEqual(elements(shipping, page).map(e => e.label), ['Correct address', 'Create shipping label', 'Complete order']);
 assert.deepEqual(elements(shipping, page)[1], { type: 'link', label: 'Create shipping label', target: { kind: 'external', url: page }, appearance: 'primary' });
 // The label link is the main action when it is there; otherwise Complete order is.
 assert.equal(elements(shipping, page)[2].style, undefined);
 assert.equal(elements(shipping)[1].style, 'primary');
 // No Ship service, no address to ship to, or a Completed order: no link.
 assert.deepEqual(elements(shipping).map(e => e.label), ['Correct address', 'Complete order']);
 assert.deepEqual(elements(kept(paid), page).map(e => e.label), ['Complete order']);
 assert.deepEqual(elements({ ...shipping, completed: { at: '2026-10-10T20:00:00.000Z' } }, page).map(e => e.label), ['Move back to Processing']);
 // The list never links.
 assert.doesNotMatch(JSON.stringify(ordersView({ status: 'available', orders: [shipping] }, undefined, page)), /Create shipping label/);
});
test('detail text is wrapping sections and table cells, never newline-delimited or truncating fields', () => {
 const view = ordersView(input, paid.orderId);
 assert.equal(validateBlocks(view.blocks).valid, true);
 assert.ok(sections(view).every(text => !text.includes('\n')));
 assert.equal(flat(view.blocks).some(b => b.type === 'fields'), false);
 // A Completed order shows when, and the carrier and tracking number it shipped with.
 const completed = ordersView({ status: 'available', orders: [{ paidOrder: paid, completed: { at: '2026-10-10T20:00:00.000Z', carrier: 'USPS', tracking: 'SYNTHETIC-TRACKING-1' } }] }, paid.orderId);
 assert.equal(completed.blocks[3].text, 'Paid · Completed');
 const shipped = completed.blocks.find(b => b.type === 'section');
 assert.equal(shipped.text, 'Shipped Oct 10, 2026, 8:00 PM UTC · USPS · SYNTHETIC-TRACKING-1');
 assert.equal(shipped.accessory.label, 'Move back to Processing');
 const bare = ordersView({ status: 'available', orders: [{ paidOrder: paid, completed: { at: '2026-10-10T20:00:00.000Z' } }] }, paid.orderId);
 assert.equal(bare.blocks.find(b => b.type === 'section').text, 'Shipped Oct 10, 2026, 8:00 PM UTC');
});
test('the detail shows the customer and both addresses as parcel lines; billing reads Same when it matches', () => {
 const delivery = { name: 'Fixture Shopper', line1: '1 Example Way', city: 'Testville', region: 'NY', postalCode: '10001', country: 'US' };
 const contact = (extra) => ({ ...paid, contactSnapshot: { schema: 'dinkuskit.commerce.checkout-contact/v1', requirePhoneNumber: false, revision: null,
   contact: { email: 'shopper@example.test', delivery, ...extra } } });
 const view = (order, record = {}) => {
   const detail = ordersView({ status: 'available', orders: [{ ...record, paidOrder: order }] }, order.orderId);
   assert.equal(validateBlocks(detail.blocks).valid, true);
   return detail;
 };
 const same = view(contact({ phone: '555 0101', billing: { ...delivery } }));
 assert.deepEqual(column(same, 0), ['Ship to', 'Fixture Shopper', '1 Example Way', 'Testville, NY 10001', 'US', 'Correct address']);
 assert.deepEqual(column(same, 1), ['Customer', 'shopper@example.test', '555 0101', 'Bill to', 'Same as ship-to']);
 const elsewhere = { name: 'Bill Payer', line1: '9 Billing Way', line2: 'Suite 4', city: 'Toronto', region: 'ON', postalCode: 'M5V 1A1', country: 'CA' };
 const different = view(contact({ billing: elsewhere }));
 assert.deepEqual(column(different, 1), ['Customer', 'shopper@example.test', 'No phone', 'Bill to', 'Bill Payer', '9 Billing Way, Suite 4', 'Toronto, ON M5V 1A1', 'CA']);
 // Once the owner corrects delivery, a billing copy of the old address is shown in full.
 const corrected = view(contact({ billing: { ...delivery } }), { delivery: { ...delivery, line1: '2 Corrected Road' } });
 assert.deepEqual(column(corrected, 0), ['Ship to', 'Fixture Shopper', '2 Corrected Road', 'Testville, NY 10001', 'US', 'Corrected after checkout', 'Correct address']);
 assert.deepEqual(column(corrected, 1).slice(-5), ['Bill to', 'Fixture Shopper', '1 Example Way', 'Testville, NY 10001', 'US']);
 // Orders paid before billing was recorded; digital orders have no ship-to.
 assert.equal(column(view(contact({})), 1).at(-1), 'Not recorded');
 assert.deepEqual(column(view(paid), 0), ['Ship to', 'No ship-to address']);
});
