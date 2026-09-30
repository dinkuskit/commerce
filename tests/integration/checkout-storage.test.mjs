import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { PluginStorageRepository } from 'emdash';
import { CHECKOUT_COLLECTION, createCheckoutStore, startCheckout, reconcileCheckout } from '../../dist/features/checkout/index.js';
import { COMMERCE_PLUGIN_ID } from '../../dist/features/catalog/index.js';
import { initializeCatalogDatabase } from './sqlite-fixture.mjs';
import { fixture, cart } from '../features/checkout/fixture.mjs';

function open(path) {
  const database=new BetterSqlite3(path);database.pragma('journal_mode = WAL');database.pragma('busy_timeout = 5000');
  const db=new Kysely({dialect:new SqliteDialect({database})});
  return {db,store:createCheckoutStore(new PluginStorageRepository(db,COMMERCE_PLUGIN_ID,CHECKOUT_COLLECTION,[]))};
}

test('checkout CAS and order receipt survive exact EmDash repository connection reopen',async () => {
  const dir=await mkdtemp(join(tmpdir(),'checkout-emdash-'));const path=join(dir,'commerce.sqlite');
  const connections=[];
  try {
    initializeCatalogDatabase(path,[]);
    const left=open(path),right=open(path);connections.push(left,right);
    const f=fixture(left.store);
    const [a,b]=await Promise.all([startCheckout(f.execution,'guest-cart',cart),startCheckout({...f.execution,store:right.store},'guest-cart',cart)]);
    assert.equal(a.attemptId,b.attemptId);assert.equal(f.holds.size,1);assert.equal(f.sessions.size,1);
    f.setPayment('paid');const paid=await reconcileCheckout(f.execution,'guest-cart',a.attemptId);
    await left.db.destroy();connections.splice(connections.indexOf(left),1);
    await right.db.destroy();connections.splice(connections.indexOf(right),1);
    const reopened=open(path);connections.push(reopened);
    const recovered=await reconcileCheckout({...f.execution,store:reopened.store},'guest-cart',a.attemptId);
    assert.deepEqual(recovered.order,paid.order);assert.equal(f.counts().releaseCalls,0);
  } finally {for(const c of connections) await c.db.destroy();await rm(dir,{recursive:true,force:true});}
});
