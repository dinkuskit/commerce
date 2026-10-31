import test from 'node:test';
import assert from 'node:assert/strict';
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { createSettingsAccess } from 'emdash';
import { OptionsRepository } from 'emdash/internal/plugins/host';
import { ORDERS_API_ROUTE, completeOrder, correctDelivery, createPaidOrderReceiver, ordersApi } from '../../../dist/features/orders/index.js';
import { saveMerchantStoreSettings } from '../../../dist/features/store-settings/index.js';

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
const order = (id, extra = {}) => ({ schema: 'dinkuskit.commerce.paid-order/v1', orderId: id, receiptId: 'r-' + id, attemptId: 'a-' + id, paidAt: '2026-10-10T01:00:00Z',
  lines: [{ catalogItemId: 'hat', quantity: 1, name: 'Hat', unitPrice: usd('100') }], total: usd('100'),
  contactSnapshot: { schema: 'dinkuskit.commerce.checkout-contact/v1', requirePhoneNumber: false, revision: null, contact: { email: 'shopper@example.com', delivery } }, ...extra });
// Real plugin settings, so address checks read the store's shipping countries as the Orders page does.
function settings() {
  const sqlite = new BetterSqlite3(':memory:');
  sqlite.exec('CREATE TABLE options (name TEXT PRIMARY KEY, value TEXT NOT NULL, revision TEXT NOT NULL)');
  return createSettingsAccess(new OptionsRepository(new Kysely({ dialect: new SqliteDialect({ database: sqlite }) })), 'dinkus-commerce', {});
}
async function store(...orders) {
  const kept = collection(), numbers = collection(), shop = settings();
  const receiver = createPaidOrderReceiver(kept, numbers);
  for (const paid of orders) await receiver.receive(paid);
  return { kept, shop, call: (input, role = 50) => ordersApi({ user: { id: 'agent', role }, input }, { storage: { orders: kept, order_numbers: numbers }, settings: shop }) };
}

test('only Editors and Administrators reach the orders route, which keeps its route id', async () => {
  assert.equal(ORDERS_API_ROUTE, 'orders');
  const { call } = await store(order('o1'));
  for (const role of [30, 20, null, '50']) await assert.rejects(call({ action: 'list' }, role), /Orders require an Editor or Administrator/);
  await assert.rejects(ordersApi({ input: { action: 'list' } }, { storage: {} }), /Orders require an Editor or Administrator/);
  // Staff work orders too (commerce-orders-staff-access-001).
  assert.equal((await call({ action: 'list' }, 40)).total, 1);
});

test('show returns the order as agents see it, with its number, version, status and test mark', async () => {
  const live = order('o2', { mode: 'live', paymentId: 'pay-1', variantSelections: [{ schema: 'dinkuskit.commerce.variant-selection/v1', productId: 'shirt', catalogItemId: 'hat', selections: [], fulfillment: 'physical' }] });
  const { call, kept } = await store(order('o1'), live, order('o3', { mode: 'test' }));
  const shown = (await call({ action: 'show', orderId: 'o2' })).order;
  assert.deepEqual(shown, { orderId: 'o2', number: 1002, version: 1, status: 'processing', test: false, paidAt: '2026-10-10T01:00:00Z',
    total: usd('100'), lines: live.lines, choices: live.variantSelections, shipTo: delivery, email: 'shopper@example.com', phone: null, completed: null,
    // Orders paid before billing was recorded carry none.
    billTo: null, billToMatchesShipTo: false });
  assert.equal((await call({ action: 'show', orderId: 'o1' })).order.test, true);
  assert.equal((await call({ action: 'show', orderId: 'o3' })).order.test, true);
  assert.deepEqual(await call({ action: 'show', orderId: 'missing' }), { order: null });
  // The owner's corrected address is where the order goes now.
  assert.equal(await correctDelivery(kept, 'o1', 1, { ...delivery, line1: '2 Corrected Road' }, ['US']), 'saved');
  const corrected = (await call({ action: 'show', orderId: 'o1' })).order;
  assert.equal(corrected.shipTo.line1, '2 Corrected Road');
  assert.equal(corrected.version, 2);
});

test('agents get the billing copy and whether it matches where the order goes now', async () => {
  const contact = billing => ({ contactSnapshot: { schema: 'dinkuskit.commerce.checkout-contact/v1', requirePhoneNumber: false, revision: null,
    contact: { email: 'shopper@example.com', delivery, billing } } });
  const elsewhere = { name: 'Bill Payer', line1: '9 Billing Way', city: 'Toronto', region: 'ON', postalCode: 'M5V 1A1', country: 'CA' };
  const { call, kept } = await store(order('same', contact({ ...delivery })), order('other', contact(elsewhere)));
  const same = (await call({ action: 'show', orderId: 'same' })).order;
  assert.deepEqual([same.billTo, same.billToMatchesShipTo], [delivery, true]);
  const other = (await call({ action: 'show', orderId: 'other' })).order;
  assert.deepEqual([other.billTo, other.billToMatchesShipTo], [elsewhere, false]);
  // Correcting the delivery address never changes billing, so the two no longer match.
  assert.equal(await correctDelivery(kept, 'same', 1, { ...delivery, line1: '2 Corrected Road' }, ['US']), 'saved');
  const corrected = (await call({ action: 'show', orderId: 'same' })).order;
  assert.deepEqual([corrected.billTo, corrected.billToMatchesShipTo], [delivery, false]);
});

test('list pages by order number, 50 at a time, and filters by status', async () => {
  const many = Array.from({ length: 53 }, (_, i) => order('o' + String(i).padStart(2, '0')));
  const { call, kept } = await store(...many);
  const first = await call({ action: 'list' });
  assert.equal(first.orders.length, 50);
  assert.equal(first.total, 53);
  assert.equal(first.next, 50);
  assert.deepEqual(first.orders.slice(0, 3).map(o => o.number), [1001, 1002, 1003]);
  const last = await call({ action: 'list', offset: 50 });
  assert.deepEqual(last.orders.map(o => o.number), [1051, 1052, 1053]);
  assert.equal(Object.hasOwn(last, 'next'), false);
  assert.deepEqual(await call({ action: 'list', offset: 60 }), { orders: [], total: 53 });
  assert.equal(await completeOrder(kept, 'o07', 1, {}, '2026-10-10T18:00:00.000Z'), 'saved');
  const done = await call({ action: 'list', status: 'completed' });
  assert.deepEqual(done.orders.map(o => [o.orderId, o.status, o.version]), [['o07', 'completed', 2]]);
  assert.equal((await call({ action: 'list', status: 'processing' })).total, 52);
});

test('complete and reopen follow the Orders page rules and report the order as it now stands', async () => {
  const { call } = await store(order('o1'));
  const saved = await call({ action: 'complete', orderId: 'o1', version: 1, carrier: 'USPS', tracking: '9400 SYNTHETIC' });
  assert.equal(saved.result, 'saved');
  assert.equal(saved.order.status, 'completed');
  assert.equal(saved.order.version, 2);
  assert.equal(saved.order.completed.carrier, 'USPS');
  assert.equal(saved.order.completed.tracking, '9400 SYNTHETIC');
  // A stale version, an already Completed order and a bad carrier change nothing.
  assert.equal((await call({ action: 'complete', orderId: 'o1', version: 1 })).result, 'outdated');
  assert.equal((await call({ action: 'complete', orderId: 'o1', version: 2 })).result, 'outdated');
  assert.equal((await call({ action: 'reopen', orderId: 'o1', version: 1 })).result, 'outdated');
  const reopened = await call({ action: 'reopen', orderId: 'o1', version: 2 });
  assert.equal(reopened.result, 'saved');
  assert.deepEqual([reopened.order.status, reopened.order.version, reopened.order.completed], ['processing', 3, null]);
  assert.equal((await call({ action: 'reopen', orderId: 'o1', version: 3 })).result, 'outdated');
  const refused = await call({ action: 'complete', orderId: 'o1', version: 3, carrier: 'x'.repeat(65) });
  assert.deepEqual([refused.result, refused.order.status, refused.order.version], ['invalid', 'processing', 3]);
  assert.deepEqual(await call({ action: 'complete', orderId: 'missing', version: 1 }), { result: 'not_found' });
});

test('address corrects where a Processing order goes, only to a country the store ships to', async () => {
  const { call, shop } = await store(order('o1'));
  await saveMerchantStoreSettings(shop, { expectedRevision: null, storeCountry: 'US', shippingCountries: ['US', 'CA'] });
  const corrected = { name: 'Fixture Shopper', line1: '2 Corrected Road', line2: 'Unit 4', city: 'Testville', region: 'TN', postalCode: '00001', country: 'us' };
  const saved = await call({ action: 'address', orderId: 'o1', version: 1, address: corrected });
  assert.equal(saved.result, 'saved');
  assert.deepEqual([saved.order.shipTo, saved.order.version, saved.order.status], [{ ...corrected, country: 'US' }, 2, 'processing']);
  // A stale version, a country the store does not ship to and a bad address change nothing.
  assert.equal((await call({ action: 'address', orderId: 'o1', version: 1, address: delivery })).result, 'outdated');
  for (const address of [{ ...delivery, country: 'GB' }, { ...delivery, line1: '' }, { ...delivery, city: 'x'.repeat(201) }, { ...delivery, phone: '1' }, 'US', null]) {
    const refused = await call({ action: 'address', orderId: 'o1', version: 2, address });
    assert.deepEqual([refused.result, refused.order.shipTo.line1, refused.order.version], ['invalid', '2 Corrected Road', 2], JSON.stringify(address));
  }
  // Canada is on the list; optional lines may be left out.
  const canada = { name: 'Fixture Shopper', line1: '9 Maple Street', city: 'Toronto', postalCode: 'M5V 1A1', country: 'CA' };
  assert.deepEqual((await call({ action: 'address', orderId: 'o1', version: 2, address: canada })).order.shipTo, canada);
  // A Completed order's address is locked: move it back to Processing first.
  assert.equal((await call({ action: 'complete', orderId: 'o1', version: 3 })).result, 'saved');
  const locked = await call({ action: 'address', orderId: 'o1', version: 4, address: delivery });
  assert.deepEqual([locked.result, locked.order.shipTo, locked.order.version], ['outdated', canada, 4]);
  assert.deepEqual(await call({ action: 'address', orderId: 'missing', version: 1, address: delivery }), { result: 'not_found' });
});

test('malformed requests are refused before anything changes', async () => {
  const { call, kept } = await store(order('o1'));
  const before = JSON.stringify([...kept.rows]);
  for (const input of [null, [], 'list', {}, { action: 'delete', orderId: 'o1' }, { action: 'list', status: 'shipped' }, { action: 'list', offset: -1 },
    { action: 'list', offset: 1.5 }, { action: 'list', offset: '50' }, { action: 'list', limit: 10 }, { action: 'show' }, { action: 'show', orderId: '' },
    { action: 'show', orderId: 'x'.repeat(1025) }, { action: 'show', orderId: 'o1', version: 1 }, { action: 'complete', orderId: 'o1' },
    { action: 'complete', orderId: 'o1', version: 0 }, { action: 'complete', orderId: 'o1', version: '1' },
    // A misspelt field is refused rather than ignored, so tracking is never silently dropped.
    { action: 'complete', orderId: 'o1', version: 1, trackingNumber: 'T1' }, { action: 'reopen', orderId: 'o1', version: 1, carrier: 'USPS' },
    { action: 'address', orderId: 'o1', address: delivery }, { action: 'address', orderId: 'o1', version: 1, shipTo: delivery },
    { action: 'address', orderId: 'o1', version: 1, address: delivery, carrier: 'USPS' }]) {
    await assert.rejects(call(input), /Invalid orders request/, JSON.stringify(input));
  }
  assert.equal(JSON.stringify([...kept.rows]), before);
});
