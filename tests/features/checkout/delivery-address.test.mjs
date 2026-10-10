import assert from 'node:assert/strict';
import test from 'node:test';
import { startCheckout, paidOrderOf } from '../../../dist/features/checkout/index.js';
import { captureCheckoutContact, normalizeCheckoutContactInput } from '../../../dist/features/checkout-contact/index.js';
import { ordersView } from '../../../dist/features/orders/index.js';
import { openStore, fixture, cart, syntheticDelivery } from './fixture.mjs';

const requirements = (shippingCountries = ['US']) => async () => ({ requirePhoneNumber: false, shippingCountries, revision: 'r1' });
const email = 'delivery-fixture@example.test';

function checkout(mark) {
  const opened = openStore(':memory:');
  const f = fixture(opened.store, false);
  if (mark) for (const item of f.execution.catalog.catalog.records.values()) item.fulfillment = mark(item.itemId);
  f.setPayment('paid');
  return { f, close: () => opened.db.close() };
}

test('address input is trimmed, bounded and never takes unknown fields', () => {
  const contact = normalizeCheckoutContactInput({ email, delivery: { ...syntheticDelivery, line2: '  ', region: ' CA ', country: 'us' } });
  assert.deepEqual(contact.delivery, { name: 'Fixture Shopper', line1: '1 Example Way', city: 'Testville', region: 'CA', postalCode: '00000', country: 'US' });
  for (const [delivery, code] of [
    [null, 'DELIVERY_INVALID'],
    [{ ...syntheticDelivery, billing: true }, 'DELIVERY_INVALID'],
    [{ ...syntheticDelivery, line1: ' ' }, 'DELIVERY_REQUIRED'],
    [{ ...syntheticDelivery, postalCode: undefined }, 'DELIVERY_INVALID'],
    [{ ...syntheticDelivery, city: 'a\nb' }, 'DELIVERY_INVALID'],
    [{ ...syntheticDelivery, name: 'x'.repeat(201) }, 'DELIVERY_INVALID'],
    [{ ...syntheticDelivery, country: 'USA' }, 'DELIVERY_INVALID'],
  ]) assert.throws(() => normalizeCheckoutContactInput({ email, delivery }), { code });
});

test('a physical basket needs an address in a shipping country; a digital one keeps none', async () => {
  await assert.rejects(captureCheckoutContact({ email }, requirements(), true), { code: 'DELIVERY_REQUIRED' });
  await assert.rejects(captureCheckoutContact({ email, delivery: { ...syntheticDelivery, country: 'CA' } }, requirements(), true),
    { code: 'DELIVERY_COUNTRY_UNAVAILABLE' });
  await assert.rejects(captureCheckoutContact({ email, delivery: syntheticDelivery }, requirements([]), true),
    { code: 'DELIVERY_COUNTRY_UNAVAILABLE' });
  const physical = await captureCheckoutContact({ email, delivery: syntheticDelivery }, requirements(), true);
  assert.deepEqual(physical.contact, { email, delivery: syntheticDelivery });
  assert.ok(Object.isFrozen(physical.contact.delivery));
  const digital = await captureCheckoutContact({ email, delivery: syntheticDelivery }, requirements(), false);
  assert.deepEqual(digital.contact, { email });
});

test('unmarked and mixed baskets ask for an address before any attempt or payment', async t => {
  for (const mark of [undefined, id => id === 'one' ? 'digital' : 'physical']) {
    const { f, close } = checkout(mark); t.after(close);
    f.execution.loadCheckoutContactRequirements = requirements();
    await assert.rejects(startCheckout(f.execution, 'cart', { lines: cart, contact: { email } }), { message: 'Delivery address is required' });
    assert.equal(f.sessions.size, 0);
    assert.equal(await f.execution.store.read('cart'), null);
  }
});

test('the address rides the paid order; a digital-only basket carries none', async t => {
  const physical = checkout(); t.after(physical.close);
  physical.f.execution.loadCheckoutContactRequirements = requirements();
  const paid = await startCheckout(physical.f.execution, 'cart', { lines: cart, contact: { email, delivery: syntheticDelivery } });
  assert.equal(paid.phase, 'paid');
  const order = paidOrderOf(paid.order);
  assert.deepEqual(order.contactSnapshot.contact.delivery, syntheticDelivery);
  const detail = JSON.stringify(ordersView({ status: 'available', orders: [order] }, order.orderId));
  assert.ok(detail.includes('Fixture Shopper, 1 Example Way, Testville, 00000, US'));

  const digital = checkout(() => 'digital'); t.after(digital.close);
  digital.f.execution.loadCheckoutContactRequirements = requirements([]);
  const download = await startCheckout(digital.f.execution, 'cart', { lines: cart, contact: { email, delivery: syntheticDelivery } });
  assert.equal(download.phase, 'paid');
  assert.equal(download.order.contactSnapshot.contact.delivery, undefined);
  assert.ok(JSON.stringify(ordersView({ status: 'available', orders: [paidOrderOf(download.order)] }, download.order.orderId)).includes('No address'));
});
