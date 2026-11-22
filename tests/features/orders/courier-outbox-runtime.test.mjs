// The built Registry bundle of Commerce, run in-process by a real EmDash runtime on Node's built-in SQLite: orders are
// marked Completed through Commerce's own orders route, and the store's courier reads them from `courier/outbox` the way
// it does, through EmDash's route dispatch with nobody signed in (order-shipped-outbox-20261122).
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
    async owner(action, orderId) {
      const shown = await call('orders', { action: 'show', orderId }, EDITOR);
      const answer = await call('orders', { action, orderId, version: shown.data.order.version }, EDITOR);
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
      orderId: 'order-1', shippedAt: completedAt, email: 'ana@buyer.test', name: 'Ana Buyer',
      lines: [{ productId: 'mug', productName: 'Mug' }, { productId: 'hat', productName: 'Hat' }] } }, 'the size M hat is news for the hat');
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

test('anyone signed in, the store\'s administrator included, and a request that is not the courier\'s are refused', async () => {
  const shop = await store();
  try {
    const admin = { ...EDITOR, id: 'admin', role: 50 };
    const asPerson = await shop.call('courier/outbox', { courier: 1, op: 'since', topic: 'order.shipped', after: null, limit: 50 }, admin);
    assert.equal(asPerson.success, false);
    assert.match(`${asPerson.error.code} ${asPerson.error.message}`, /COURIER_ONLY/);
    const topic = await shop.since(null, 50, { topic: 'order.paid' });
    assert.match(`${topic.error.code} ${topic.error.message}`, /UNKNOWN_TOPIC/);
    const notCourier = await shop.call('courier/outbox', { op: 'since', topic: 'order.shipped' });
    assert.match(`${notCourier.error.code} ${notCourier.error.message}`, /BAD_COURIER_REQUEST/);
    // The door is private and says POST, so the courier finds it and nobody outside the store can reach it.
    assert.deepEqual(shop.runtime.getPluginRouteMeta(ID, 'courier/outbox'), { public: false, permission: 'plugins:manage', methods: ['POST'] });
  } finally {
    await shop.stop();
  }
});
