import assert from 'node:assert/strict';
import test from 'node:test';
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { PluginStorageRepository } from 'emdash';
import { ordersBlocks } from '../../dist/admin/orders-blocks.js';
import { createCheckoutStore, startCheckout } from '../../dist/features/checkout/index.js';
import { fixture, cart, withSyntheticCheckoutContact } from '../features/checkout/fixture.mjs';

// The real repository owns cursor encoding and row envelopes; projection-only
// tests cannot detect a controller reading the wrong namespace or losing pages.
test('Orders reads canonical completed checkout records across SQLite pages without writes', async () => {
  const database = new BetterSqlite3(':memory:');
  database.exec('CREATE TABLE _plugin_storage (plugin_id TEXT, collection TEXT, id TEXT, data TEXT, revision TEXT, created_at TEXT, updated_at TEXT, PRIMARY KEY(plugin_id,collection,id))');
  const db = new Kysely({ dialect: new SqliteDialect({ database }) });
  const collection = new PluginStorageRepository(db, 'orders-proof', 'checkout_carts', []);
  let sequence = 0;
  const insert = async data => { const id='fixture-'+sequence++; assert.equal((await collection.compareAndSet(id,null,data)).applied,true); return {id}; };
  const route = input => ({ user: { role: 50 }, ui: { surface: 'admin-page' }, input });
  const load = input => ordersBlocks(route(input ?? {type:'page_load',page:'/orders'}), {storage:{checkout_carts:collection}});
  const serialized = () => database.prepare('SELECT * FROM _plugin_storage ORDER BY id').all();
  const buttons = response => response.blocks.flatMap(b => b.type === 'actions' ? b.elements : []);
  try {
    assert.match(JSON.stringify(await load()), /No orders recorded yet/);
    const f = fixture(createCheckoutStore(collection), false);
    f.setPayment('paid');
    const paid = await startCheckout(f.execution, 'paid-cart', withSyntheticCheckoutContact(cart));
    assert.equal(paid.phase, 'paid');
    for (const price of f.execution.catalog.prices.records.values()) { price.regular.minor='0'; delete price.sale; }
    const free = await startCheckout(f.execution, 'free-cart', withSyntheticCheckoutContact(cart));
    assert.equal(free.phase, 'paid');
    assert.equal(free.order.total.minor, '0');
    // Empty aggregates exceed one storage page; all must be traversed.
    for (let i=0;i<105;i++) await insert({attempts:[]});
    const before = serialized();
    const list = await load();
    assert.equal(buttons(list).filter(b=>b.action_id.startsWith('orders.open:')).length,2);
    for (const [order, kind] of [[paid.order,'Provider-paid'],[free.order,'Zero payable']]) {
      const detail = JSON.stringify(await load({type:'block_action',action_id:'orders.open:'+encodeURIComponent(order.orderId)}));
      for (const expected of [order.orderId,order.receiptId,order.attemptId,kind,'Not recorded','Back to orders']) assert.ok(detail.includes(expected),expected);
    }
    assert.deepEqual(serialized(),before);
    // Distinct canonical historical records exercise the 25-row UI boundary.
    for(let i=0;i<26;i++) await insert({attempts:[{phase:'paid',attemptId:'history-'+i,order:{...paid.order,attemptId:'history-'+i,orderId:'historical-'+String(i).padStart(2,'0')}}]});
    const first=await load();
    assert.equal(buttons(first).filter(b=>b.action_id.startsWith('orders.open:')).length,25);
    const next=buttons(first).find(b=>b.label==='Next');
    const second=await load({type:'block_action',action_id:next.action_id,value:next.value});
    assert.equal(buttons(second).filter(b=>b.action_id.startsWith('orders.open:')).length,3);
    assert.ok(buttons(second).some(b=>b.label==='Previous'));
    for(const data of [{attempts:[{phase:'paid',attemptId:paid.attemptId,order:paid.order}]},{attempts:null},{attempts:[{phase:'open',attemptId:paid.attemptId,order:paid.order}]}]) {
      const invalid=await insert(data);
      assert.match(JSON.stringify(await load()),/Orders unavailable/);
      await collection.delete(invalid.id);
    }
    for(const value of [-1,1.5,'25']) assert.match(JSON.stringify(await load({type:'block_action',action_id:'orders.list',value})),/Orders unavailable/);
  } finally { await db.destroy(); }
});
