import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CHECKOUT_COLLECTION,
  CHECKOUT_GUEST_CAPABILITY_COLLECTION,
  GUEST_CAPABILITY_HEADER,
  cartGuestCheckout,
  prepareGuestCheckout,
  startGuestCheckout,
} from "../../../dist/features/checkout/index.js";
import { addCatalogVariantOption, createCatalogItem, saveCatalogProductPrices } from "../../../dist/features/catalog/kernel/index.js";
import { completeOrder, createPaidOrderReceiver, reopenOrder } from "../../../dist/features/orders/index.js";
import {
  TRUSTED_SITE,
  initializeGuestCheckoutDatabase,
  openGuestCollections,
  seedGuestCatalog,
  syntheticCheckoutHost,
} from "./guest-dispatch.mjs";

const DAY = 86_400;
const contact = { email: "cart-fixture@example.test", billing: { name: "Bill Payer", line1: "9 Billing Way", city: "Billtown", postalCode: "00009", country: "US" } };

/** An in-memory versioned collection, for catalog records written by the catalog kernel. */
function memory() {
  const records = new Map(), revisions = new Map();
  return {
    async get(id) { return structuredClone(records.get(id) ?? null); },
    async getVersioned(id) { const value = await this.get(id); return value ? { value, revision: revisions.get(id) } : null; },
    async put(id, value) {
      // Catalog writes check that its unique indexes are live, as SQLite's are.
      for (const [key, other] of records) for (const field of ["commandId", "skuKey"]) {
        if (key !== id && value[field] !== undefined && value[field] === other[field]) throw new Error(`UNIQUE constraint failed: index 'uidx_plugin_dinkus-commerce_catalogItems_${field}'`);
      }
      records.set(id, structuredClone(value)); revisions.set(id, crypto.randomUUID());
    },
    async delete(id) { records.delete(id); revisions.delete(id); },
    async query({ where = {} } = {}) { return { items: [...records].filter(([, v]) => Object.entries(where).every(([k, x]) => v[k] === x)).map(([id, data]) => ({ id, data: structuredClone(data) })), hasMore: false }; },
    async compareAndSet(id, revision, value) { if ((revisions.get(id) ?? null) !== revision) return { applied: false }; await this.put(id, value); return { applied: true, revision: revisions.get(id) }; },
    async compareAndDelete(id, revision) { if (revisions.get(id) !== revision) return { applied: false }; await this.delete(id); return { applied: true }; },
  };
}

async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "server-cart-"));
  const path = join(dir, "commerce.sqlite");
  initializeGuestCheckoutDatabase(path);
  const opened = openGuestCollections(path);
  t.after(async () => { await opened.db.destroy(); rmSync(dir, { recursive: true, force: true }); });
  await seedGuestCatalog(opened.storage);
  await seedGuestCatalog(opened.storage, { itemId: "mug", price: "900" });
  const synth = syntheticCheckoutHost({ managed: false });
  const runtime = {
    carts: opened.storage[CHECKOUT_COLLECTION],
    capabilities: opened.storage[CHECKOUT_GUEST_CAPABILITY_COLLECTION],
    catalog: {
      catalog: opened.storage.catalogItems,
      prices: opened.storage.catalogPrices,
      backorderPolicies: opened.storage.catalogBackorderPolicies,
      configurations: opened.storage.storeInventoryConfigurations,
      settings: opened.storage.storefrontAvailabilitySettings,
      listing: opened.storage.storefrontOutOfStockListing,
      manualAvailability: opened.storage.catalogManualAvailability,
    },
    constructorSiteUrl: TRUSTED_SITE,
    host: synth.host,
  };
  const prepared = await prepareGuestCheckout(runtime);
  assert.equal(prepared.ok, true);
  const headers = { [GUEST_CAPABILITY_HEADER]: prepared.capability.capability };
  return {
    runtime, synth, storage: opened.storage, headers,
    cart: (input = {}, rt = runtime) => cartGuestCheckout(rt, input, headers),
    start: (input = { contact }) => startGuestCheckout(runtime, input, headers),
  };
}

test("a new cart reads empty, saves lines merged and sorted, and starts checkout from the saved cart", async (t) => {
  const f = await setup(t);
  const empty = await f.cart();
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.cart, { lines: [], version: null, expiresAt: 1000 + 30 * DAY });
  assert.equal(empty.checkout.state, "pending");
  assert.equal(empty.checkout.attemptId, null);

  const saved = await f.cart({ version: null, lines: [
    { catalogItemId: "mug", quantity: 1 }, { catalogItemId: "hat", quantity: 2 }, { catalogItemId: "mug", quantity: 1 },
  ] });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.deepEqual(saved.cart.lines, [{ catalogItemId: "hat", quantity: 2 }, { catalogItemId: "mug", quantity: 2 }]);
  assert.equal(typeof saved.cart.version, "string");

  // The browser sends no lines (commerce-server-cart-20261113).
  const withLines = await f.start({ contact, lines: [{ catalogItemId: "hat", quantity: 1 }] });
  assert.equal(withLines.error.code, "INVALID_CART");
  const started = await f.start();
  assert.equal(started.ok, true, JSON.stringify(started));
  assert.equal(started.checkout.total.minor, String(2 * 250 + 2 * 900));
  assert.equal(f.synth.counts().paymentCreates, 1);
});

test("an empty cart cannot start checkout and makes no payment", async (t) => {
  const f = await setup(t);
  assert.equal((await f.start()).error.code, "INVALID_CART");
  const saved = await f.cart({ version: null, lines: [{ catalogItemId: "hat", quantity: 1 }] });
  assert.equal((await f.cart({ version: saved.cart.version, lines: [] })).cart.lines.length, 0);
  assert.equal((await f.start()).error.code, "INVALID_CART");
  assert.equal(f.synth.counts().paymentCreates, 0);
});

test("a stale version changes nothing; a repeated idempotency key answers the current cart", async (t) => {
  const f = await setup(t);
  const first = await f.cart({ version: null, lines: [{ catalogItemId: "hat", quantity: 1 }], key: "agent-1" });
  // The shopper changes the cart after the agent read it.
  const shopper = await f.cart({ version: first.cart.version, lines: [{ catalogItemId: "hat", quantity: 3 }] });
  const stale = await f.cart({ version: first.cart.version, lines: [{ catalogItemId: "mug", quantity: 1 }] });
  assert.equal(stale.error.code, "CONTENTION");
  assert.deepEqual((await f.cart()).cart.lines, [{ catalogItemId: "hat", quantity: 3 }]);

  const keyed = await f.cart({ version: shopper.cart.version, lines: [{ catalogItemId: "mug", quantity: 1 }], key: "agent-2" });
  // The agent's retry lost the answer and resends with the old version: same key, nothing changes.
  const retried = await f.cart({ version: shopper.cart.version, lines: [{ catalogItemId: "mug", quantity: 1 }], key: "agent-2" });
  assert.equal(retried.ok, true);
  assert.deepEqual(retried.cart, keyed.cart);
});

test("unknown, unpriced and malformed lines are refused and nothing changes", async (t) => {
  const f = await setup(t);
  const saved = await f.cart({ version: null, lines: [{ catalogItemId: "hat", quantity: 1 }] });
  for (const [lines, code] of [
    [[{ catalogItemId: "nope", quantity: 1 }], "PRODUCT_UNAVAILABLE"],
    [[{ catalogItemId: "hat", quantity: 0 }], "INVALID_CART"],
    [[{ catalogItemId: "hat", quantity: 1, price: "1" }], "INVALID_CART"],
    [[{ productId: "hat", options: { Size: "M" }, quantity: 1 }], "PRODUCT_UNAVAILABLE"],
    ["hat", "INVALID_CART"],
  ]) {
    const refused = await f.cart({ version: saved.cart.version, lines });
    assert.equal(refused.ok, false, JSON.stringify(lines));
    assert.equal(refused.error.code, code, JSON.stringify(lines));
  }
  assert.equal((await f.cart({ lines: [] })).error.code, "INVALID_CART");
  assert.equal((await f.cart({ version: saved.cart.version, lines: [], extra: 1 })).error.code, "INVALID_CART");
  assert.deepEqual((await f.cart()).cart, saved.cart);
});

test("Commerce picks the variant from the chosen option labels and refuses a sold-out size", async (t) => {
  const f = await setup(t);
  const catalog = memory(), prices = memory(), availability = memory();
  const writes = { catalog, prices, availability, claims: memory() };
  await createCatalogItem(catalog, { commandId: "shirt", name: "Shirt", sku: "SHIRT-S", fulfillment: "digital" }, { createId: () => "small" });
  await addCatalogVariantOption(writes, { productId: "small", optionId: "size", optionLabel: "Size", values: [
    { valueId: "s", label: "Small", member: { catalogItemId: "small", fulfillment: "digital" } },
    { valueId: "l", label: "Large", member: { commandId: "large", name: "Shirt", sku: "SHIRT-L", fulfillment: "digital" } },
  ] }, { createId: () => "large" });
  await saveCatalogProductPrices(writes, { catalogItemId: "small", regular: "20", sale: "", stockStatus: "out-of-stock", expectedRevision: null });
  await saveCatalogProductPrices(writes, { catalogItemId: "large", regular: "24", sale: "", stockStatus: "in-stock", expectedRevision: null });
  const runtime = { ...f.runtime, catalog: { ...f.runtime.catalog, catalog, prices, manualAvailability: availability } };

  const large = await f.cart({ version: null, lines: [{ productId: "small", options: { Size: "Large" }, quantity: 2 }] }, runtime);
  assert.equal(large.ok, true, JSON.stringify(large));
  assert.deepEqual(large.cart.lines, [{ catalogItemId: "large", quantity: 2 }]);
  const small = await f.cart({ version: large.cart.version, lines: [{ productId: "small", options: { Size: "Small" }, quantity: 1 }] }, runtime);
  assert.equal(small.error.code, "PRODUCT_UNAVAILABLE");
  for (const options of [{ Size: "Huge" }, { Colour: "Large" }, { Size: "Large", Colour: "Red" }, {}]) {
    const missing = await f.cart({ version: large.cart.version, lines: [{ productId: "small", options, quantity: 1 }] }, runtime);
    assert.equal(missing.error.code, "PRODUCT_UNAVAILABLE", JSON.stringify(options));
  }
});

test("a cart lasts 30 days from its last change, and every change restarts the clock", async (t) => {
  const f = await setup(t);
  const saved = await f.cart({ version: null, lines: [{ catalogItemId: "hat", quantity: 1 }] });
  assert.equal(saved.cart.expiresAt, 1000 + 30 * DAY);
  f.synth.setNow(1000 + 29 * DAY);
  const changed = await f.cart({ version: saved.cart.version, lines: [{ catalogItemId: "hat", quantity: 2 }] });
  assert.equal(changed.cart.expiresAt, 1000 + 59 * DAY);
  f.synth.setNow(1000 + 58 * DAY);
  assert.deepEqual((await f.cart()).cart.lines, [{ catalogItemId: "hat", quantity: 2 }]);
  f.synth.setNow(1000 + 59 * DAY);
  assert.deepEqual((await f.cart()).cart.lines, []);
  assert.equal((await f.start()).error.code, "INVALID_CART");
});

test("an open checkout freezes the cart, a read is the status check, and a paid cart reads empty", async (t) => {
  const f = await setup(t);
  const saved = await f.cart({ version: null, lines: [{ catalogItemId: "hat", quantity: 1 }] });
  const started = await f.start();
  assert.equal(started.checkout.state, "pending");
  const open = await f.cart();
  assert.equal(open.checkout.attemptId, started.checkout.attemptId);
  assert.deepEqual(open.cart.lines, [{ catalogItemId: "hat", quantity: 1 }]);
  const frozen = await f.cart({ version: open.cart.version, lines: [{ catalogItemId: "hat", quantity: 5 }] });
  assert.equal(frozen.error.code, "CHECKOUT_FROZEN");
  assert.notEqual(saved.cart.version, open.cart.version);

  f.synth.setPayment("paid");
  const paid = await f.cart();
  assert.equal(paid.checkout.state, "paid");
  assert.ok(paid.checkout.order.orderId);
  assert.deepEqual(paid.cart.lines, []);
  // A lost start answer replays the paid purchase rather than buying again.
  const replay = await f.start();
  assert.equal(replay.checkout.attemptId, started.checkout.attemptId);
  assert.equal(replay.checkout.state, "paid");
  assert.equal(f.synth.counts().paymentCreates, 1);
  const after = await f.cart({ version: paid.cart.version, lines: [{ catalogItemId: "hat", quantity: 1 }] });
  assert.equal(after.error.code, "CHECKOUT_FROZEN");
});

test("a paid cart reads where Orders has the order now: Processing, Completed with tracking, and Processing again after reopening", async (t) => {
  const f = await setup(t);
  const orders = memory();
  const rt = { ...f.runtime, paidOrders: createPaidOrderReceiver(orders) };
  await f.cart({ version: null, lines: [{ catalogItemId: "hat", quantity: 1 }] }, rt);
  await f.start();
  f.synth.setPayment("paid");
  const paid = await f.cart({}, rt);
  assert.equal(paid.checkout.state, "paid");
  const { orderId } = paid.checkout.order;
  assert.ok(await orders.get(orderId), "Orders keeps the paid order");
  assert.equal(paid.checkout.order.status, "processing");
  assert.equal(paid.checkout.order.completed, null);

  assert.equal(await completeOrder(orders, orderId, 1, { carrier: "USPS", tracking: "9400 1000" }, "2026-11-15T12:00:00.000Z"), "saved");
  const shipped = (await f.cart({}, rt)).checkout.order;
  assert.equal(shipped.status, "completed");
  assert.deepEqual(shipped.completed, { at: "2026-11-15T12:00:00.000Z", carrier: "USPS", tracking: "9400 1000" });
  // The frozen receipt is unchanged by the later status.
  assert.equal(shipped.receiptId, paid.checkout.order.receiptId);
  assert.deepEqual(shipped.total, paid.checkout.order.total);

  assert.equal(await reopenOrder(orders, orderId, 2), "saved");
  const reopened = (await f.cart({}, rt)).checkout.order;
  assert.equal(reopened.status, "processing");
  assert.equal(reopened.completed, null, "a reopened order shows no cleared tracking");

  // Orders failing to answer never costs the shopper the receipt; the status and number are just left out,
  // while the frozen test mark stays.
  const broken = { ...rt, paidOrders: { receive: rt.paidOrders.receive, status: async () => { throw new Error("storage down"); } } };
  const still = await f.cart({}, broken);
  assert.equal(still.checkout.state, "paid");
  assert.equal(still.checkout.order.orderId, orderId);
  assert.equal(still.checkout.order.test, true);
  assert.equal("status" in still.checkout.order, false);
  assert.equal("number" in still.checkout.order, false);
  // Without a status port (no Orders bound), the receipt carries no status or number, and keeps its frozen test mark.
  const unbound = await f.cart();
  assert.equal(unbound.checkout.order.test, true);
  assert.equal("status" in unbound.checkout.order, false);
  assert.equal("number" in unbound.checkout.order, false);
});

test("authorized paid cart reads expose canonical Orders short number and frozen test/live fact without renumbering or leaking", async (t) => {
  // 1. Numbered TEST order: stays test even if host mode later changes to live.
  const fTest = await setup(t);
  const testOrders = memory(), testNumbers = memory();
  const testRt = { ...fTest.runtime, paidOrders: createPaidOrderReceiver(testOrders, testNumbers) };
  await fTest.cart({ version: null, lines: [{ catalogItemId: "hat", quantity: 1 }] }, testRt);
  await startGuestCheckout(testRt, { contact }, fTest.headers);
  fTest.synth.setPayment("paid");
  const testPaid = await fTest.cart({}, testRt);
  assert.equal(testPaid.checkout.state, "paid");
  assert.equal(testPaid.checkout.order.number, 1001);
  assert.equal(testPaid.checkout.order.test, true);
  assert.equal(Object.hasOwn(testPaid.checkout.order, "mode"), false);
  assert.deepEqual(testPaid.checkout.order.contact, contact);
  // Switching host mode after payment never alters the paid order's test fact.
  const flippedToLiveRt = { ...testRt, host: { ...testRt.host, paymentMode: "live" } };
  const afterFlip = await fTest.cart({}, flippedToLiveRt);
  assert.equal(afterFlip.checkout.order.test, true);
  assert.equal(afterFlip.checkout.order.number, 1001);

  // Forged, missing, and another shopper's capability keys expose no order, number, or test fact.
  for (const headers of [{}, { [GUEST_CAPABILITY_HEADER]: "forged.secret" }]) {
    const denied = await cartGuestCheckout(testRt, {}, headers);
    assert.equal(denied.ok, false);
    assert.equal(denied.error.code, "CAPABILITY_DENIED");
    assert.equal(denied.checkout, undefined);
  }
  const otherPrepared = await prepareGuestCheckout(testRt);
  const otherRead = await cartGuestCheckout(testRt, {}, { [GUEST_CAPABILITY_HEADER]: otherPrepared.capability.capability });
  assert.equal(otherRead.ok, true);
  assert.equal(otherRead.checkout.order, null);

  // 2. Numbered LIVE order: test is false, and stays false even if host mode later switches to test.
  const fLive = await setup(t);
  const liveOrders = memory(), liveNumbers = memory();
  const liveHost = { ...fLive.runtime.host, paymentMode: "live" };
  const liveRt = { ...fLive.runtime, host: liveHost, paidOrders: createPaidOrderReceiver(liveOrders, liveNumbers) };
  await fLive.cart({ version: null, lines: [{ catalogItemId: "hat", quantity: 1 }] }, liveRt);
  await startGuestCheckout(liveRt, { contact }, fLive.headers);
  fLive.synth.setPayment("paid");
  const livePaid = await fLive.cart({}, liveRt);
  assert.equal(livePaid.checkout.state, "paid");
  assert.equal(livePaid.checkout.order.number, 1001);
  assert.equal(livePaid.checkout.order.test, false);
  assert.equal(Object.hasOwn(livePaid.checkout.order, "mode"), false);
  const flippedToTestRt = { ...liveRt, host: { ...liveHost, paymentMode: "test" } };
  const liveAfterFlip = await fLive.cart({}, flippedToTestRt);
  assert.equal(liveAfterFlip.checkout.order.test, false);
  assert.equal(liveAfterFlip.checkout.order.number, 1001);

  // 3. Missing-number fallback (historical unnumbered order and absent mode): keeps valid receipt, never parses UUID digits or renumbers.
  const fHist = await setup(t);
  const histOrders = memory(), histNumbers = memory();
  await histNumbers.compareAndSet("next", null, { next: 1005 });
  const histRt = { ...fHist.runtime, paidOrders: createPaidOrderReceiver(histOrders) };
  await fHist.cart({ version: null, lines: [{ catalogItemId: "hat", quantity: 1 }] }, histRt);
  await startGuestCheckout(histRt, { contact }, fHist.headers);
  fHist.synth.setPayment("paid");
  // Simulate a historical unnumbered order in Orders with digits in its orderId and omitted mode.
  const paidHist = await fHist.cart({}, histRt);
  const { orderId } = paidHist.checkout.order;
  const keptRecord = await histOrders.getVersioned(orderId);
  const { mode: _omittedMode, ...legacyPaidOrder } = keptRecord.value.paidOrder;
  await histOrders.compareAndSet(orderId, keptRecord.revision, { ...keptRecord.value, paidOrder: legacyPaidOrder, number: undefined });
  // Also omit mode from Checkout's stored attempt order to mirror pre-mode-field historical records.
  const carts = fHist.storage[CHECKOUT_COLLECTION];
  const [{ id: cartId, data: cartRecord }] = (await carts.query()).items;
  const legacyAttemptOrder = { ...cartRecord.attempts[0].order };
  delete legacyAttemptOrder.mode;
  await carts.put(cartId, { ...cartRecord, attempts: [{ ...cartRecord.attempts[0], order: legacyAttemptOrder }] });
  const histRead = await fHist.cart({}, { ...histRt, paidOrders: createPaidOrderReceiver(histOrders, histNumbers) });
  assert.equal(histRead.ok, true);
  assert.equal(histRead.checkout.state, "paid");
  assert.equal(histRead.checkout.order.orderId, orderId);
  assert.equal(histRead.checkout.order.receiptId, paidHist.checkout.order.receiptId);
  assert.deepEqual(histRead.checkout.order.total, paidHist.checkout.order.total);
  assert.deepEqual(histRead.checkout.order.contact, contact);
  assert.equal(histRead.checkout.order.number, null);
  assert.equal(histRead.checkout.order.test, true);
  assert.equal((await histNumbers.getVersioned("next")).value.next, 1005, "guest read must never renumber order_numbers");
});

test("the cart needs the shopper's own key", async (t) => {
  const f = await setup(t);
  for (const headers of [{}, { [GUEST_CAPABILITY_HEADER]: "guessed.secret" }]) {
    const denied = await cartGuestCheckout(f.runtime, {}, headers);
    assert.equal(denied.error.code, "CAPABILITY_DENIED");
  }
  const denied = await cartGuestCheckout(f.runtime, { version: null, lines: [{ catalogItemId: "hat", quantity: 1 }] }, {});
  assert.equal(denied.error.code, "CAPABILITY_DENIED");
  assert.deepEqual((await f.storage[CHECKOUT_COLLECTION].query()).items, []);
});

test("the background check deletes carts past their 30 days and keeps paid orders", async (t) => {
  const { clearExpiredCarts } = await import("../../../dist/features/checkout/storage.js");
  const f = await setup(t);
  const carts = f.storage[CHECKOUT_COLLECTION];
  const paidAttempt = { attemptId: "paid-1", phase: "paid", cart: [{ catalogItemId: "hat", quantity: 1 }], order: { orderId: "o-1" } };
  await carts.put("old-empty", { attempts: [], cart: { lines: [{ catalogItemId: "hat", quantity: 1 }] }, cartExpires: "2000" });
  await carts.put("old-released", { attempts: [{ attemptId: "r-1", phase: "released" }], cart: { lines: [] }, cartExpires: "2000" });
  await carts.put("old-paid", { attempts: [paidAttempt], cart: { lines: [{ catalogItemId: "hat", quantity: 1 }] }, cartExpires: "2000" });
  await carts.put("old-paying", { attempts: [{ attemptId: "p-1", phase: "paying" }], cart: { lines: [{ catalogItemId: "hat", quantity: 1 }] }, cartExpires: "2000" });
  await carts.put("fresh", { attempts: [], cart: { lines: [{ catalogItemId: "hat", quantity: 1 }] }, cartExpires: "9000" });
  await clearExpiredCarts(carts, 5000);
  assert.equal(await carts.get("old-empty"), null);
  assert.equal(await carts.get("old-released"), null);
  assert.deepEqual(await carts.get("old-paid"), { attempts: [paidAttempt] });
  // A cart mid-checkout keeps its attempt but not its expired lines (they never come back), and is looked
  // at again a day on, so the next run's page of 100 never stalls behind it.
  assert.deepEqual(await carts.get("old-paying"), { attempts: [{ attemptId: "p-1", phase: "paying" }], cartExpires: String(5000 + DAY) });
  assert.ok((await carts.get("fresh")).cart);
});

test("a cart changed while checkout starts is contention, never a purchase of the old lines", async (t) => {
  const f = await setup(t);
  const saved = await f.cart({ version: null, lines: [{ catalogItemId: "hat", quantity: 1 }] });
  // The shopper changes the cart in another tab after start has read it but before the attempt is saved.
  let reads = 0;
  const carts = new Proxy(f.runtime.carts, { get(target, name) {
    const value = Reflect.get(target, name, target);
    if (name !== "getVersioned") return typeof value === "function" ? value.bind(target) : value;
    return async (...args) => {
      if (++reads === 2) assert.equal((await f.cart({ version: saved.cart.version, lines: [{ catalogItemId: "hat", quantity: 3 }] })).ok, true);
      return value.apply(target, args);
    };
  } });
  const raced = await startGuestCheckout({ ...f.runtime, carts }, { contact }, f.headers);
  assert.ok(reads >= 2, "start read the cart twice");
  assert.equal(raced.error?.code, "CONTENTION", JSON.stringify(raced));
  assert.equal(f.synth.counts().paymentCreates, 0);
  const started = await f.start();
  assert.equal(started.ok, true, JSON.stringify(started));
  assert.equal(started.checkout.total.minor, String(3 * 250));
});

test("a cart deleted by expiry cleanup while checkout starts is contention, never a purchase", async (t) => {
  const { clearExpiredCarts } = await import("../../../dist/features/checkout/storage.js");
  const f = await setup(t);
  await f.cart({ version: null, lines: [{ catalogItemId: "hat", quantity: 1 }] });
  // Start has read the live cart; then the background check finds it past its time and deletes it.
  let reads = 0;
  const carts = new Proxy(f.runtime.carts, { get(target, name) {
    const value = Reflect.get(target, name, target);
    if (name !== "getVersioned") return typeof value === "function" ? value.bind(target) : value;
    return async (...args) => {
      if (++reads === 2) await clearExpiredCarts(f.storage[CHECKOUT_COLLECTION], 9_999_999_999);
      return value.apply(target, args);
    };
  } });
  const raced = await startGuestCheckout({ ...f.runtime, carts }, { contact }, f.headers);
  assert.ok(reads >= 2, "start read the cart twice");
  assert.equal(raced.error?.code, "CONTENTION", JSON.stringify(raced));
  assert.equal(f.synth.counts().paymentCreates, 0);
  assert.deepEqual((await f.storage[CHECKOUT_COLLECTION].query()).items, [], "the deleted cart is not recreated");
});

test("a checkout saved before the server cart (attempts only) still reads, replays and pays", async (t) => {
  const { clearExpiredCarts } = await import("../../../dist/features/checkout/storage.js");
  const f = await setup(t);
  await f.cart({ version: null, lines: [{ catalogItemId: "hat", quantity: 1 }] });
  const started = await f.start();
  const carts = f.storage[CHECKOUT_COLLECTION];
  const [{ id, data }] = (await carts.query()).items;
  // Commerce 0.8.0 stored each checkout as { attempts } with no cart and no expiry.
  await carts.put(id, { attempts: data.attempts });
  const read = await f.cart();
  assert.equal(read.ok, true, JSON.stringify(read));
  assert.equal(read.checkout.attemptId, started.checkout.attemptId);
  assert.deepEqual(read.cart.lines, []);
  const replay = await f.start();
  // Start replays the saved attempt's own frozen purchase; it prices nothing new.
  assert.equal(replay.checkout.attemptId, started.checkout.attemptId, JSON.stringify(replay));
  assert.equal(replay.checkout.total.minor, started.checkout.total.minor);
  await clearExpiredCarts(carts, 10 ** 12);
  assert.ok(await carts.get(id), "cleanup never touches a record with no cart expiry");
  f.synth.setPayment("paid");
  const paid = await f.cart();
  assert.equal(paid.checkout.state, "paid");
  assert.ok(paid.checkout.order.orderId);
});

// commerce-cart-attributes-order-paid-20261123: the store's own facts ride on the cart and are frozen onto its order.
test("a cart keeps the store's attributes within their limits, and checkout freezes them onto the paid order, never onto the payment", async (t) => {
  const f = await setup(t);
  const orders = memory();
  const rt = { ...f.runtime, paidOrders: createPaidOrderReceiver(orders) };
  const lines = [{ catalogItemId: "hat", quantity: 1 }];
  const attributes = { account_id: "acct_42", "credit.sku": "compute-100" };

  // Anything outside the limits refuses the whole write, and nothing is saved.
  const many = Object.fromEntries(Array.from({ length: 11 }, (_, i) => ["k" + i, "v"]));
  const heavy = Object.fromEntries(Array.from({ length: 8 }, (_, i) => ["k" + i, "x".repeat(255)]));
  const refused = [many, heavy, { dinkus_site: "x" }, { _hidden: "x" }, { Account: "x" }, { "a b": "x" }, { ["k".repeat(41)]: "x" }, { "": "x" },
    { count: 3 }, { nested: { a: "b" } }, { note: "x".repeat(256) }, ["account_id"], "account_id", null];
  for (const bad of refused) {
    const answer = await f.cart({ version: null, lines, attributes: bad }, rt);
    assert.equal(answer.error?.code, "INVALID_CART", JSON.stringify(bad));
  }
  assert.equal((await f.cart({ attributes }, rt)).error.code, "INVALID_CART", "attributes ride only on a cart replace");
  assert.equal((await f.cart({ stop: true, attributes }, rt)).error.code, "INVALID_CART");
  assert.deepEqual((await f.storage[CHECKOUT_COLLECTION].query()).items, []);

  // The largest bag allowed: 10 attributes, a 40-character key, a 255-character value.
  const widest = { ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => ["k" + i, "v"])), ["k".repeat(40)]: "x".repeat(255) };
  const wide = await f.cart({ version: null, lines, attributes: widest }, rt);
  assert.deepEqual(wide.cart.attributes, widest);

  // A named bag replaces the last one whole; a write that names none keeps it; {} leaves none.
  const set = await f.cart({ version: wide.cart.version, lines, attributes, key: "agent-1" }, rt);
  assert.deepEqual(set.cart.attributes, attributes);
  const more = await f.cart({ version: set.cart.version, lines: [{ catalogItemId: "hat", quantity: 2 }] }, rt);
  assert.deepEqual(more.cart.attributes, attributes);
  assert.deepEqual((await f.cart({}, rt)).cart.attributes, attributes);
  const cleared = await f.cart({ version: more.cart.version, lines, attributes: {} }, rt);
  assert.deepEqual(cleared.cart.attributes, {});
  const again = await f.cart({ version: cleared.cart.version, lines, attributes }, rt);

  // Checkout start freezes them; the payment request carries none of them.
  const started = await startGuestCheckout(rt, { contact }, f.headers);
  assert.equal(started.ok, true, JSON.stringify(started));
  assert.equal((await f.cart({ version: again.cart.version, lines, attributes: { account_id: "acct_99" } }, rt)).error.code, "CHECKOUT_FROZEN");
  const [{ data: record }] = (await f.storage[CHECKOUT_COLLECTION].query()).items;
  assert.deepEqual(record.attempts[0].attributes, attributes);
  assert.equal(JSON.stringify(record.attempts[0].payment).includes("acct_42"), false);

  f.synth.setPayment("paid");
  const paid = await f.cart({}, rt);
  assert.equal(paid.checkout.state, "paid");
  assert.equal(JSON.stringify(paid.checkout).includes("acct_42"), false, "the guest receipt does not repeat them");
  assert.deepEqual((await orders.get(paid.checkout.order.orderId)).paidOrder.attributes, attributes);
});

test("a cart with no attributes, or with them cleared, makes an order with none", async (t) => {
  const f = await setup(t);
  const orders = memory();
  const rt = { ...f.runtime, paidOrders: createPaidOrderReceiver(orders) };
  const lines = [{ catalogItemId: "hat", quantity: 1 }];
  const set = await f.cart({ version: null, lines, attributes: { account_id: "acct_42" } }, rt);
  await f.cart({ version: set.cart.version, lines, attributes: {} }, rt);
  assert.equal((await startGuestCheckout(rt, { contact }, f.headers)).ok, true);
  f.synth.setPayment("paid");
  const paid = await f.cart({}, rt);
  const kept = (await orders.get(paid.checkout.order.orderId)).paidOrder;
  assert.equal("attributes" in kept, false);
});
