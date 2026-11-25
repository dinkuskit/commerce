// The built Registry bundle of Commerce, run in-process by a real EmDash runtime on Node's built-in SQLite: orders are
// marked Completed through Commerce's own orders route, and the store's courier reads them from `courier/outbox` the way
// it does, through EmDash's route dispatch with nobody signed in (order-shipped-outbox-20261122, store-emails-plugin-20261122).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDialect } from 'emdash/db/sqlite';
import { adaptSandboxEntry } from 'emdash/internal/plugins/adapt-sandbox-entry';

registerHooks({
  resolve: (specifier, context, next) => specifier.startsWith('virtual:emdash/') ? { url: 'data:text/javascript,export default undefined;', shortCircuit: true } : next(specifier, context),
  load(url, context, next) {
    const loaded = next(url, context);
    if (!url.includes('/node_modules/emdash/dist/') || !loaded.source) return loaded;
    return { ...loaded, source: String(loaded.source).replaceAll('import.meta.env', '({ DEV: false, PROD: true })') };
  },
});
const { EmDashRuntime } = await import('emdash/internal/plugin-test-runtime');
const { PluginStorageRepository } = await import('emdash');
import descriptor from '../../../dist/sandbox/index.mjs';
import definition from '../../../dist/sandbox/plugin.mjs';

const ID = 'dinkus-commerce';
const EDITOR = { id: 'editor', email: 'editor@shop.test', name: 'Editor', role: 40, createdAt: new Date() };
const usd = minor => ({ currency: 'USD', minor });
const delivery = name => ({ name, line1: '1 Example Way', city: 'Testville', postalCode: '00000', country: 'US' });
const paidOrder = (id, email, name, lines) => ({ schema: 'dinkuskit.commerce.paid-order/v1', orderId: id, receiptId: 'r-' + id, attemptId: 'a-' + id,
  paidAt: '2026-11-20T10:00:00Z', lines: lines.map(([catalogItemId, lineName]) => ({ catalogItemId, quantity: 1, name: lineName, unitPrice: usd('900') })),
  total: usd(String(900 * lines.length)), mode: 'test', paymentId: 'pi_x',
  contactSnapshot: { schema: 'dinkuskit.commerce.checkout-contact/v1', requirePhoneNumber: false, revision: null, contact: { email, delivery: delivery(name) } } });

const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew;

async function store() {
  const dir = mkdtempSync(join(tmpdir(), 'commerce-outbox-'));
  const url = `file:${join(dir, 'store.db')}`;
  const runtime = await EmDashRuntime.create({
    config: { database: { entrypoint: `commerce-outbox-${crypto.randomUUID()}`, type: 'sqlite', config: { url } } },
    plugins: [adaptSandboxEntry(definition, descriptor)],
    createDialect: () => createDialect({ url }), createStorage: null, createScheduler: null, sandboxEnabled: false, sandboxedPluginEntries: [],
  });
  await runtime.ensureStorageIndexesSynced();
  const orders = new PluginStorageRepository(runtime.db, ID, 'orders', descriptor.storage.orders.indexes);
  const call = (route, body, user) => runtime.handlePluginApiRoute(ID, 'POST', route, new Request('https://shop.test/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), user);
  return {
    runtime, orders,
    keep: (id, email, name, lines, { variant, ...extra } = {}) => orders.put(id, { paidOrder: { ...paidOrder(id, email, name, lines), ...(variant && { variantSelections: [{
      schema: 'dinkuskit.commerce.checkout-variant-selection/v1', ...variant, fulfillment: 'physical', selections: [{ optionId: 'size', optionLabel: 'Size', valueId: 'm', valueLabel: 'M' }] }] }) },
      emailKey: email, number: 1000 + Number(id.slice(-1)), revision: 1, ...extra }),
    /** The owner, on the Orders page's route, marks an order Completed or moves it back to Processing. */
    async owner(action, orderId, extra = {}) {
      const shown = await call('orders', { action: 'show', orderId }, EDITOR);
      const answer = await call('orders', { action, orderId, version: shown.data.order.version, ...extra }, EDITOR);
      assert.equal(answer.data?.result, 'saved', JSON.stringify(answer));
    },
    /** The store's courier, from the store's own code: no person. */
    since: (after, limit, extra = {}) => call('courier/outbox', { courier: 1, op: 'since', topic: 'order.shipped', after, limit, ...extra }),
    call,
    async stop() { try { await runtime.db.destroy(); } catch {} rmSync(dir, { recursive: true, force: true }); },
  };
}

test('the courier reads each Completed order once it is a minute old, oldest first, with what Reviews needs', async () => {
  const shop = await store();
  try {
    skew = 0;
    // The hat is bought in size M: a variant, reviewed under its product's id, as the product page shows it.
    await shop.keep('order-1', 'ana@buyer.test', 'Ana Buyer', [['mug', 'Mug'], ['hat-m', 'Hat']], { variant: { productId: 'hat', catalogItemId: 'hat-m' } });
    await shop.keep('order-2', 'bo@buyer.test', 'Bo Buyer', [['mug', 'Mug']]);
    // Completed by a version before this one: no shipped-news key, so it is never announced.
    await shop.keep('order-3', 'cy@buyer.test', 'Cy Buyer', [['hat', 'Hat']], { completed: { at: '2026-11-21T09:00:00.000Z' } });
    await shop.keep('order-4', 'di@buyer.test', 'Di Buyer', [['hat', 'Hat']]);
    await shop.owner('complete', 'order-1');
    await new Promise(resolve => setTimeout(resolve, 5));
    await shop.owner('complete', 'order-2');

    const fresh = await shop.since(null, 50);
    assert.equal(fresh.success, true, JSON.stringify(fresh.error));
    assert.deepEqual(fresh.data, { courier: 1, items: [], next: null, more: false }, 'nothing is news in its first minute');

    skew = 61_000;
    const first = (await shop.since(null, 1)).data;
    assert.equal(first.items.length, 1);
    assert.equal(first.more, true);
    const [one] = first.items;
    const completedAt = (await shop.orders.get('order-1')).completed.at;
    assert.deepEqual(one, { id: 'order-1:shipped', at: completedAt, data: {
      orderId: 'order-1', number: 1001, test: true, shippedAt: completedAt, email: 'ana@buyer.test', name: 'Ana Buyer', carrier: null, tracking: null,
      lines: [{ productId: 'mug', productName: 'Mug', quantity: 1 }, { productId: 'hat', productName: 'Hat', quantity: 1 }] } }, 'the size M hat is news for the hat');
    assert.equal(first.next, `${completedAt} order-1`);

    const second = (await shop.since(first.next, 50)).data;
    assert.deepEqual(second.items.map(item => item.id), ['order-2:shipped']);
    assert.equal(second.more, false);
    const caughtUp = (await shop.since(second.next, 50)).data;
    assert.deepEqual(caughtUp, { courier: 1, items: [], next: second.next, more: false }, 'a bookmark with nothing after it stays put');

    // Moved back to Processing and Completed again: the same news id, which Reviews already has and ignores.
    await shop.owner('reopen', 'order-2');
    assert.equal((await shop.orders.get('order-2')).shippedKey, undefined);
    skew = 0;
    await shop.owner('complete', 'order-2');
    skew = 122_000;
    const again = (await shop.since(second.next, 50)).data;
    assert.deepEqual(again.items.map(item => item.id), ['order-2:shipped']);
    console.log('order.shipped proof', JSON.stringify({ fresh: fresh.data.items.length, first: one, second: second.items.map(i => i.id), again: again.items.map(i => i.id), neverAnnounced: ['order-3', 'order-4'] }));
  } finally {
    skew = 0;
    await shop.stop();
  }
});

test('order.paid gives each order this version stored, with what the order confirmation shows, and order.shipped its carrier and tracking', async () => {
  const shop = await store();
  try {
    skew = 0;
    const paidAt = new Date(Date.now() - 120_000).toISOString();
    const pricing = { schema: 'dinkuskit.commerce.checkout-pricing/v1', merchandiseSubtotal: usd('4800'), couponDiscount: usd('0'), netMerchandise: usd('4800'),
      shipping: { configurationId: 'flat', revision: 1, mode: 'flat', charge: usd('600') }, finalTotal: usd('5400'), lines: [] };
    // Two size M tees, paid on this version: a paid-news key and the pricing the checkout froze.
    await shop.keep('order-5', 'ana@buyer.test', 'Ana Buyer', [['tee-m', 'Smoky Mountain Tee']], { variant: { productId: 'tee', catalogItemId: 'tee-m' }, paidKey: `${paidAt} order-5` });
    await shop.orders.put('order-5', { ...(await shop.orders.get('order-5')), paidOrder: { ...(await shop.orders.get('order-5')).paidOrder,
      lines: [{ catalogItemId: 'tee-m', quantity: 2, name: 'Smoky Mountain Tee', unitPrice: usd('2400') }], total: usd('5400'), pricing,
      // The store's own facts, frozen from the cart (commerce-cart-attributes-order-paid-20261123).
      attributes: { account_id: 'acct_42', 'credit.sku': 'compute-100' } } });
    // Paid on a version before this one: no paid-news key, so no confirmation is ever sent for it.
    await shop.keep('order-6', 'bo@buyer.test', 'Bo Buyer', [['mug', 'Mug']]);
    // A 60-line order: 50 lines and a count of the rest, so the item stays under the courier's 8 KB.
    // Long names in a script of three bytes a character are the worst case the courier's 8 KB sees.
    await shop.keep('order-7', 'cy@buyer.test', 'Cy Buyer', Array.from({ length: 60 }, (_, i) => ['item-' + i, 'Item ' + i + ' ' + '茶'.repeat(300)]), { paidKey: `${paidAt} order-7` });
    // Its attributes are as large as a cart allows (just under 1,000 bytes), and are never the part left out.
    const fullBag = Object.fromEntries(Array.from({ length: 4 }, (_, i) => ['fact_' + i, '茶'.repeat(78)]));
    await shop.orders.put('order-7', { ...(await shop.orders.get('order-7')), paidOrder: { ...(await shop.orders.get('order-7')).paidOrder, attributes: fullBag } });

    const paid = (await shop.since(null, 50, { topic: 'order.paid' })).data;
    assert.deepEqual(paid.items.map(item => item.id), ['order-5:paid', 'order-7:paid']);
    assert.deepEqual(paid.items[0], { id: 'order-5:paid', at: paidAt, data: {
      orderId: 'order-5', number: 1005, test: true, email: 'ana@buyer.test', name: 'Ana Buyer', shipTo: delivery('Ana Buyer'),
      lines: [{ name: 'Smoky Mountain Tee', options: 'Size: M', quantity: 2, unitPrice: usd('2400') }],
      subtotal: usd('4800'), discount: null, shipping: usd('600'), total: usd('5400'), addons: [],
      attributes: { account_id: 'acct_42', 'credit.sku': 'compute-100' } } });
    const bytes = item => new TextEncoder().encode(JSON.stringify(item)).length;
    const big = paid.items[1].data;
    assert.ok(bytes(fullBag) > 950 && bytes(fullBag) <= 1000, String(bytes(fullBag)));
    assert.deepEqual(big.attributes, fullBag);
    assert.ok(big.lines.length >= 1 && big.lines.length + big.moreLines === 60, JSON.stringify({ kept: big.lines.length, more: big.moreLines }));
    assert.equal(big.lines[0].name.length, 200, 'a name is cut to 200 characters');
    assert.ok(bytes(paid.items[1]) <= 7500, String(bytes(paid.items[1])));
    assert.ok(bytes({ ...paid.items[1], data: { ...big, lines: big.lines.concat(big.lines[0]) } }) > 7500, 'only lines that would not fit are left out');
    assert.equal(paid.next, `${paidAt} order-7`);
    assert.deepEqual((await shop.since(paid.next, 50, { topic: 'order.paid' })).data.items, []);

    await shop.owner('complete', 'order-5', { carrier: 'USPS', tracking: '9400 1000 0000 0000 0000 00' });
    await new Promise(resolve => setTimeout(resolve, 5));
    await shop.owner('complete', 'order-7');
    skew = 61_000;
    const [shipped, bigShipped] = (await shop.since(null, 50)).data.items;
    assert.equal(bigShipped.id, 'order-7:shipped');
    assert.ok(bytes(bigShipped) <= 7500 && bigShipped.data.lines.length + bigShipped.data.moreLines === 60, JSON.stringify({ bytes: bytes(bigShipped), kept: bigShipped.data.lines.length }));
    assert.deepEqual([shipped.data.number, shipped.data.carrier, shipped.data.tracking, shipped.data.lines], [1005, 'USPS', '9400 1000 0000 0000 0000 00', [{ productId: 'tee', productName: 'Smoky Mountain Tee', quantity: 2 }]]);
    console.log('order.paid proof', JSON.stringify({ paid: paid.items[0], bigPaid: { bytes: bytes(paid.items[1]), kept: big.lines.length, moreLines: big.moreLines },
      bigShipped: { bytes: bytes(bigShipped), kept: bigShipped.data.lines.length, moreLines: bigShipped.data.moreLines }, neverAnnounced: ['order-6'], shipped }));
  } finally {
    skew = 0;
    await shop.stop();
  }
});

test('order.paid names the discount and the add-ons whose answers priced the order, with their codes', async () => {
  const shop = await store();
  try {
    skew = 0;
    const paidAt = new Date(Date.now() - 120_000).toISOString();
    const pricing = { schema: 'dinkuskit.commerce.checkout-pricing/v1', merchandiseSubtotal: usd('900'), couponDiscount: usd('300'), netMerchandise: usd('600'),
      shipping: { configurationId: 'flat', revision: 1, mode: 'free', charge: usd('0') }, finalTotal: usd('600'), lines: [] };
    const addons = [{ from: 'dinkus-coupons', ref: 'hold-8', codes: ['SAVE3', 'FREESHIP'] }];
    await shop.keep('order-8', 'ana@buyer.test', 'Ana Buyer', [['mug', 'Mug']], { paidKey: `${paidAt} order-8` });
    await shop.orders.put('order-8', { ...(await shop.orders.get('order-8')), paidOrder: { ...(await shop.orders.get('order-8')).paidOrder, total: usd('600'), pricing, addons } });
    // The most the add-ons door keeps (1,500 characters of from, ref and codes, ASCII) beside the longest address Commerce
    // takes, in a script of three bytes a character: the item still fits the courier's 8 KB with every code and ref.
    const most = ['a', 'b', 'c', 'd'].map(from => ({ from: from.repeat(64), ref: 'r'.repeat(150), codes: Array(2).fill('C'.repeat(64)) }));
    assert.ok(JSON.stringify(most.map(a => [a.from, a.ref, a.codes])).length <= 1500);
    const far = '茶'.repeat(200);
    // And the most a cart's attributes hold (1,000 bytes): they are kept whole too, and only the item list gives way.
    const mostFacts = Object.fromEntries(Array.from({ length: 4 }, (_, i) => ['fact_' + i, '茶'.repeat(78)]));
    const longest = { name: far, line1: far, line2: far, city: far, region: 'DISTRICT OF COLUMBIA', postalCode: far, country: 'US' };
    await shop.keep('order-9', 'a'.repeat(64) + '@' + 'b'.repeat(185) + '.test', far, [['mug', far]], { paidKey: `${paidAt} order-9` });
    const nine = (await shop.orders.get('order-9')).paidOrder;
    await shop.orders.put('order-9', { ...(await shop.orders.get('order-9')), paidOrder: { ...nine, pricing, addons: most, attributes: mostFacts,
      contactSnapshot: { ...nine.contactSnapshot, contact: { ...nine.contactSnapshot.contact, delivery: longest } } } });
    const [item, biggest] = (await shop.since(null, 50, { topic: 'order.paid' })).data.items;
    assert.deepEqual([item.data.subtotal, item.data.discount, item.data.shipping, item.data.total, item.data.addons], [usd('900'), usd('300'), usd('0'), usd('600'), addons]);
    // An order from a cart that carried no attributes says so plainly.
    assert.equal(item.data.attributes, null);
    assert.equal(biggest.id, 'order-9:paid');
    assert.deepEqual(biggest.data.addons, most);
    assert.equal(biggest.data.shipTo.line2, far);
    const size = new TextEncoder().encode(JSON.stringify(biggest)).length;
    assert.deepEqual(biggest.data.attributes, mostFacts);
    assert.ok(size <= 7500 && biggest.data.lines.length + (biggest.data.moreLines ?? 0) === 1, String(size));
    console.log('largest add-ons paid news', JSON.stringify({ bytes: size, addons: most.length, attributeBytes: new TextEncoder().encode(JSON.stringify(mostFacts)).length, lines: biggest.data.lines.length }));
  } finally {
    await shop.stop();
  }
});

test('anyone signed in, the store\'s administrator included, and a request that is not the courier\'s are refused', async () => {
  const shop = await store();
  try {
    const admin = { ...EDITOR, id: 'admin', role: 50 };
    const asPerson = await shop.call('courier/outbox', { courier: 1, op: 'since', topic: 'order.shipped', after: null, limit: 50 }, admin);
    assert.equal(asPerson.success, false);
    assert.match(`${asPerson.error.code} ${asPerson.error.message}`, /COURIER_ONLY/);
    const topic = await shop.since(null, 50, { topic: 'order.refunded' });
    assert.match(`${topic.error.code} ${topic.error.message}`, /UNKNOWN_TOPIC/);
    const notCourier = await shop.call('courier/outbox', { op: 'since', topic: 'order.shipped' });
    assert.match(`${notCourier.error.code} ${notCourier.error.message}`, /BAD_COURIER_REQUEST/);
    // The door is private and says POST, so the courier finds it and nobody outside the store can reach it.
    assert.deepEqual(shop.runtime.getPluginRouteMeta(ID, 'courier/outbox'), { public: false, permission: 'plugins:manage', methods: ['POST'] });
    // The add-ons door is the same: the store's own code only (commerce-addons-door-20261124).
    const addons = await shop.call('checkout/addons/start', { addons: [] }, admin);
    assert.equal(addons.success, false);
    assert.match(`${addons.error.code} ${addons.error.message}`, /STORE_ONLY/);
    assert.equal(shop.runtime.getPluginRouteMeta(ID, 'checkout/addons/start').public, false);
  } finally {
    await shop.stop();
  }
});
