import assert from 'node:assert/strict';
import test from 'node:test';
import { captureCheckoutContact, isCheckoutContactSnapshot, normalizeCheckoutContactInput, normalizeCheckoutDelivery } from '../../../dist/features/checkout-contact/index.js';
import { startCheckout } from '../../../dist/features/checkout/index.js';
import { openStore, fixture, cart, syntheticDelivery } from './fixture.mjs';

const email = 'region-fixture@example.test';
const billing = { name: 'Bill Payer', line1: '9 Billing Way', city: 'Billtown', postalCode: '00009', country: 'US' };
const requirements = (shippingCountries = ['US']) => async () => ({ requirePhoneNumber: false, shippingCountries, revision: 'regions-v1' });
const deliveryWith = region => {
  const delivery = { ...syntheticDelivery };
  if (region === undefined) delete delivery.region;
  else delivery.region = region;
  return delivery;
};
const capture = (delivery, countries) => captureCheckoutContact({ email, delivery, billing }, requirements(countries), true);
const states = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['FL', 'Florida'], ['GA', 'Georgia'],
  ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'],
  ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'],
  ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'],
  ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
  ['DC', 'District of Columbia'],
];
const invalidRegions = [undefined, '', '   ', 'XX', 'Unknown', 'PR', 'Puerto Rico', 'GU', 'Guam',
  'VI', 'U.S. Virgin Islands', 'AS', 'American Samoa', 'MP', 'Northern Mariana Islands', 'UM',
  'AA', 'AE', 'AP', 'Armed Forces Americas', 'Armed Forces Europe', 'Armed Forces Pacific',
  'A', 'C', 'Cal', 'York', 'Carolina', 'New', 'CA extra', 'xCA', 'California City', 'Washington DC',
  'D.C.', 'New  York', 'Alaska|Hawaii'];

test('new US physical capture accepts every state and DC code/name, preserving trimmed text', async () => {
  assert.equal(states.length, 51);
  for (const pair of states) for (const text of pair) {
    const mixed = [...text].map((c, i) => i % 2 ? c.toLowerCase() : c.toUpperCase()).join('');
    for (const region of [text, text.toLowerCase(), `  ${mixed}  `]) {
      const snapshot = await capture(deliveryWith(region));
      assert.equal(snapshot.contact.delivery.region, region.trim(), region);
      assert.ok(Object.isFrozen(snapshot.contact.delivery));
    }
  }
});

test('US physical capture rejects absent, blank, unknown, territory, military and partial regions', async () => {
  for (const region of invalidRegions) await assert.rejects(capture(deliveryWith(region)), { code: 'DELIVERY_INVALID' }, String(region));
});

test('country eligibility runs before US region eligibility and non-US regions remain optional', async () => {
  for (const countries of [[], ['CA']]) {
    await assert.rejects(capture(deliveryWith(undefined), countries), { code: 'DELIVERY_COUNTRY_UNAVAILABLE' });
  }
  const canadian = { ...deliveryWith(undefined), country: ' ca ' };
  assert.deepEqual((await capture(canadian, ['CA'])).contact.delivery, { ...canadian, country: 'CA' });
  assert.equal((await capture({ ...canadian, region: 'Unlisted province' }, ['CA'])).contact.delivery.region, 'Unlisted province');
  await assert.rejects(capture(canadian), { code: 'DELIVERY_COUNTRY_UNAVAILABLE' });
});

test('shared normalization and historical snapshot validation keep their optional, unrestricted region contract', () => {
  for (const region of [undefined, '', 'PR', 'AE', 'Unknown']) {
    const delivery = deliveryWith(region);
    const normalized = normalizeCheckoutDelivery(delivery);
    assert.equal(normalized.region, region || undefined);
    assert.deepEqual(normalizeCheckoutContactInput({ email, delivery }), { email, delivery: normalized });
    assert.equal(isCheckoutContactSnapshot({ schema: 'dinkuskit.commerce.checkout-contact/v1',
      contact: { email, delivery: normalized }, revision: null, requirePhoneNumber: false }), true);
  }
});

test('rejected physical, mixed and unmarked attempts cannot write, reserve stock or initiate payment', async t => {
  for (const mark of ['physical', 'mixed', 'unmarked']) {
    const opened = openStore(':memory:'); t.after(() => opened.db.close());
    const f = fixture(opened.store);
    for (const item of f.execution.catalog.catalog.records.values()) {
      if (mark !== 'unmarked') item.fulfillment = mark === 'mixed' && item.itemId === 'one' ? 'digital' : 'physical';
    }
    let writes = 0, payments = 0, associations = 0;
    const compareAndSet = f.execution.store.compareAndSet;
    f.execution.store.compareAndSet = (...args) => { writes++; return compareAndSet(...args); };
    f.execution.payments.ensureSession = async () => { payments++; throw Error('unexpected payment'); };
    f.execution.paymentAssociations = { async claim() { associations++; return true; } };
    for (const region of invalidRegions) {
      await assert.rejects(startCheckout(f.execution, 'rejected', { lines: cart, contact: { email, delivery: deliveryWith(region), billing } }), { code: 'DELIVERY_INVALID' });
      assert.equal(await f.execution.store.read('rejected'), null);
    }
    assert.deepEqual({ writes, payments, associations, reserves: f.counts().reserveCalls, holds: f.holds.size, sessions: f.sessions.size },
      { writes: 0, payments: 0, associations: 0, reserves: 0, holds: 0, sessions: 0 });
    // The same configured checkout still admits a supported US region.
    f.execution.payments.ensureSession = async () => ({ outcome: 'unknown' });
    const accepted = await startCheckout(f.execution, 'accepted', { lines: cart, contact: { email, delivery: deliveryWith('AK'), billing } });
    assert.equal(accepted.contactSnapshot.contact.delivery.region, 'AK');
    assert.ok(writes > 0);
    assert.equal(f.counts().reserveCalls, 1);
  }
});

test('digital-only checkout discards malformed delivery and US ineligibility with no shipping countries', async t => {
  const opened = openStore(':memory:'); t.after(() => opened.db.close());
  const f = fixture(opened.store, false);
  for (const item of f.execution.catalog.catalog.records.values()) item.fulfillment = 'digital';
  f.execution.loadCheckoutContactRequirements = requirements([]);
  f.setPayment('paid');
  for (const [i, delivery] of [null, 'bad address', { country: 'US', region: 'PR' }, { region: { invalid: true } }].entries()) {
    const paid = await startCheckout(f.execution, `digital-${i}`, { lines: cart, contact: { email, delivery, billing } });
    assert.equal(paid.phase, 'paid');
    assert.deepEqual(paid.order.contactSnapshot.contact, { email, billing });
  }
});

test('legacy active physical attempts replay without contact or reloading changed requirements', async t => {
  for (const region of [undefined, 'PR']) {
    const opened = openStore(':memory:'); t.after(() => opened.db.close());
    const f = fixture(opened.store);
    const first = await startCheckout(f.execution, 'active', { lines: cart, contact: { email, delivery: syntheticDelivery, billing } });
    assert.equal(first.phase, 'paying');
    const stored = await f.execution.store.read('active');
    stored.record.attempts[0].contactSnapshot.contact.delivery = deliveryWith(region);
    assert.equal(await f.execution.store.compareAndSet('active', stored.version, stored.record), true);
    let requirementReads = 0;
    f.execution.loadCheckoutContactRequirements = async () => { requirementReads++; return { requirePhoneNumber: true, shippingCountries: [], revision: 'changed' }; };
    f.setPayment('paid');
    const replay = await startCheckout(f.execution, 'active', { lines: cart });
    assert.equal(replay.attemptId, first.attemptId);
    assert.equal(replay.phase, 'paid');
    assert.deepEqual(replay.order.contactSnapshot.contact.delivery, deliveryWith(region));
    assert.equal(requirementReads, 0);
    assert.equal(f.counts().reserveCalls, 1);
    assert.equal(f.sessions.size, 1);
  }
});
