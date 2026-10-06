import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { PluginStorageRepository } from 'emdash';
import { couponBlocks } from '../dist/admin/coupons-blocks.js';
import { createCouponAdminPorts, createCoupon, editCoupon } from '../dist/admin/coupons-controller.js';

const form = { code:'WELCOME', discountKind:'percentage', discountValue:'12.5', usageLimit:'4',
  startsAt:'2026-01-01T00:00:00Z', endsAt:'2027-01-01T00:00:00Z', timeZone:'America/Los_Angeles' };
const route = input => ({ user:{role:50}, ui:{surface:'admin-page',locale:'en',direction:'ltr'}, input });
async function fixture(t) {
  const database = new Database(':memory:');
  database.exec(`CREATE TABLE _plugin_storage (plugin_id TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL,
    data TEXT NOT NULL, revision TEXT NOT NULL DEFAULT '0', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (plugin_id, collection, id));
    CREATE UNIQUE INDEX coupon_code_uq ON _plugin_storage(plugin_id, collection, json_extract(data, '$.normalizedCode')) WHERE collection='coupons';`);
  const db = new Kysely({dialect:new SqliteDialect({database})});
  t.after(() => db.destroy());
  const coupons = new PluginStorageRepository(db,'dinkus-commerce','coupons',['normalizedCode']);
  return { coupons, ctx:{storage:{coupons}}, ports:createCouponAdminPorts({coupons}) };
}

test('coupon handler rejects untrusted input privileges before touching storage', async () => {
  const ctx = {get storage() {throw new Error('Denied requests must not access storage');}};
  for (const host of [ {user:{role:40},ui:{surface:'admin-page'}}, {user:undefined,ui:{surface:'admin-page'}},
    {user:{role:50},ui:undefined}, {user:{role:'invalid'},ui:{surface:'admin-page'}} ]) {
    const response = await couponBlocks({...host,input:{type:'form_submit',action_id:'coupon.create:new',values:form,
      user:{role:50},permissions:['plugins:manage'],ui:{surface:'admin-page'}}},ctx);
    assert.equal(response.toast.type,'error');
    assert.equal(response.blocks[0].title,'Coupons require plugins:manage');
  }
});

test('stale coupon draft retains its original CAS token and cannot overwrite current values', async t => {
  const f = await fixture(t);
  const original = await createCoupon(f.ports,form);
  await editCoupon(f.ports,{...form,code:'CONCURRENT',couponId:original.couponId,expectedRevision:original.revision});
  const action_id = `coupon.save:${original.couponId}:${original.revision}`;
  const input = {type:'form_submit',action_id,values:{...form,code:'DRAFT'}};
  for (let attempt=0; attempt<2; attempt++) {
    const response=await couponBlocks(route(input),f.ctx);
    assert.equal(response.toast.type,'error');
    const rendered=response.blocks.find(block=>block.type==='form');
    assert.equal(rendered.submit.action_id,action_id);
    assert.equal(rendered.fields.find(field=>field.action_id==='code').initial_value,'DRAFT');
    assert.equal((await f.coupons.get(original.couponId)).code,'CONCURRENT');
  }
});

test('large fixed amounts render as exact merchant units without floating point rounding', async t => {
  const f=await fixture(t);
  const created=await createCoupon(f.ports,{...form,discountKind:'fixed',discountValue:'90071992547409.91'});
  assert.equal(created.rule.discount.amount.minor,'9007199254740991');
  const response=await couponBlocks(route({type:'block_action',action_id:'coupon.open',value:created.couponId}),f.ctx);
  assert.equal(response.blocks.find(block=>block.type==='form').fields.find(field=>field.action_id==='discountValue').initial_value,'90071992547409.91');
});

test('a disable action cannot be replayed as an edit form', async t => {
  const f = await fixture(t);
  const created = await createCoupon(f.ports, form);
  const response = await couponBlocks(route({ type: 'form_submit', action_id: `coupon.disable:${created.couponId}:${created.revision}`,
    values: { ...form, code: 'FORGED-EDIT' } }), f.ctx);
  assert.equal(response.toast.type, 'error');
  assert.deepEqual(await f.coupons.get(created.couponId), created);
});
