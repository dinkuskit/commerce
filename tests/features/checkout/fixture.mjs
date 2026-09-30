import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createCheckoutStore } from '../../../dist/features/checkout/index.js';

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS checkout (id TEXT PRIMARY KEY, revision TEXT NOT NULL, value TEXT NOT NULL)');
  return { db, store: createCheckoutStore({
    async getVersioned(id) {
      const row = db.prepare('SELECT revision,value FROM checkout WHERE id=?').get(id);
      return row ? { revision: row.revision, value: JSON.parse(row.value) } : null;
    },
    async compareAndSet(id, revision, value) {
      const result = revision === null
        ? db.prepare('INSERT INTO checkout VALUES (?,?,?) ON CONFLICT(id) DO NOTHING').run(id,randomUUID(),JSON.stringify(value))
        : db.prepare('UPDATE checkout SET revision=?,value=? WHERE id=? AND revision=?').run(randomUUID(),JSON.stringify(value),id,revision);
      return { applied: result.changes === 1 };
    },
  }) };
}
const collection = records => ({
  records: new Map(records.map(r => [r.recordId ?? r.itemId,r])),
  async get(id) { return structuredClone(this.records.get(id) ?? null); },
  async query() { return { items: [...this.records].map(([id,data]) => ({id,data:structuredClone(data)})), hasMore:false }; },
});
export const cart = [{catalogItemId:'one',quantity:2},{catalogItemId:'two',quantity:1}];
export function fixture(store, managed = true) {
  const items = ['one','two'].map(id => ({recordKind:'catalog-item',itemId:id,name:id,stockManagement:managed ? {mode:'managed',status:'active',inventorySkuId:'sku-'+id} : {mode:'unmanaged'}}));
  const catalog = {
    catalog:collection(items), prices:collection(['one','two'].map(id => ({recordKind:'catalog-price',recordId:id,catalogItemId:id,regular:{currency:'USD',minor:'100'},...(id === 'one' ? {sale:{currency:'USD',minor:'75'}} : {})}))),
    backorderPolicies:collection([]), settings:collection([]), manualAvailability:collection([]),
    configurations:collection([{recordKind:'store-inventory-configuration',recordId:'config',configurationKey:'active',siteId:'site-test',binding:{providerRef:'inventory-test',poolId:'pool-test',defaultFulfillmentLocationId:'location-test'},configuredAt:'2026-01-01',updatedAt:'2026-01-01'}]),
  };
  const holds = new Map(), sessions = new Map();
  let now = 1000, sessionDuration = 1800, stockResult = 'reserved', paymentResult = 'open', reserveCalls = 0, releaseCalls = 0;
  const inventory = {
    async reserve(request) {
      reserveCalls++;
      const existing = holds.get(request.operationId);
      if (existing) return existing.state === 'released' ? 'rejected' : existing.state;
      if (stockResult === 'reserved') holds.set(request.operationId,{state:'reserved',request:structuredClone(request)});
      if (stockResult === 'ambiguous') { holds.set(request.operationId,{state:'reserved',request:structuredClone(request)}); throw Error('connection lost after complete basket reservation'); }
      if (stockResult === 'partial') { holds.set(request.operationId,{state:'partial',request:structuredClone(request)}); return 'unknown'; }
      return stockResult;
    },
    async release(request) { releaseCalls++; holds.set(request.operationId,{state:'released',request:structuredClone(request)}); return 'released'; },
  };
  async function lookup(request, create) {
    let entry = sessions.get(request.attemptId);
    if (!entry && create && paymentResult !== 'unknown' && paymentResult !== 'not-created') {
      entry = {request:structuredClone(request),session:{sessionId:'session-'+request.attemptId,redirectUrl:'https://checkout.stripe.com/test',createdAt:now,expiresAt:now+sessionDuration}};
      sessions.set(request.attemptId,entry);
      if (paymentResult === 'ambiguous') throw Error('connection lost after session creation');
    }
    if (paymentResult === 'unknown' || !entry && paymentResult !== 'not-created') return {outcome:'unknown'};
    if (paymentResult === 'not-created') return {outcome:'not-created',attemptId:request.attemptId};
    return {outcome:paymentResult === 'ambiguous' ? 'open' : paymentResult,attemptId:request.attemptId,total:entry.request.total,session:entry.session,...(paymentResult === 'paid' ? {paymentId:'payment-'+request.attemptId} : {})};
  }
  const execution = { store,catalog,availability:{resolveProvider: async () => ({async readSkuStock(input) {
    const stock = Object.fromEntries(['onHand','reserved','outgoingTransferCommitted','available','expected','inTransit'].map(key => [key,{value:key === 'available' || key === 'onHand' ? '10' : '0',unit:'each'}]));
    return {schema:'dinkuskit.inventory.sku-stock-read-result/v1',outcome:'found',...input,stock,locations:[{locationId:input.scope.locationId,name:'Test location',stock}]};
  }})},resolveInventory:async () => inventory,payments:{ensureSession:r => lookup(r,true),lookup:r => lookup(r,false)},paymentBindingRef: 'stripe-test-binding',now:() => now };
  execution.resolvePayments=async ref => ref === 'stripe-test-binding' ? execution.payments : null;
  return {execution,holds,sessions,inventory,setNow:v => now=v,setSessionDuration:v => sessionDuration=v,setStock:v => stockResult=v,setPayment:v => paymentResult=v,counts:() => ({reserveCalls,releaseCalls})};
}

/** Persisted fake external operations shared by independent worker processes. */
export function durableFixture(path) {
  const opened=openStore(path), db=opened.db, f=fixture(opened.store);
  db.exec('CREATE TABLE IF NOT EXISTS effects (kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind,id))');
  const get=(kind,id) => { const row=db.prepare('SELECT value FROM effects WHERE kind=? AND id=?').get(kind,id);return row ? JSON.parse(row.value) : null; };
  const insert=(kind,id,value) => db.prepare('INSERT INTO effects VALUES (?,?,?) ON CONFLICT(kind,id) DO NOTHING').run(kind,id,JSON.stringify(value));
  f.execution.resolveInventory=async () => ({
    async reserve(r) { insert('hold',r.operationId,{request:r,state:'reserved'}); return get('hold',r.operationId).state === 'reserved' ? 'reserved' : 'rejected'; },
    async release(r) { db.prepare('UPDATE effects SET value=? WHERE kind=? AND id=?').run(JSON.stringify({request:r,state:'released'}),'hold',r.operationId);return 'released'; },
  });
  const result=r => {
    const session=get('session',r.attemptId);
    return session ? {outcome:get('payment',r.attemptId)?.state ?? 'open',attemptId:r.attemptId,total:session.request.total,session:session.session,paymentId:'payment-'+r.attemptId} : {outcome:'unknown'};
  };
  f.execution.payments={async ensureSession(r) {
    insert('session',r.attemptId,{request:r,session:{sessionId:'session-'+r.attemptId,redirectUrl:'https://checkout.stripe.com/test',createdAt:1000,expiresAt:2800}});
    return result(r);
  }, async lookup(r) {return result(r);} };
  return {...f,db,get,insert,store:opened.store};
}
