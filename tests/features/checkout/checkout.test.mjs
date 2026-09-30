import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCheckout, reconcileCheckout } from '../../../dist/features/checkout/index.js';
import { openStore, fixture, cart } from './fixture.mjs';

function setup(t,managed=true) {
  const dir=mkdtempSync(join(tmpdir(),'checkout-contract-'));
  const path=join(dir,'store.sqlite'); const opened=openStore(path);
  t.after(() => { opened.db.close(); rmSync(dir,{recursive:true,force:true}); });
  return {...fixture(opened.store,managed),path,opened};
}

test('canonical sale price, duplicate lines, guest checkout and complete basket before redirect',async t => {
  const f=setup(t); const a=await startCheckout(f.execution,'guest-cart',[...cart,{catalogItemId:'one',quantity:1}]);
  assert.equal(a.payment.total.minor,'325'); assert.equal(a.payment.total.currency,'USD');
  assert.equal(a.phase,'paying'); assert.equal(a.session.expiresAt-a.session.createdAt,1800);
  assert.deepEqual(a.stock.requirements,[{skuId:'sku-one',quantity:3,allowBackorders:false},{skuId:'sku-two',quantity:1,allowBackorders:false}]);
  assert.equal(f.holds.size,1); assert.deepEqual(a.payment.paymentMethods,['card']);
});

test('concurrent start and durable restart reuse one reservation and one fixed session',async t => {
  const f=setup(t); const results=await Promise.all(Array.from({length:8},() => startCheckout(f.execution,'guest-cart',cart)));
  assert.equal(new Set(results.map(r => r.attemptId)).size,1); assert.equal(f.holds.size,1); assert.equal(f.sessions.size,1);
  const second=openStore(f.path); t.after(() => second.db.close()); f.setNow(1500);
  const restarted={...f.execution,store:second.store}; const a=await startCheckout(restarted,'guest-cart',cart);
  assert.deepEqual(a.session,results[0].session);
  f.setPayment('paid'); const paid=await reconcileCheckout(restarted,'guest-cart',a.attemptId);
  assert.equal(paid.phase,'paid'); assert.equal(paid.order.total.minor,'250');
  f.setPayment('expired-unpaid'); const duplicate=await reconcileCheckout(f.execution,'guest-cart',a.attemptId);
  assert.deepEqual(duplicate.order,paid.order); assert.equal(f.counts().releaseCalls,0);
});

test('local deadline and unknown payment never release; confirmed expiry releases then retry reprices',async t => {
  const f=setup(t); const a=await startCheckout(f.execution,'guest-cart',cart);
  f.setNow(3000); const elapsed=await startCheckout(f.execution,'guest-cart',cart);
  assert.equal(elapsed.session,undefined); assert.equal(f.counts().releaseCalls,0);
  f.setPayment('unknown'); assert.equal((await reconcileCheckout(f.execution,'guest-cart',a.attemptId)).phase,'paying');
  assert.equal(f.counts().releaseCalls,0);
  await assert.rejects(startCheckout(f.execution,'guest-cart',[{catalogItemId:'one',quantity:1}],a.attemptId),/frozen/);
  f.setPayment('expired-unpaid'); const released=await reconcileCheckout(f.execution,'guest-cart',a.attemptId);
  assert.equal(released.phase,'released'); assert.equal(f.holds.get(a.attemptId).state,'released');
  await assert.rejects(startCheckout(f.execution,'guest-cart',cart),/Retry requires/);
  f.execution.catalog.prices.records.get('one').sale.minor='50'; f.setPayment('open');
  const next=await startCheckout(f.execution,'guest-cart',cart,a.attemptId);
  assert.notEqual(next.attemptId,a.attemptId); assert.equal(next.payment.total.minor,'200');
  assert.equal((await reconcileCheckout(f.execution,'guest-cart',a.attemptId)).phase,'released');
  assert.equal((await f.execution.store.read('guest-cart')).record.attempts.length,2);
});

test('ambiguous stock commit resumes same operation; partial hold never produces a session',async t => {
  const f=setup(t); f.setStock('ambiguous'); const a=await startCheckout(f.execution,'guest-cart',cart);
  assert.equal(a.phase,'reserving'); assert.equal(f.sessions.size,0);
  f.setStock('reserved'); const resumed=await startCheckout(f.execution,'guest-cart',cart);
  assert.equal(resumed.attemptId,a.attemptId); assert.equal(f.holds.size,1); assert.equal(resumed.phase,'paying');
  const g=setup(t);g.setStock('partial'); const partial=await startCheckout(g.execution,'other-cart',cart);
  assert.equal(partial.phase,'reserving'); assert.equal(g.sessions.size,0);
  // Inventory reconciles/rolls back its partial work before declaring terminal rejection.
  g.holds.set(partial.attemptId,{state:'rejected'});
  assert.equal((await startCheckout(g.execution,'other-cart',cart)).phase,'released');
});

test('shortage and provider outage fail closed; unmanaged checkout invokes no Inventory operations',async t => {
  const f=setup(t); f.setStock('rejected'); assert.equal((await startCheckout(f.execution,'guest-cart',cart)).phase,'released');assert.equal(f.sessions.size,0);
  const g=setup(t);g.execution.resolveInventory=async () => null;
  assert.equal((await startCheckout(g.execution,'guest-cart',cart)).phase,'reserving');assert.equal(g.sessions.size,0);
  const u=setup(t,false);u.execution.resolveInventory=async () => {throw Error('must not call');};u.execution.availability.resolveProvider=async () => {throw Error('must not read');};
  assert.equal((await startCheckout(u.execution,'guest-cart',cart)).phase,'paying');assert.deepEqual(u.counts(),{reserveCalls:0,releaseCalls:0});
});

test('failed/ambiguous payment creation preserves holds until terminal creation fence or recovered session',async t => {
  const f=setup(t);f.setPayment('ambiguous');const a=await startCheckout(f.execution,'guest-cart',cart);
  assert.equal(a.phase,'paying');assert.equal(a.session,undefined);assert.equal(f.counts().releaseCalls,0);
  f.setNow(1500);f.setPayment('open');const recovered=await startCheckout(f.execution,'guest-cart',cart);
  assert.equal(recovered.session.createdAt,1000);assert.equal(f.sessions.size,1);
  const g=setup(t);g.setPayment('unknown'); const unknown=await startCheckout(g.execution,'guest-cart',cart);
  assert.equal(unknown.phase,'paying');assert.equal(g.counts().releaseCalls,0);
  g.setPayment('not-created'); assert.equal((await reconcileCheckout(g.execution,'guest-cart',unknown.attemptId)).phase,'released');assert.equal(g.counts().releaseCalls,1);
});

test('duplicate and out-of-order event hints race through authoritative paid state to one order',async t => {
  const f=setup(t);const a=await startCheckout(f.execution,'guest-cart',cart);f.setPayment('paid');
  const results=await Promise.all(Array.from({length:8},() => reconcileCheckout(f.execution,'guest-cart',a.attemptId)));
  assert.equal(new Set(results.map(r => r.order.orderId)).size,1);assert.equal(f.counts().releaseCalls,0);
  assert.deepEqual((await f.execution.store.read('guest-cart')).record.attempts[0].order,results[0].order);
});

test('release failure/restart remains retryable and blocks new checkout',async t => {
  const f=setup(t);const a=await startCheckout(f.execution,'guest-cart',cart);f.setPayment('expired-unpaid');
  const release=f.inventory.release;f.inventory.release=async () => 'unknown';
  assert.equal((await reconcileCheckout(f.execution,'guest-cart',a.attemptId)).phase,'releasing');
  assert.equal((await startCheckout(f.execution,'guest-cart',cart,a.attemptId)).phase,'releasing'); assert.equal(f.sessions.size,1);
  f.inventory.release=release;assert.equal((await reconcileCheckout(f.execution,'guest-cart',a.attemptId)).phase,'released');
});

test('reject browser totals, invalid quantities and mismatched authoritative payment identity/amount/window',async t => {
  const f=setup(t); await assert.rejects(startCheckout(f.execution,'guest-cart',[{...cart[0],total:'1'}]),/Invalid cart/);
  await assert.rejects(startCheckout(f.execution,'guest-cart',[{catalogItemId:'one',quantity:0}]),/Invalid cart/);
  const a=await startCheckout(f.execution,'guest-cart',cart);f.setPayment('paid');
  const lookup=f.execution.payments.lookup;
  for (const mutate of [r => ({...r,attemptId:'other'}),r => ({...r,total:{currency:'USD',minor:'1'}}),r => ({...r,session:{...r.session,expiresAt:r.session.expiresAt+1}})]) {
    f.execution.payments.lookup=async req => mutate(await lookup(req));
    await assert.rejects(reconcileCheckout(f.execution,'guest-cart',a.attemptId));
    assert.equal((await f.execution.store.read('guest-cart')).record.attempts[0].phase,'paying');
  }
  assert.equal(f.counts().releaseCalls,0);
});

test('independent processes converge on persisted providers, then a fresh process reconciles one durable order',async t => {
  const {fork}=await import('node:child_process'); const {durableFixture}=await import('./fixture.mjs');
  const f=setup(t);const durable=durableFixture(f.path);t.after(() => durable.db.close());
  async function run(mode,id,count=2) {
    const children=Array.from({length:count},() => fork(new URL('./process-worker.mjs',import.meta.url),[f.path,mode,...(id ? [id] : [])],{stdio:['ignore','ignore','pipe','ipc']}));
    const promises=children.map(child => new Promise((resolve,reject) => {
      let stderr='';child.stderr.on('data',chunk => stderr+=chunk);
      child.on('error',reject);child.on('exit',code => {if(code) reject(Error(stderr));});
      child.on('message',message => {if(message.type === 'ready') child.send('go');else if(message.error) reject(Error(message.error));else if(message.type === 'result') resolve(message.result);});
    }));
    return Promise.all(promises);
  }
  const started=await run('start');assert.equal(started[0].attemptId,started[1].attemptId);
  assert.equal(durable.db.prepare("SELECT count(*) AS n FROM effects WHERE kind='hold'").get().n,1);
  assert.equal(durable.db.prepare("SELECT count(*) AS n FROM effects WHERE kind='session'").get().n,1);
  durable.insert('payment',started[0].attemptId,{state:'paid'});
  const paid=await run('reconcile',started[0].attemptId);assert.deepEqual(paid[0].order,paid[1].order);
  const restarted=await run('reconcile',started[0].attemptId,1);assert.deepEqual(restarted[0].order,paid[0].order);
  assert.equal(durable.get('hold',started[0].attemptId).state,'reserved');
});

test('payment binding is frozen across configuration changes and missing old adapter preserves uncertainty',async t => {
  const f=setup(t); const a=await startCheckout(f.execution,'guest-cart',cart);
  f.execution.paymentBindingRef='replacement-binding';
  assert.equal((await startCheckout(f.execution,'guest-cart',cart)).payment.bindingRef,'stripe-test-binding');
  f.execution.resolvePayments=async () => null;
  assert.equal((await reconcileCheckout(f.execution,'guest-cart',a.attemptId)).phase,'paying');
  assert.equal(f.counts().releaseCalls,0);
});

test('stale open lookup racing a payment confirmation cannot overwrite the paid receipt',async t => {
  const f=setup(t);const a=await startCheckout(f.execution,'guest-cart',cart);
  let resume, captured; const blocked=new Promise(r => captured=r), gate=new Promise(r => resume=r);
  const original=f.execution.payments.lookup;let first=true;
  f.execution.payments.lookup=async request => {
    if(first) {first=false;const stale=await original(request);captured();await gate;return stale;}
    return original(request);
  };
  const stale=reconcileCheckout(f.execution,'guest-cart',a.attemptId);await blocked;
  f.setPayment('paid');const paid=await reconcileCheckout(f.execution,'guest-cart',a.attemptId);resume();
  assert.deepEqual((await stale).order,paid.order);assert.equal(f.counts().releaseCalls,0);
});

test('a known payment session cannot be released by a contradictory not-created response',async t => {
  const f=setup(t);const a=await startCheckout(f.execution,'guest-cart',cart);f.setPayment('not-created');
  await assert.rejects(reconcileCheckout(f.execution,'guest-cart',a.attemptId),/Known payment session/);
  assert.equal(f.counts().releaseCalls,0);
});

test('a recovered expired open session persists so restart cannot release on contradictory not-created',async t => {
  const f=setup(t);f.setPayment('ambiguous');const a=await startCheckout(f.execution,'guest-cart',cart);
  assert.equal(a.phase,'paying');assert.equal(a.session,undefined);
  assert.equal((await f.execution.store.read('guest-cart')).record.attempts[0].session,undefined);
  f.setNow(2801);f.setPayment('open');const recovered=await startCheckout(f.execution,'guest-cart',cart);
  assert.equal(recovered.phase,'paying');assert.equal(recovered.session,undefined);assert.equal(f.counts().releaseCalls,0);
  const original=f.sessions.get(a.attemptId).session;
  const persisted=(await f.execution.store.read('guest-cart')).record.attempts[0].session;
  assert.deepEqual(persisted,original);assert.equal(persisted.sessionId,original.sessionId);
  assert.equal(persisted.createdAt,1000);assert.equal(persisted.expiresAt,2800);
  const restarted=openStore(f.path);t.after(() => restarted.db.close());
  f.setPayment('not-created');
  await assert.rejects(reconcileCheckout({...f.execution,store:restarted.store},'guest-cart',a.attemptId),/Known payment session/);
  const after=(await restarted.store.read('guest-cart')).record.attempts[0];
  assert.equal(after.phase,'paying');assert.deepEqual(after.session,original);
  assert.equal(f.holds.get(a.attemptId).state,'reserved');assert.equal(f.counts().releaseCalls,0);
});
