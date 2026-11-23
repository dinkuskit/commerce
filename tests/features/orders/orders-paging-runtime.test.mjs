// The built Registry bundle of Commerce, run in-process by a real EmDash runtime on Node's built-in SQLite: Orders reads
// kept orders one page at a time through the paidKey index (EmDash's own orderBy, cursor, where and count), so a store
// with more than 10,000 orders still lists them, and orders kept before paidKey existed still list (deepsec G1-02).
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
const paidOrder = id => ({ schema: 'dinkuskit.commerce.paid-order/v1', orderId: id, receiptId: 'r-' + id, attemptId: 'a-' + id,
  paidAt: '2026-11-20T10:00:00Z', lines: [{ catalogItemId: 'mug', quantity: 1, name: 'Mug', unitPrice: usd('900') }], total: usd('900'), mode: 'test', paymentId: 'pi_x',
  contactSnapshot: { schema: 'dinkuskit.commerce.checkout-contact/v1', requirePhoneNumber: false, revision: null,
    contact: { email: 'shopper@buyer.test', delivery: { name: 'Shopper', line1: '1 Example Way', city: 'Testville', postalCode: '00000', country: 'US' } } } });

async function store() {
  const dir = mkdtempSync(join(tmpdir(), 'commerce-orders-paging-'));
  const url = `file:${join(dir, 'store.db')}`;
  const runtime = await EmDashRuntime.create({
    config: { database: { entrypoint: `commerce-orders-paging-${crypto.randomUUID()}`, type: 'sqlite', config: { url } } },
    plugins: [adaptSandboxEntry(definition, descriptor)],
    createDialect: () => createDialect({ url }), createStorage: null, createScheduler: null, sandboxEnabled: false, sandboxedPluginEntries: [],
  });
  await runtime.ensureStorageIndexesSynced();
  const orders = new PluginStorageRepository(runtime.db, ID, 'orders', descriptor.storage.orders.indexes);
  const call = async (route, body) => {
    const answer = await runtime.handlePluginApiRoute(ID, 'POST', route, new Request('https://shop.test/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), EDITOR);
    assert.equal(answer.success, true, JSON.stringify(answer.error));
    return answer.data;
  };
  return { orders, call, async stop() { try { await runtime.db.destroy(); } catch {} rmSync(dir, { recursive: true, force: true }); } };
}

const name = i => 'order-' + String(i).padStart(5, '0');
const keep = (orders, from, to, paidKey = true) => orders.putMany(Array.from({ length: to - from + 1 }, (_, k) => {
  const i = from + k, id = name(i);
  return { id, data: { paidOrder: paidOrder(id), emailKey: 'shopper@buyer.test', number: 1000 + i, revision: 1,
    ...(paidKey && { paidKey: new Date(Date.UTC(2026, 10, 1) + i * 1000).toISOString() + ' ' + id }) } };
}));
const page = view => view.blocks.flatMap(block => block.elements ?? []).filter(e => e.action_id?.startsWith('orders.open:')).map(e => decodeURIComponent(e.action_id.slice(12)));
const admin = (shop, interaction) => shop.call('admin', { page: '/orders', ...interaction });

test('Orders lists a store of 10,050 kept orders a page at a time, newest first, on EmDash storage', async () => {
  const shop = await store();
  try {
    await keep(shop.orders, 1, 10_050);
    const first = await shop.call('orders', { action: 'list' });
    assert.equal(first.total, 10_050);
    assert.deepEqual(first.orders.map(o => o.orderId), Array.from({ length: 50 }, (_, k) => name(k + 1)), 'agents read oldest first, in order-number order');
    assert.equal(first.next, 50);
    const last = await shop.call('orders', { action: 'list', offset: 10_000 });
    assert.deepEqual(last.orders.map(o => o.number), Array.from({ length: 50 }, (_, k) => 11_001 + k));
    assert.equal(Object.hasOwn(last, 'next'), false);
    const view = await admin(shop, { type: 'page_load' });
    assert.deepEqual(page(view), Array.from({ length: 25 }, (_, k) => name(10_050 - k)), 'the owner sees the newest 25');
    assert.doesNotMatch(JSON.stringify(view), /Orders unavailable/);
    console.log('orders paging proof', JSON.stringify({ kept: first.total, agentFirst: first.orders[0].orderId, agentLast: last.orders.at(-1).orderId, ownerFirst: page(view)[0] }));
  } finally {
    await shop.stop();
  }
});

test('the status filter and orders kept before paidKey existed both work on EmDash storage', async () => {
  const shop = await store();
  try {
    await keep(shop.orders, 1, 130);
    await keep(shop.orders, 131, 132, false);
    const shown = await shop.call('orders', { action: 'show', orderId: name(7) });
    assert.equal((await shop.call('orders', { action: 'complete', orderId: name(7), version: shown.order.version })).result, 'saved');
    const done = await shop.call('orders', { action: 'list', status: 'completed' });
    assert.deepEqual([done.total, done.orders.map(o => o.orderId)], [1, [name(7)]]);
    const open = await shop.call('orders', { action: 'list', status: 'processing', offset: 100 });
    assert.equal(open.total, 131);
    // Ascending, a missing paidKey sorts after every value: the two older orders come last for agents.
    assert.deepEqual(open.orders.slice(-3).map(o => o.orderId), [name(130), name(131), name(132)]);
    // Descending, the owner's newest-first list shows them first.
    assert.deepEqual(page(await admin(shop, { type: 'page_load' })).slice(0, 3), [name(132), name(131), name(130)]);
  } finally {
    await shop.stop();
  }
});
