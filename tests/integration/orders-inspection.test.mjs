import assert from 'node:assert/strict';
import test from 'node:test';
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { PluginStorageRepository } from 'emdash';
import { createPaidOrderReceiver, ordersBlocks } from '../../dist/features/orders/index.js';
import { createCheckoutStore, listPaidOrders, startCheckout } from '../../dist/features/checkout/index.js';
import { fixture, cart, withSyntheticCheckoutContact } from '../features/checkout/fixture.mjs';

// The real repository owns cursor encoding and row envelopes; projection-only
// tests cannot detect a controller reading the wrong namespace or losing pages.
test('Orders keeps its own copies of paid orders and reads only them across SQLite pages', async () => {
  const database = new BetterSqlite3(':memory:');
  database.exec('CREATE TABLE _plugin_storage (plugin_id TEXT, collection TEXT, id TEXT, data TEXT, revision TEXT, created_at TEXT, updated_at TEXT, PRIMARY KEY(plugin_id,collection,id))');
  const db = new Kysely({ dialect: new SqliteDialect({ database }) });
  const carts = new PluginStorageRepository(db, 'orders-proof', 'checkout_carts', []);
  const orders = new PluginStorageRepository(db, 'orders-proof', 'orders', []);
  let sequence = 0;
  const insert = async data => { const id='fixture-'+sequence++; assert.equal((await carts.compareAndSet(id,null,data)).applied,true); return {id}; };
  const route = input => ({ user: { role: 50 }, ui: { surface: 'admin-page' }, input });
  const services = { paidOrders: () => listPaidOrders(carts) };
  const load = input => ordersBlocks(route(input ?? {type:'page_load',page:'/orders'}), {storage:{orders}}, services);
  const rows = collection => database.prepare('SELECT * FROM _plugin_storage WHERE collection = ? ORDER BY id').all(collection);
  const buttons = response => response.blocks.flatMap(b => b.type === 'actions' ? b.elements : []);
  const opens = response => buttons(response).filter(b=>b.action_id.startsWith('orders.open:')).length;
  try {
    assert.match(JSON.stringify(await load()), /No orders recorded yet/);
    const f = fixture(createCheckoutStore(carts), false);
    f.execution.paidOrders = createPaidOrderReceiver(orders);
    f.setPayment('paid');
    const paid = await startCheckout(f.execution, 'paid-cart', withSyntheticCheckoutContact(cart));
    assert.equal(paid.phase, 'paid');
    for (const price of f.execution.catalog.prices.records.values()) { price.regular.minor='0'; delete price.sale; }
    const free = await startCheckout(f.execution, 'free-cart', withSyntheticCheckoutContact(cart));
    assert.equal(free.phase, 'paid');
    assert.equal(free.order.total.minor, '0');
    // Checkout handed both orders over when it recorded them as paid.
    assert.equal(rows('orders').length, 2);
    const kept = (await orders.get(paid.order.orderId)).paidOrder;
    assert.equal(kept.schema, 'dinkuskit.commerce.paid-order/v1');
    assert.equal(kept.paidAt, paid.order.paidAt);
    assert.match(kept.paidAt, /^\d{4}-\d\d-\d\dT/);
    // Empty aggregates exceed one storage page; all must be traversed.
    for (let i=0;i<105;i++) await insert({attempts:[]});
    const cartsBefore = rows('checkout_carts');
    const ordersBefore = rows('orders');
    const list = await load();
    assert.equal(opens(list),2);
    assert.ok(buttons(list).some(b=>b.label==='Bring in missing orders'));
    for (const [order, kind] of [[paid.order,'Provider-paid'],[free.order,'Zero payable']]) {
      const detail = JSON.stringify(await load({type:'block_action',action_id:'orders.open:'+encodeURIComponent(order.orderId)}));
      for (const expected of [order.orderId,order.receiptId,order.attemptId,kind,'Processing','Back to orders',order.paidAt]) assert.ok(detail.includes(expected),expected);
    }
    assert.deepEqual(rows('checkout_carts'),cartsBefore);
    assert.deepEqual(rows('orders'),ordersBefore);
    // Orders paid before the handoff are in Checkout only until brought in.
    for(let i=0;i<26;i++) await insert({attempts:[{phase:'paid',attemptId:'history-'+i,order:{...paid.order,attemptId:'history-'+i,orderId:'historical-'+String(i).padStart(2,'0')}}]});
    assert.equal(opens(await load()),2);
    const brought = await load({type:'block_action',action_id:'orders.import'});
    assert.match(JSON.stringify(brought), /Brought in 26 missing orders/);
    assert.equal(rows('orders').length, 28);
    assert.match(JSON.stringify(await load({type:'block_action',action_id:'orders.import'})), /No missing orders/);
    assert.equal(rows('orders').length, 28);
    const first=await load();
    assert.equal(opens(first),25);
    const next=buttons(first).find(b=>b.label==='Next');
    const second=await load({type:'block_action',action_id:next.action_id,value:next.value});
    assert.equal(opens(second),3);
    assert.ok(buttons(second).some(b=>b.label==='Previous'));
    // A copy that no longer matches Checkout is reported and never replaced.
    const changed = { paidOrder: { ...kept, total: { currency: 'USD', minor: '1' } } };
    database.prepare('UPDATE _plugin_storage SET data = ? WHERE collection = ? AND id = ?').run(JSON.stringify(changed), 'orders', paid.order.orderId);
    assert.match(JSON.stringify(await load({type:'block_action',action_id:'orders.import'})), /1 order differs from Checkout/);
    assert.deepEqual((await orders.get(paid.order.orderId)), changed);
    // Malformed Checkout records fail the bring-in closed; the kept copies stay readable.
    for(const data of [{attempts:[{phase:'paid',attemptId:paid.attemptId,order:paid.order}]},{attempts:null},{attempts:[{phase:'open',attemptId:paid.attemptId,order:paid.order}]}]) {
      const invalid=await insert(data);
      assert.match(JSON.stringify(await load({type:'block_action',action_id:'orders.import'})),/Orders unavailable/);
      assert.equal(opens(await load()),25);
      await carts.delete(invalid.id);
    }
    for(const value of [-1,1.5,'25']) assert.match(JSON.stringify(await load({type:'block_action',action_id:'orders.list',value})),/Orders unavailable/);
  } finally { await db.destroy(); }
});

test('Orders brings in paid orders automatically the first time it has no copies', async () => {
  const database = new BetterSqlite3(':memory:');
  database.exec('CREATE TABLE _plugin_storage (plugin_id TEXT, collection TEXT, id TEXT, data TEXT, revision TEXT, created_at TEXT, updated_at TEXT, PRIMARY KEY(plugin_id,collection,id))');
  const db = new Kysely({ dialect: new SqliteDialect({ database }) });
  const carts = new PluginStorageRepository(db, 'orders-proof', 'checkout_carts', []);
  const orders = new PluginStorageRepository(db, 'orders-proof', 'orders', []);
  try {
    const f = fixture(createCheckoutStore(carts), false);
    f.setPayment('paid');
    const paid = await startCheckout(f.execution, 'paid-cart', withSyntheticCheckoutContact(cart));
    assert.equal(await orders.get(paid.order.orderId), null);
    const page = await ordersBlocks({ user: { role: 50 }, ui: { surface: 'admin-page' }, input: {type:'page_load',page:'/orders'} },
      {storage:{orders}}, { paidOrders: () => listPaidOrders(carts) });
    assert.ok(JSON.stringify(page).includes(paid.order.orderId));
    assert.equal((await orders.get(paid.order.orderId)).paidOrder.orderId, paid.order.orderId);
  } finally { await db.destroy(); }
});
