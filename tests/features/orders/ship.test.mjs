import test from 'node:test';
import assert from 'node:assert/strict';
import { SHIP_ORDER_SCHEMA, SHIP_ORDERS_PER_SYNC, completeOrder, correctDelivery, createPaidOrderReceiver, reopenOrder, shipLabelPage, syncShip } from '../../../dist/features/orders/index.js';

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
const delivery = { name: 'Fixture Shopper', line1: '1 Example Way', city: 'Testville', region: 'CA', postalCode: '00000', country: 'US' };
const line = (catalogItemId, quantity = 1) => ({ catalogItemId, quantity, name: catalogItemId.toUpperCase(), unitPrice: usd('100') });
const order = (id, lines = [line('hat')], extra = {}) => ({ schema: 'dinkuskit.commerce.paid-order/v1', orderId: id, receiptId: 'r-' + id, attemptId: 'a-' + id,
  paidAt: '2026-10-10T01:00:00Z', paymentId: 'pay-' + id, lines, total: usd('100'),
  contactSnapshot: { schema: 'dinkuskit.commerce.checkout-contact/v1', requirePhoneNumber: false, revision: null,
    contact: { email: 'shopper@example.com', phone: '+15555550100', ...(extra.digital ? {} : { delivery }) } }, ...(extra.mode ? { mode: extra.mode } : {}) });
// Catalog's answer for each line: hat ships and weighs 4.5 oz, scarf ships with no weight set, ebook is digital.
const catalog = { hat: { physical: true, weightOz: 4.5 }, scarf: { physical: true }, ebook: { physical: false } };
const item = async id => catalog[id] ?? null;

function ship(labels = []) {
  const state = { labels: [...labels], acks: [], sent: [], calls: [], status: { list: 200, ack: 200, order: 200 } };
  const fetch = async (url, init) => {
    state.calls.push({ url, method: init.method, authorization: init.headers.authorization });
    const path = new URL(url).pathname;
    if (path === '/v1/labels') return state.status.list === 200 ? Response.json(state.labels) : new Response('{}', { status: state.status.list });
    const body = JSON.parse(init.body);
    if (path === '/v1/labels/ack') {
      if (state.status.ack !== 200) return new Response('{}', { status: state.status.ack });
      state.acks.push(body.eventId);
      state.labels = state.labels.filter(label => label.eventId !== body.eventId);
      return Response.json({ acknowledged: true });
    }
    assert.equal(path, '/v1/orders');
    state.sent.push(body);
    return new Response('{}', { status: state.status.order });
  };
  return { state, connection: { origin: 'https://ship.example.test/', fetch, read: response => response.json(), credential: async () => 'synthetic-ship-pass' } };
}
async function store(...orders) {
  const kept = collection();
  const receiver = createPaidOrderReceiver(kept, collection());
  for (const paid of orders) await receiver.receive(paid);
  return kept;
}

test('each order with an address goes to Ship once per version, with each item\'s price paid and weight, and no digital items, totals, payment or phone', async () => {
  const priced = (paid, minor) => ({ ...paid, unitPrice: usd(minor) });
  const kept = await store(order('o1'), order('o2', [priced(line('hat', 2), '1250'), line('ebook'), priced(line('scarf'), '899'), line('gone')], { mode: 'live' }),
    order('o3', [line('ebook')], { digital: true }));
  const { state, connection } = ship();
  await syncShip(kept, connection, item);
  assert.deepEqual(state.sent.map(sent => sent.orderId), ['o1', 'o2']);
  assert.deepEqual(state.sent[1], { schema: SHIP_ORDER_SCHEMA, orderId: 'o2', number: 1002, version: 1, status: 'processing', test: false,
    shipTo: delivery, email: 'shopper@example.com', completed: null,
    lines: [{ catalogItemId: 'hat', name: 'HAT', quantity: 2, unitPrice: usd('1250'), weightOz: 4.5 },
      { catalogItemId: 'scarf', name: 'SCARF', quantity: 1, unitPrice: usd('899') }, { catalogItemId: 'gone', name: 'GONE', quantity: 1, unitPrice: usd('100') }] });
  assert.equal(state.sent[0].test, true);
  // Beyond each item's price, no money, payment or phone details leave Commerce.
  assert.doesNotMatch(JSON.stringify(state.sent), /total|pay-|paymentId|phone|5555550100|receipt/);
  for (const call of state.calls) {
    assert.match(call.url, /^https:\/\/ship\.example\.test\/v1\//);
    assert.equal(call.authorization, 'Bearer synthetic-ship-pass');
  }
  // Ship took version 1; recording that is not an owner change, so the version stays 1.
  assert.deepEqual([(await kept.get('o1')).shipVersion, (await kept.get('o1')).revision], [1, 1]);
  await syncShip(kept, connection, item);
  assert.equal(state.sent.length, 2);
  // An address fix, Complete and Move back each raise the version, and Ship gets each one.
  assert.equal(await correctDelivery(kept, 'o1', 1, { ...delivery, line1: '2 Corrected Road' }, ['US']), 'saved');
  await syncShip(kept, connection, item);
  assert.deepEqual([state.sent[2].version, state.sent[2].shipTo.line1], [2, '2 Corrected Road']);
  assert.equal(await completeOrder(kept, 'o1', 2, { carrier: 'USPS', tracking: '9400 SYNTHETIC' }, '2026-10-10T18:00:00.000Z'), 'saved');
  await syncShip(kept, connection, item);
  assert.deepEqual([state.sent[3].version, state.sent[3].status, state.sent[3].completed], [3, 'completed', { at: '2026-10-10T18:00:00.000Z', carrier: 'USPS', tracking: '9400 SYNTHETIC' }]);
  assert.equal(await reopenOrder(kept, 'o1', 3), 'saved');
  await syncShip(kept, connection, item);
  assert.deepEqual([state.sent[4].version, state.sent[4].status, state.sent[4].completed], [4, 'processing', null]);
  assert.equal(state.sent.length, 5);
});

test('each order carries the store\'s name from the Site title, cleaned for Ship, and none when nothing is left', async () => {
  const sent = async name => {
    const { state, connection } = ship();
    await syncShip(await store(order('o1'), order('o2')), { ...connection, name }, item);
    assert.equal(state.sent.length, 2);
    assert.equal(state.sent[0].storeName, state.sent[1].storeName);
    return state.sent[0];
  };
  assert.equal((await sent('Fixture Hat Shop')).storeName, 'Fixture Hat Shop');
  // Each run of spaces or control characters, line and paragraph separators included, becomes one space,
  // then the ends are trimmed.
  assert.equal((await sent(' \t Fixture\u0007 Hat\nShop \u2029 Co\u0085\u007f  ')).storeName, 'Fixture Hat Shop Co');
  // At most 200 UTF-16 units, never ending on half a character or a space.
  assert.equal((await sent('é'.repeat(250))).storeName, 'é'.repeat(200));
  assert.equal((await sent('a'.repeat(199) + '😀b')).storeName, 'a'.repeat(199));
  assert.equal((await sent('a'.repeat(198) + '😀b')).storeName, 'a'.repeat(198) + '😀');
  assert.equal((await sent('a'.repeat(199) + ' b')).storeName, 'a'.repeat(199));
  // No Site title, or nothing left after cleaning, sends no store name at all.
  for (const name of [undefined, '', ' \t ', '\u0000\u001f', '\u0085\u2028\u009f']) assert.equal('storeName' in await sent(name), false);
});

test('what people typed goes to Ship as one line, and the order keeps what was typed', async () => {
  // Ship refuses text holding a control character, C1 ones such as NEL included, or a Unicode line or
  // paragraph separator (dinkuskit/ship service/src/order.ts), all of which a paste can carry.
  const NOT_ONE_LINE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
  const strings = value => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
  const typed = { ...delivery, name: 'Fixture\u2028Shopper', line1: '1 Example Way \u2029\u2028 Unit 2', line2: '\u0085' };
  const paid = order('o1', [{ ...line('hat'), name: 'Wool\u2028Hat\u0085Blue' }]);
  paid.contactSnapshot.contact.delivery = typed;
  const kept = await store(paid);
  const { state, connection } = ship();
  await syncShip(kept, { ...connection, name: 'Fixture\u2028Hat Shop' }, item);
  // Each run, with any spaces beside it, becomes one space and the ends are trimmed; an address field
  // with nothing left is left out.
  assert.deepEqual(state.sent[0].shipTo, { ...delivery, name: 'Fixture Shopper', line1: '1 Example Way Unit 2' });
  assert.deepEqual([state.sent[0].lines[0].name, state.sent[0].storeName], ['Wool Hat Blue', 'Fixture Hat Shop']);
  // The owner's address fix and a hand-typed carrier and tracking number go the same way.
  assert.equal(await correctDelivery(kept, 'o1', 1, { ...delivery, line1: '2 Corrected\u2028Road' }, ['US']), 'saved');
  await syncShip(kept, connection, item);
  assert.equal(state.sent[1].shipTo.line1, '2 Corrected Road');
  assert.equal(await completeOrder(kept, 'o1', 2, { carrier: '\u0085', tracking: '9400\u2028SYNTHETIC\u0085' }, '2026-10-10T18:00:00.000Z'), 'saved');
  await syncShip(kept, connection, item);
  assert.deepEqual(state.sent[2].completed, { at: '2026-10-10T18:00:00.000Z', tracking: '9400 SYNTHETIC' });
  for (const text of strings(state.sent)) assert.doesNotMatch(text, NOT_ONE_LINE);
  // Orders keeps what was typed.
  const record = await kept.get('o1');
  assert.deepEqual([record.paidOrder.contactSnapshot.contact.delivery, record.paidOrder.lines[0].name], [typed, 'Wool\u2028Hat\u0085Blue']);
  assert.deepEqual([record.delivery.line1, record.completed.carrier, record.completed.tracking], ['2 Corrected\u2028Road', '\u0085', '9400\u2028SYNTHETIC\u0085']);
});

test('a label Ship bought completes its order at the labeled version, and every label is acknowledged', async () => {
  const kept = await store(order('o1'), order('o2'), order('o3'), order('o4'));
  assert.equal(await correctDelivery(kept, 'o2', 1, { ...delivery, line1: '2 Corrected Road' }, ['US']), 'saved');
  assert.equal(await completeOrder(kept, 'o3', 1, {}, '2026-10-10T18:00:00.000Z'), 'saved');
  const before = structuredClone([...kept.rows].filter(([id]) => id !== 'o1'));
  const { state, connection } = ship([
    { eventId: 'lbl_1', orderId: 'o1', version: 1, carrier: 'USPS', tracking: '9400 SYNTHETIC 1' },
    // Bought for the address before the owner's fix: the order stays Processing.
    { eventId: 'lbl_2', orderId: 'o2', version: 1, carrier: 'USPS', tracking: '9400 SYNTHETIC 2' },
    // Already Completed by hand: unchanged.
    { eventId: 'lbl_3', orderId: 'o3', version: 2, carrier: 'USPS', tracking: '9400 SYNTHETIC 3' },
    // A tracking number Orders cannot keep, and orders Orders does not have, change nothing.
    { eventId: 'lbl_4', orderId: 'o4', version: 1, carrier: 'USPS', tracking: 'x'.repeat(65) },
    { eventId: 'lbl_5', orderId: 'missing', version: 1, carrier: 'USPS', tracking: '9400' },
    { eventId: 'lbl_6', orderId: { not: 'an id' }, version: 1 },
  ]);
  await syncShip(kept, connection, item);
  assert.deepEqual(state.acks, ['lbl_1', 'lbl_2', 'lbl_3', 'lbl_4', 'lbl_5', 'lbl_6']);
  const labeled = await kept.get('o1');
  assert.equal(labeled.revision, 2);
  assert.equal(labeled.completed.carrier, 'USPS');
  assert.equal(labeled.completed.tracking, '9400 SYNTHETIC 1');
  for (const [id, row] of before) {
    const { shipVersion: _sent, ...now } = await kept.get(id);
    assert.deepEqual(now, row.value, id);
  }
  // Ship then gets the labeled order as Completed at its new version.
  const o1 = state.sent.find(sent => sent.orderId === 'o1');
  assert.deepEqual([o1.version, o1.status, o1.completed.tracking], [2, 'completed', '9400 SYNTHETIC 1']);
  // A label seen again after a lost acknowledgement changes nothing and is acknowledged.
  state.labels = [{ eventId: 'lbl_1', orderId: 'o1', version: 1, carrier: 'USPS', tracking: '9400 SYNTHETIC 1' }];
  await syncShip(kept, connection, item);
  assert.equal((await kept.get('o1')).revision, 2);
  assert.deepEqual(state.acks.slice(-1), ['lbl_1']);
});

test('when Ship cannot be reached nothing is lost, and a version Ship refuses for good waits for the next change', async () => {
  const kept = await store(order('o1'));
  const { state, connection } = ship([{ eventId: 'lbl_1', orderId: 'o1', version: 1, carrier: 'USPS', tracking: '9400' }]);
  state.status.list = 503;
  await assert.rejects(syncShip(kept, connection, item), /Ship unavailable/);
  assert.deepEqual([(await kept.get('o1')).revision, state.sent.length, state.acks.length], [1, 0, 0]);
  // The order is completed but the acknowledgement is lost: the next sync acknowledges it.
  state.status.list = 200; state.status.ack = 503;
  await assert.rejects(syncShip(kept, connection, item), /Ship unavailable/);
  assert.deepEqual([(await kept.get('o1')).revision, state.labels.length, state.sent.length], [2, 1, 0]);
  state.status.ack = 200; state.status.order = 500;
  await assert.rejects(syncShip(kept, connection, item), /Ship unavailable/);
  assert.deepEqual([(await kept.get('o1')).revision, state.labels.length, state.sent.length, (await kept.get('o1')).shipVersion], [2, 0, 1, undefined]);
  state.status.order = 422;
  await syncShip(kept, connection, item);
  await syncShip(kept, connection, item);
  assert.deepEqual([state.sent.length, (await kept.get('o1')).shipVersion], [2, 2]);
  assert.equal(await reopenOrder(kept, 'o1', 2), 'saved');
  await syncShip(kept, connection, item);
  assert.deepEqual(state.sent.map(sent => sent.version), [2, 2, 3]);
  // Without a usable pass, or with a malformed label list, Ship is not asked and nothing changes.
  const rows = JSON.stringify([...kept.rows]);
  const calls = state.calls.length;
  await assert.rejects(syncShip(kept, { ...connection, credential: async () => { throw new Error('no pass'); } }, item), /no pass/);
  assert.equal(state.calls.length, calls);
  for (const labels of [{}, [null], [{ orderId: 'o1' }], Array.from({ length: 101 }, (_, i) => ({ eventId: 'e' + i }))]) {
    state.labels = labels;
    await assert.rejects(syncShip(kept, connection, item), /Ship unavailable/);
  }
  assert.equal(JSON.stringify([...kept.rows]), rows);
});

test('a backlog goes to Ship a few orders per sync', async () => {
  const many = Array.from({ length: SHIP_ORDERS_PER_SYNC + 3 }, (_, i) => order('o' + String(i).padStart(2, '0')));
  const kept = await store(...many);
  const { state, connection } = ship();
  await syncShip(kept, connection, item);
  assert.equal(state.sent.length, SHIP_ORDERS_PER_SYNC);
  await syncShip(kept, connection, item);
  assert.equal(state.sent.length, SHIP_ORDERS_PER_SYNC + 3);
  assert.equal(new Set(state.sent.map(sent => sent.orderId)).size, SHIP_ORDERS_PER_SYNC + 3);
});

test('Ship\'s label page for an order is on Ship\'s origin under the store\'s id, both encoded', () => {
  assert.equal(shipLabelPage({ origin: 'https://ship.example.test/', site: 'synthetic-site' }, 'order:01/a b'),
    'https://ship.example.test/stores/synthetic-site/orders/order%3A01%2Fa%20b');
  assert.equal(shipLabelPage({ origin: 'https://ship.example.test', site: 'site/1' }, 'o1'), 'https://ship.example.test/stores/site%2F1/orders/o1');
});

test('an order pinned by the retired isolated Ship profile never goes to Ship or completes from it', async () => {
  const kept = await store(order('o1'), order('o2'));
  const row = await kept.getVersioned('o2');
  await kept.compareAndSet('o2', row.revision, { ...row.value, shipPin: { recipient: 'ship-sandbox', generation: 'fixture-generation-1', site: 'site', enabled: false } });
  const before = await kept.get('o2');
  const { state, connection } = ship([{ eventId: 'lbl_2', orderId: 'o2', version: 1, carrier: 'USPS', tracking: '9400 SYNTHETIC 2' }]);
  await syncShip(kept, connection, item);
  assert.deepEqual(state.sent.map(sent => sent.orderId), ['o1']);
  assert.deepEqual(state.acks, []);
  assert.deepEqual(await kept.get('o2'), before);
});

test('settings that stop naming this Ship mid-sync stop it before the next call or record', async () => {
  for (const at of ['labels', 'order']) {
    const kept = await store(order('o1'));
    const { state, connection } = ship([{ eventId: 'lbl_1', orderId: 'o1', version: 1, carrier: 'USPS', tracking: '9400 SYNTHETIC 1' }]);
    let active = true;
    const fetch = connection.fetch;
    const moving = { ...connection, current: async () => active, fetch: async (url, init) => {
      const response = await fetch(url, init);
      if (new URL(url).pathname === (at === 'labels' ? '/v1/labels' : '/v1/orders')) active = false;
      return response;
    } };
    if (at === 'order') state.labels = [];
    const before = await kept.get('o1');
    await assert.rejects(syncShip(kept, moving, item), /Ship unavailable/);
    assert.deepEqual(state.acks, []);
    assert.deepEqual(await kept.get('o1'), before, at);
  }
});
