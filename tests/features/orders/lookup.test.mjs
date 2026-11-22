import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORDER_LOOKUP_TRIES, ORDER_LOOKUP_WAIT_SECONDS, clearOldLookupGuesses, createPaidOrderReceiver, lookUpOrder,
} from '../../../dist/features/orders/index.js';

// In-memory plugin storage with revisions, equality and expiresAt range filters.
function collection() {
  const rows = new Map(); let n = 0;
  const matches = (value, where = {}) => Object.entries(where).every(([key, want]) =>
    want && typeof want === 'object' ? value[key] <= want.lte : (value[key] ?? null) === want);
  return { rows,
    async get(id) { return rows.get(id)?.value ?? null; },
    async getVersioned(id) { return rows.get(id) ? structuredClone(rows.get(id)) : null; },
    async compareAndSet(id, expected, value) {
      if ((rows.get(id)?.revision ?? null) !== expected) return { applied: false };
      rows.set(id, { value: structuredClone(value), revision: 'r' + ++n }); return { applied: true, revision: 'r' + n };
    },
    async compareAndDelete(id, expected) {
      if (rows.get(id)?.revision !== expected) return { applied: false };
      rows.delete(id); return { applied: true };
    },
    async query({ where, limit = 100 }) {
      const items = [...rows].filter(([, row]) => matches(row.value, where)).map(([id, row]) => ({ id, data: structuredClone(row.value) }));
      return { items: items.slice(0, limit), hasMore: items.length > limit };
    },
  };
}
const SITE = 'https://shop.example.test';
const usd = minor => ({ currency: 'USD', minor });
const delivery = { name: 'Fixture Shopper', line1: '1 Example Way', city: 'Testville', postalCode: '00000', country: 'US' };
const order = (id, email) => ({ schema: 'dinkuskit.commerce.paid-order/v1', orderId: id, receiptId: 'r-' + id, attemptId: 'a-' + id, paidAt: '2026-11-20T10:00:00Z',
  lines: [{ catalogItemId: 'hat', quantity: 1, name: 'Hat', unitPrice: usd('100') }], total: usd('100'), mode: 'test', paymentId: 'pi_secret',
  contactSnapshot: { schema: 'dinkuskit.commerce.checkout-contact/v1', requirePhoneNumber: false, revision: null, contact: { email, phone: '555-0100', delivery } } });

async function shop() {
  const orders = collection(), numbers = collection(), guesses = collection();
  const receiver = createPaidOrderReceiver(orders, numbers);
  await receiver.receive(order('o1', 'Pat@Example.test')); // #1001
  await receiver.receive(order('o2', 'sam@example.test')); // #1002
  const ctx = { site: { url: SITE }, storage: { orders, order_numbers: numbers, order_lookup_guesses: guesses } };
  const ask = (input, { now = 1_800_000_000, headers = { origin: SITE } , url = `${SITE}/_emdash/api/plugins/dinkus-commerce/orders/lookup` } = {}) =>
    lookUpOrder({ input, request: { url, headers } }, ctx, now);
  return { ask, guesses, ctx };
}
const notFound = { ok: false, error: { code: 'ORDER_NOT_FOUND', message: 'No order matches that order number and email. Check both and try again.' } };

test('order number plus checkout email shows that one order, without internal payment details', async () => {
  const { ask } = await shop();
  for (const input of [{ orderNumber: '1001', email: 'pat@example.test' }, { orderNumber: '#1001', email: ' PAT@example.TEST ' }, { orderNumber: 1001, email: 'Pat@Example.test' }]) {
    const answer = await ask(input);
    assert.equal(answer.ok, true);
    assert.equal(answer.order.number, 1001);
    assert.equal(answer.order.status, 'processing');
    assert.deepEqual(answer.order.delivery, delivery);
    assert.equal(answer.order.phone, '555-0100');
    assert.ok(!JSON.stringify(answer).includes('pi_secret'), 'no payment identity');
    assert.ok(!JSON.stringify(answer).includes('attempt'), 'no checkout attempt');
  }
});

test('a wrong number, a wrong email, or another shopper\'s order all get the same not-found answer', async () => {
  const { ask } = await shop();
  assert.deepEqual(await ask({ orderNumber: '1002', email: 'pat@example.test' }), notFound); // sam's order
  assert.deepEqual(await ask({ orderNumber: '1999', email: 'pat@example.test' }), notFound);
  assert.deepEqual(await ask({ orderNumber: '1001', email: 'nobody@example.test' }), notFound);
});

test('5 wrong tries for one email, or for one order number, lock that box for an hour after the last try', async () => {
  const t0 = 1_800_000_000;
  {
    const { ask, guesses } = await shop();
    for (let i = 1; i <= ORDER_LOOKUP_TRIES; i += 1) assert.deepEqual(await ask({ orderNumber: String(1100 + i), email: 'pat@example.test' }, { now: t0 + i }), notFound);
    const limitedAnswer = { ok: false, error: { code: 'LOOKUP_LIMITED', message: 'Too many tries. Try again in an hour.' } };
    // Even the right number is refused for that email, while another email still works.
    assert.deepEqual(await ask({ orderNumber: '1001', email: 'pat@example.test' }, { now: t0 + 10 }), limitedAnswer);
    assert.equal((await ask({ orderNumber: '1002', email: 'sam@example.test' }, { now: t0 + 10 })).ok, true);
    assert.deepEqual(await ask({ orderNumber: '1001', email: 'pat@example.test' }, { now: t0 + 5 + ORDER_LOOKUP_WAIT_SECONDS - 1 }), limitedAnswer);
    assert.equal((await ask({ orderNumber: '1001', email: 'pat@example.test' }, { now: t0 + 5 + ORDER_LOOKUP_WAIT_SECONDS })).ok, true);
    // The email is kept only as a hash.
    assert.ok(![...guesses.rows.keys()].some(id => id.includes('pat@')), 'no email in guess ids');
    assert.ok(!JSON.stringify([...guesses.rows.values()]).includes('pat@'), 'no email in guess rows');
  }
  {
    const { ask } = await shop();
    for (let i = 1; i <= ORDER_LOOKUP_TRIES; i += 1) assert.deepEqual(await ask({ orderNumber: '1001', email: `guess${i}@example.test` }, { now: t0 + i }), notFound);
    assert.equal((await ask({ orderNumber: '1001', email: 'pat@example.test' }, { now: t0 + 10 })).error.code, 'LOOKUP_LIMITED');
    assert.equal((await ask({ orderNumber: '1002', email: 'sam@example.test' }, { now: t0 + 10 })).ok, true);
  }
});

test('requests from another site, or with bad input, are refused before any order is read', async () => {
  const { ask, guesses, ctx } = await shop();
  const good = { orderNumber: '1001', email: 'pat@example.test' };
  for (const headers of [{ origin: 'https://evil.example.test' }, { origin: SITE, 'sec-fetch-site': 'cross-site' }, {}]) {
    assert.equal((await ask(good, { headers })).error.code, 'ORIGIN_DENIED');
  }
  assert.equal((await ask(good, { url: 'https://other.example.test/_emdash/api/plugins/dinkus-commerce/orders/lookup' })).error.code, 'ORIGIN_DENIED');
  for (const input of [null, {}, { orderNumber: '1001' }, { ...good, extra: 1 }, { orderNumber: 'abc', email: 'pat@example.test' }, { orderNumber: '0', email: 'pat@example.test' },
    { orderNumber: '1001', email: 'not-an-email' }, { orderNumber: '1001', email: `${'a'.repeat(250)}@x.test` }]) {
    assert.equal((await ask(input)).error.code, 'INVALID_INPUT', JSON.stringify(input));
  }
  assert.equal(guesses.rows.size, 0, 'refusals before the lookup count no guesses');
  ctx.site.url = undefined;
  assert.equal((await ask(good)).error.code, 'UNAVAILABLE');
});

test('the 5-minute background check clears guess counts whose hour is over, and only those', async () => {
  const { ask, guesses, ctx } = await shop();
  await ask({ orderNumber: '1999', email: 'pat@example.test' }, { now: 1_800_000_000 });
  await ask({ orderNumber: '1998', email: 'sam@example.test' }, { now: 1_800_001_000 });
  assert.equal(guesses.rows.size, 4);
  await clearOldLookupGuesses(ctx, 1_800_000_000 + ORDER_LOOKUP_WAIT_SECONDS);
  assert.deepEqual([...guesses.rows.values()].map(row => row.value.expiresAt), [1_800_001_000 + ORDER_LOOKUP_WAIT_SECONDS, 1_800_001_000 + ORDER_LOOKUP_WAIT_SECONDS]);
});

test('a burst of lookups at the same moment gets no more than 5 order reads for one order number', async () => {
  const { ask, ctx } = await shop();
  let reads = 0;
  const query = ctx.storage.orders.query.bind(ctx.storage.orders);
  ctx.storage.orders.query = options => { if (typeof options.where?.emailKey === 'string') reads += 1; return query(options); };
  // Twelve guesses at #1001's email at once; the right one is last.
  const emails = [...Array.from({ length: 11 }, (_, i) => `guess${i}@example.test`), 'pat@example.test'];
  const answers = await Promise.all(emails.map(email => ask({ orderNumber: '1001', email })));
  assert.ok(reads <= ORDER_LOOKUP_TRIES, `${reads} order reads`);
  assert.equal(answers.filter(answer => answer.ok || answer.error.code === 'ORDER_NOT_FOUND').length, reads);
  for (const answer of answers.filter(answer => !answer.ok)) assert.ok(['ORDER_NOT_FOUND', 'LOOKUP_LIMITED', 'UNAVAILABLE'].includes(answer.error.code));
  // Once 5 wrong tries are in, the right email is refused too.
  if (answers.filter(answer => !answer.ok && answer.error.code === 'ORDER_NOT_FOUND').length === ORDER_LOOKUP_TRIES) {
    assert.equal((await ask({ orderNumber: '1001', email: 'pat@example.test' })).error.code, 'LOOKUP_LIMITED');
  }
});

test('a try that cannot be recorded reads no order, and a right guess gives its tries back', async () => {
  const { ask, guesses, ctx } = await shop();
  let reads = 0;
  const query = ctx.storage.orders.query.bind(ctx.storage.orders);
  ctx.storage.orders.query = options => { reads += 1; return query(options); };
  const compareAndSet = guesses.compareAndSet;
  guesses.compareAndSet = async () => ({ applied: false });
  assert.equal((await ask({ orderNumber: '1001', email: 'pat@example.test' })).error.code, 'UNAVAILABLE');
  assert.equal(reads, 0);
  guesses.compareAndSet = compareAndSet;
  for (let i = 1; i < ORDER_LOOKUP_TRIES; i += 1) await ask({ orderNumber: String(1100 + i), email: 'pat@example.test' });
  // 4 wrong, then right ones as often as wanted: the right guesses never use up the box.
  for (let i = 0; i < 3; i += 1) assert.equal((await ask({ orderNumber: '1001', email: 'pat@example.test' })).ok, true);
  assert.deepEqual(await ask({ orderNumber: '1999', email: 'pat@example.test' }), notFound);
  assert.equal((await ask({ orderNumber: '1001', email: 'pat@example.test' })).error.code, 'LOOKUP_LIMITED');
});

test('an order kept before the email index (no emailKey) is still found by its number and checkout email', async () => {
  const { ask, ctx } = await shop();
  const orders = ctx.storage.orders;
  const [id, row] = [...orders.rows].find(([, value]) => value.value.number === 1001);
  const legacy = structuredClone(row);
  delete legacy.value.emailKey;
  legacy.value.number = 1602;
  orders.rows.set(id, legacy);
  const answer = await ask({ orderNumber: '1602', email: 'pat@example.test' });
  assert.equal(answer.ok, true);
  assert.equal(answer.order.number, 1602);
  assert.deepEqual(await ask({ orderNumber: '1602', email: 'sam@example.test' }), notFound);
});
