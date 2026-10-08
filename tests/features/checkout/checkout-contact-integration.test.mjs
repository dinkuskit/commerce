import assert from "node:assert/strict";
import test from "node:test";

import {
  projectGuestCheckout,
  reconcileCheckout,
  startCheckout,
} from "../../../dist/features/checkout/index.js";
import { openStore, fixture } from "./fixture.mjs";

function contact(email, phone = "555 0101") {
  return { email, phone };
}

function checkoutFixture() {
  const opened = openStore(":memory:");
  const f = fixture(opened.store, false);
  f.execution.createAttemptId = (() => {
    let next = 0;
    return () => `attempt-${++next}`;
  })();
  f.execution.loadCheckoutContactRequirements = async () => ({
    requirePhoneNumber: false,
    revision: "contact-rev-1",
  });
  return { opened, f };
}

test("captures contact after admission, freezes it through CAS, and copies it to the order without projecting PII", async (t) => {
  const { opened, f } = checkoutFixture();
  t.after(() => opened.db.close());

  const draft = contact("guest@example.test");
  const started = await startCheckout(
    f.execution,
    "contact-cart",
    { lines: [{ catalogItemId: "one", quantity: 1 }], contact: draft },
  );
  assert.deepEqual(started.contactSnapshot.contact, contact("guest@example.test"));
  assert.equal(Object.isFrozen(started.contactSnapshot), true);
  assert.equal(Object.isFrozen(started.contactSnapshot.contact), true);
  assert.equal(started.payment.total.minor, "75");

  draft.email = "changed@example.test";
  f.execution.loadCheckoutContactRequirements = async () => ({
    requirePhoneNumber: true,
    revision: "changed-revision",
  });
  f.execution.catalog.prices.records.set("one", {
    recordKind: "catalog-price",
    recordId: "one",
    catalogItemId: "one",
    regular: { currency: "USD", minor: "9999" },
  });
  f.setPayment("paid");
  const paid = await reconcileCheckout(f.execution, "contact-cart", started.attemptId);
  assert.deepEqual(paid.order.contactSnapshot, started.contactSnapshot);
  assert.equal(paid.payment.total.minor, "75");
  assert.equal(paid.order.total.minor, "75");
  assert.equal(JSON.stringify(projectGuestCheckout(paid)).includes("guest@example.test"), false);
  assert.equal(JSON.stringify(projectGuestCheckout(paid)).includes("555 0101"), false);
});

test("authoritative phone flag is reread for new checkout and forged client policy is denied", async (t) => {
  const { opened, f } = checkoutFixture();
  t.after(() => opened.db.close());

  f.execution.loadCheckoutContactRequirements = async () => ({
    requirePhoneNumber: true,
    revision: "phone-on",
  });
  await assert.rejects(
    startCheckout(f.execution, "phone-cart", {
      lines: [{ catalogItemId: "one", quantity: 1 }],
      contact: { email: "guest@example.test" },
    }),
    (error) => error?.code === "PHONE_REQUIRED",
  );
  await assert.rejects(
    startCheckout(f.execution, "forged-policy-cart", {
      lines: [{ catalogItemId: "one", quantity: 1 }],
      contact: { ...contact("guest@example.test"), requirePhoneNumber: false },
    }),
    (error) => error?.code === "INVALID_INPUT",
  );

  f.execution.loadCheckoutContactRequirements = async () => ({
    requirePhoneNumber: false,
    revision: "phone-off",
  });
  const optional = await startCheckout(f.execution, "phone-off-cart", {
    lines: [{ catalogItemId: "one", quantity: 1 }],
    contact: { email: "guest@example.test" },
  });
  assert.equal(optional.contactSnapshot.requirePhoneNumber, false);
});

test("missing loader fails before payment and concurrent writers leave one winning contact snapshot", async (t) => {
  const { opened, f } = checkoutFixture();
  t.after(() => opened.db.close());

  const paymentCalls = [];
  f.execution.loadCheckoutContactRequirements = undefined;
  f.execution.resolvePayments = async () => ({
    async ensureSession(request) {
      paymentCalls.push(request);
      return { outcome: "unknown" };
    },
    async lookup() {
      return { outcome: "unknown" };
    },
  });
  await assert.rejects(
    startCheckout(f.execution, "unavailable-cart", {
      lines: [{ catalogItemId: "one", quantity: 1 }],
      contact: contact("guest@example.test"),
    }),
    (error) => error.code === 'REQUIREMENTS_UNAVAILABLE',
  );
  assert.equal(paymentCalls.length, 0);

  f.execution.loadCheckoutContactRequirements = async () => ({
    requirePhoneNumber: false,
    revision: "race",
  });
  const results = await Promise.all([
    startCheckout(f.execution, "race-cart", {
      lines: [{ catalogItemId: "one", quantity: 1 }],
      contact: contact("first@example.test"),
    }),
    startCheckout(f.execution, "race-cart", {
      lines: [{ catalogItemId: "one", quantity: 1 }],
      contact: contact("second@example.test"),
    }),
  ]);
  const stored = await opened.store.read("race-cart");
  assert.equal(stored.record.attempts.length, 1);
  assert.equal(
    stored.record.attempts[0].contactSnapshot.contact.email,
    results[0].contactSnapshot.contact.email,
  );
  assert.ok(["first@example.test", "second@example.test"].includes(
    stored.record.attempts[0].contactSnapshot.contact.email,
  ));
});

test("new attempt after a released legacy original requires contact authority without rewriting the original", async (t) => {
  const { opened, f } = checkoutFixture();
  t.after(() => opened.db.close());

  f.execution.loadCheckoutContactRequirements = undefined;
  const legacy = {
    attemptId: "legacy-attempt",
    cart: [{ catalogItemId: "one", quantity: 1 }],
    payment: {
      attemptId: "legacy-attempt",
      bindingRef: "stripe-test-binding",
      lines: [{ catalogItemId: "one", quantity: 1, name: "one", unitPrice: { currency: "USD", minor: "75" } }],
      total: { currency: "USD", minor: "75" },
      paymentMethods: ["card"],
      paymentWindowSeconds: 1800,
    },
    phase: "released",
  };
  await opened.store.compareAndSet("legacy-cart", null, { attempts: [legacy] });
  await assert.rejects(startCheckout(f.execution, "legacy-cart", [{ catalogItemId: "one", quantity: 1 }], "legacy-attempt"), (error) => error.code === 'REQUIREMENTS_UNAVAILABLE');
  assert.equal(f.sessions.size, 0);
  assert.deepEqual((await opened.store.read('legacy-cart')).record.attempts, [legacy]);
  f.execution.loadCheckoutContactRequirements = async () => ({ requirePhoneNumber: false, revision: null });
  const retried = await startCheckout(f.execution, 'legacy-cart', { lines: legacy.cart, contact: { email: 'new@example.test' } }, 'legacy-attempt');
  assert.equal(retried.contactSnapshot.contact.email, 'new@example.test');
  assert.deepEqual((await opened.store.read('legacy-cart')).record.attempts[0], legacy);

});

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSettingsAccess } from 'emdash';
import { OptionsRepository } from 'emdash/internal/plugins/host';
import { saveMerchantStoreSettings, loadCheckoutContactRequirements } from '../../../dist/features/store-settings/kernel/index.js';
import { initializeGuestCheckoutDatabase, openGuestCollections, seedGuestCatalog, syntheticCheckoutHost, injectedPluginRoutes, prepareGuest, invokeGuest, GUEST_CHECKOUT_PREPARE_ROUTE, GUEST_CHECKOUT_START_ROUTE, guestCheckoutStatusRoute } from './guest-dispatch.mjs';

async function nativeContactFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'commerce-contact-'));
  const path = join(directory, 'test.db');
  initializeGuestCheckoutDatabase(path);
  const opened = openGuestCollections(path);
  await opened.db.schema.createTable('options').addColumn('name','text',c=>c.primaryKey()).addColumn('value','text',c=>c.notNull()).addColumn('revision','text',c=>c.notNull()).execute();
  const settings = createSettingsAccess(new OptionsRepository(opened.db), 'dinkus-commerce', {});
  await seedGuestCatalog(opened.storage);
  const synth = syntheticCheckoutHost({ managed: false, host: { loadCheckoutContactRequirements: async () => ({requirePhoneNumber:false, revision:'forged-host'}) } });
  const routes = injectedPluginRoutes(synth.host).routes;
  t.after(async () => { await opened.db.destroy(); rmSync(directory,{recursive:true,force:true}); });
  return { ...opened, settings, synth, routes };
}

test('native routes use real plugin settings, hint outside status schema, reread changed phone requirement before provider', async t => {
  const f = await nativeContactFixture(t);
  const prepared = await prepareGuest(f.routes[GUEST_CHECKOUT_PREPARE_ROUTE], f.storage, { settings:f.settings });
  assert.deepEqual(prepared.contactRequirements, {requirePhoneNumber:false});
  assert.equal('contactRequirements' in prepared.checkout, false);
  assert.equal('revision' in prepared.contactRequirements, false);
  const token = prepared.capability.capability;
  const changed = await saveMerchantStoreSettings(f.settings, {expectedRevision:null,requirePhoneNumber:true});
  assert.deepEqual(await loadCheckoutContactRequirements(f.settings), {requirePhoneNumber:true,revision:changed.revision});
  const body={lines:[{catalogItemId:'hat',quantity:1}],contact:{email:'shopper@example.test'}};
  await assert.rejects(invokeGuest(f.routes[GUEST_CHECKOUT_START_ROUTE], f.storage, body, {capability:token,settings:f.settings}), e=>e.code==='INVALID_CART');
  assert.equal(f.synth.counts().paymentCreates,0);
  assert.deepEqual((await f.storage.checkoutCarts.query()).items, []);
  const result=await invokeGuest(f.routes[GUEST_CHECKOUT_START_ROUTE], f.storage, {...body,contact:{...body.contact,phone:'555 0123'}}, {capability:token,settings:f.settings});
  assert.equal(result.ok,true);
  const snapshot=(await f.storage.checkoutCarts.query()).items[0].data.attempts[0].contactSnapshot;
  assert.equal(snapshot.requirePhoneNumber,true);
  assert.equal(snapshot.revision,changed.revision);
  assert.deepEqual(snapshot.contact,{email:'shopper@example.test',phone:'555 0123'});
  assert.equal(JSON.stringify(result).includes('shopper@example.test'),false);
  const payment=f.synth.sessions.values().next().value.request;
  assert.equal('contactSnapshot' in payment,false);
  assert.equal(JSON.stringify(payment).includes('shopper@example.test'),false);
  await saveMerchantStoreSettings(f.settings,{expectedRevision:changed.revision,requirePhoneNumber:false});
  const brokenSettings={async getVersioned(){throw Error('PII vendor internal error shopper@example.test');}};
  const replay=await invokeGuest(f.routes[GUEST_CHECKOUT_START_ROUTE],f.storage,{...body,contact:{email:'changed@example.test'}},{capability:token,settings:brokenSettings});
  assert.equal(replay.checkout.attemptId,result.checkout.attemptId);
  f.synth.setPayment('paid');
  const paid=await invokeGuest(f.routes['checkout/guest/status'],f.storage,{}, {capability:token,settings:brokenSettings});
  assert.equal(paid.checkout.state,'paid');
  const frozen=(await f.storage.checkoutCarts.query()).items[0].data.attempts[0];
  assert.deepEqual(frozen.contactSnapshot,snapshot);
  assert.deepEqual(frozen.order.contactSnapshot,snapshot);
  assert.deepEqual(frozen.order.total,payment.total);
  assert.equal(JSON.stringify(paid).includes('shopper@example.test'),false);
  assert.equal(JSON.stringify(paid).includes('555 0123'),false);
});

test('native guest contact denies missing email and cross-cart injection, corrupt prepare exposes neither PII nor optional promise', async t => {
  const f=await nativeContactFixture(t);
  const prepared=await prepareGuest(f.routes[GUEST_CHECKOUT_PREPARE_ROUTE],f.storage,{settings:f.settings});
  const token=prepared.capability.capability;
  for(const contact of [undefined,{email:''},{email:'bad@'},{email:'a@example.test',requirePhoneNumber:false}]) {
    await assert.rejects(invokeGuest(f.routes[GUEST_CHECKOUT_START_ROUTE],f.storage,{lines:[{catalogItemId:'hat',quantity:1}],...(contact===undefined?{}:{contact})},{capability:token,settings:f.settings}),e=>e.code==='INVALID_CART');
  }
  await assert.rejects(invokeGuest(f.routes[GUEST_CHECKOUT_START_ROUTE],f.storage,{cartId:'other-cart',lines:[{catalogItemId:'hat',quantity:1}],contact:{email:'a@example.test'}},{capability:token,settings:f.settings}),e=>e.code==='INVALID_CART');
  await assert.rejects(invokeGuest(f.routes[GUEST_CHECKOUT_START_ROUTE],f.storage,{lines:[{catalogItemId:'hat',quantity:1}],contact:{email:'a@example.test'}},{capability:'guessed.token',settings:f.settings}),e=>e.code==='CAPABILITY_DENIED');
  assert.equal(f.synth.counts().paymentCreates,0);
  assert.deepEqual((await f.storage.checkoutCarts.query()).items,[]);
  await f.settings.set('merchantStoreSettings',{recordKind:'merchant-store-settings',requirePhoneNumber:'false'});
  await assert.rejects(prepareGuest(f.routes[GUEST_CHECKOUT_PREPARE_ROUTE],f.storage,{settings:f.settings}),e=>e.code==='UNAVAILABLE'&&!e.message.includes('a@example.test'));
  assert.equal((await f.storage.checkoutGuestCapabilities.query()).items.length,1);
});
