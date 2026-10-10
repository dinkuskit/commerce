import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBlocks } from '@emdash-cms/blocks/server';
import { completeOrder, correctDelivery, createPaidOrderReceiver, listOrders, ordersBlocks, reopenOrder } from '../../../dist/features/orders/index.js';

// In-memory storage with revisions, enough for compare-and-set.
function collection() {
  const rows = new Map(); let n = 0;
  return { rows,
    async get(id) { return rows.get(id)?.value ?? null; },
    async getVersioned(id) { return rows.get(id) ? structuredClone(rows.get(id)) : null; },
    async compareAndSet(id, expected, value) {
      if ((rows.get(id)?.revision ?? null) !== expected) return { applied: false };
      rows.set(id, { value: structuredClone(value), revision: 'r' + ++n }); return { applied: true, revision: 'r' + n };
    },
    async query() { return { items: [...rows].map(([id, row]) => ({ id, data: structuredClone(row.value) })), hasMore: false }; },
  };
}
const usd = minor => ({ currency: 'USD', minor });
const delivery = { name: 'Fixture Shopper', line1: '1 Example Way', city: 'Testville', postalCode: '00000', country: 'US' };
const order = (id, withAddress = true) => ({ schema: 'dinkuskit.commerce.paid-order/v1', orderId: id, receiptId: 'r-' + id, attemptId: 'a-' + id, paidAt: '2026-10-10T01:00:00Z',
  lines: [{ catalogItemId: 'hat', quantity: 1, name: 'Hat', unitPrice: usd('100') }], total: usd('100'),
  ...(withAddress ? { contactSnapshot: { schema: 'dinkuskit.commerce.checkout-contact/v1', requirePhoneNumber: false, revision: null, contact: { email: 'shopper@example.com', delivery } } } : {}) });
const route = input => ({ user: { role: 50 }, ui: { surface: 'admin-page' }, input });
const services = { shippingCountries: async () => ['US'] };
async function kept(id = 'o1', withAddress = true) {
  const orders = collection(), numbers = collection();
  await createPaidOrderReceiver(orders, numbers).receive(order(id, withAddress));
  return { orders, ctx: { storage: { orders, order_numbers: numbers } } };
}
const AT = '2026-10-10T18:00:00.000Z';

test('completing by hand records the time, an optional carrier and tracking number, and raises the version', async () => {
  const { orders } = await kept();
  assert.equal(await completeOrder(orders, 'o1', 1, { carrier: ' USPS ', tracking: 'SYNTHETIC TRACKING 0001' }, AT), 'saved');
  const [record] = await listOrders(orders);
  assert.deepEqual(record.completed, { at: AT, carrier: 'USPS', tracking: 'SYNTHETIC TRACKING 0001' });
  assert.equal(record.revision, 2);
  // Blank carrier and tracking are left out, not stored empty.
  const other = await kept('o2');
  assert.equal(await completeOrder(other.orders, 'o2', 1, { carrier: '', tracking: '   ' }, AT), 'saved');
  assert.deepEqual((await listOrders(other.orders))[0].completed, { at: AT });
});

test('an unusable carrier or tracking number, a stale version and an already Completed order change nothing', async () => {
  const { orders } = await kept();
  for (const values of [{ carrier: 'x'.repeat(65) }, { tracking: 'line\nbreak' }, { carrier: 7 }]) {
    assert.equal(await completeOrder(orders, 'o1', 1, values, AT), 'invalid');
  }
  assert.equal(await completeOrder(orders, 'o1', 2, {}, AT), 'outdated');
  assert.equal((await listOrders(orders))[0].revision, 1);
  assert.equal(await completeOrder(orders, 'o1', 1, {}, AT), 'saved');
  assert.equal(await completeOrder(orders, 'o1', 2, {}, AT), 'outdated');
  assert.equal((await listOrders(orders))[0].revision, 2);
});

test('moving back to Processing clears the completion and raises the version; a Processing order is not moved', async () => {
  const { orders } = await kept();
  assert.equal(await reopenOrder(orders, 'o1', 1), 'outdated');
  await completeOrder(orders, 'o1', 1, { carrier: 'USPS', tracking: 'T1' }, AT);
  assert.equal(await reopenOrder(orders, 'o1', 1), 'outdated');
  assert.equal(await reopenOrder(orders, 'o1', 2), 'saved');
  const [record] = await listOrders(orders);
  assert.equal(record.completed, undefined);
  assert.equal(record.revision, 3);
});

test('a Completed order\'s address is locked until it is moved back to Processing', async () => {
  const { orders } = await kept();
  await completeOrder(orders, 'o1', 1, {}, AT);
  const moved = { ...delivery, line1: '2 Fixed Road' };
  assert.equal(await correctDelivery(orders, 'o1', 2, moved, ['US']), 'outdated');
  assert.equal((await listOrders(orders))[0].delivery, undefined);
  await reopenOrder(orders, 'o1', 2);
  assert.equal(await correctDelivery(orders, 'o1', 3, moved, ['US']), 'saved');
  assert.equal((await listOrders(orders))[0].delivery.line1, '2 Fixed Road');
});

test('a malformed completion fails the order list closed', async () => {
  for (const completed of [{}, { at: '' }, { at: AT, carrier: '' }, { at: AT, tracking: 'x'.repeat(65) }, 'yes']) {
    const { orders } = await kept();
    const row = orders.rows.get('o1');
    row.value.completed = completed;
    await assert.rejects(listOrders(orders), /Invalid order/);
  }
});

test('the owner completes an order from its page and moves it back to Processing', async () => {
  const { orders, ctx } = await kept();
  const list = JSON.stringify(await ordersBlocks(route({ type: 'page_load', page: '/orders' }), ctx, services));
  assert.match(list, /"Status","Processing"|Status.{0,20}Processing/);
  const detail = await ordersBlocks(route({ type: 'block_action', action_id: 'orders.open:o1' }), ctx, services);
  const buttons = detail.blocks.filter(b => b.type === 'actions').flatMap(b => b.elements.map(e => e.action_id));
  assert.ok(buttons.includes('orders.finish:o1') && buttons.includes('orders.address:o1'));
  assert.match(JSON.stringify(detail), /Status:\\nProcessing|Status:.{0,4}Processing/);

  const form = await ordersBlocks(route({ type: 'block_action', action_id: 'orders.finish:o1' }), ctx, services);
  assert.equal(validateBlocks(form.blocks).valid, true);
  const submit = form.blocks.find(b => b.type === 'form').submit.action_id;
  assert.equal(submit, 'orders.complete:1:o1');
  // An unusable tracking number keeps the form, with what the owner typed.
  const refused = await ordersBlocks(route({ type: 'form_submit', action_id: submit, values: { carrier: 'USPS', tracking: 'x'.repeat(65) } }), ctx, services);
  assert.match(JSON.stringify(refused), /Order not completed/);
  assert.equal(refused.blocks.find(b => b.type === 'form').fields.find(f => f.action_id === 'carrier').initial_value, 'USPS');

  const done = await ordersBlocks(route({ type: 'form_submit', action_id: submit, values: { carrier: 'USPS', tracking: 'T123' } }), ctx, services);
  assert.equal(validateBlocks(done.blocks).valid, true);
  const text = JSON.stringify(done);
  assert.match(text, /Order completed/);
  assert.match(text, /Status:\\nCompleted/);
  assert.match(text, /Carrier:\\nUSPS/);
  assert.match(text, /Tracking number:\\nT123/);
  // Completed: no Complete order, no Correct address; Move back asks first.
  const actions = done.blocks.filter(b => b.type === 'actions').flatMap(b => b.elements);
  assert.ok(!actions.some(e => e.action_id === 'orders.finish:o1' || e.action_id === 'orders.address:o1'));
  const reopen = actions.find(e => e.label === 'Move back to Processing');
  assert.equal(reopen.action_id, 'orders.reopen:2:o1');
  assert.ok(reopen.confirm);
  // A stale address form or submit on a Completed order changes nothing.
  const noForm = await ordersBlocks(route({ type: 'block_action', action_id: 'orders.address:o1' }), ctx, services);
  assert.equal(noForm.blocks.some(b => b.type === 'form'), false);
  assert.match(JSON.stringify(await ordersBlocks(route({ type: 'form_submit', action_id: 'orders.save:2:o1', values: delivery }), ctx, services)), /Address not saved/);
  assert.match(JSON.stringify(await ordersBlocks(route({ type: 'form_submit', action_id: submit, values: {} }), ctx, services)), /Order not completed/);
  assert.equal((await listOrders(orders))[0].revision, 2);

  const back = JSON.stringify(await ordersBlocks(route({ type: 'block_action', action_id: reopen.action_id }), ctx, services));
  assert.match(back, /Moved back to Processing/);
  assert.match(back, /Status:\\nProcessing/);
  assert.match(JSON.stringify(await ordersBlocks(route({ type: 'block_action', action_id: reopen.action_id }), ctx, services)), /Order not changed/);
  assert.equal((await listOrders(orders))[0].revision, 3);
});

test('status changes come only as the expected interaction type', async () => {
  const { orders, ctx } = await kept();
  for (const input of [{ type: 'block_action', action_id: 'orders.complete:1:o1' }, { type: 'form_submit', action_id: 'orders.reopen:1:o1', values: {} },
    { type: 'form_submit', action_id: 'orders.complete:0:o1', values: {} }]) {
    assert.match(JSON.stringify(await ordersBlocks(route(input), ctx, services)), /Orders unavailable/);
  }
  assert.equal((await listOrders(orders))[0].completed, undefined);
});

test('a digital-only order can still be completed by hand', async () => {
  const { orders, ctx } = await kept('d1', false);
  const detail = JSON.stringify(await ordersBlocks(route({ type: 'block_action', action_id: 'orders.open:d1' }), ctx, services));
  assert.ok(detail.includes('orders.finish:d1') && !detail.includes('orders.address:'));
  assert.match(JSON.stringify(await ordersBlocks(route({ type: 'form_submit', action_id: 'orders.complete:1:d1', values: {} }), ctx, services)), /Order completed/);
  assert.ok((await listOrders(orders))[0].completed);
});
