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
  await carts.put("old-paying", { attempts: [{ attemptId: "p-1", phase: "paying" }], cart: { lines: [] }, cartExpires: "2000" });
  await carts.put("fresh", { attempts: [], cart: { lines: [{ catalogItemId: "hat", quantity: 1 }] }, cartExpires: "9000" });
  await clearExpiredCarts(carts, 5000);
  assert.equal(await carts.get("old-empty"), null);
  assert.equal(await carts.get("old-released"), null);
  assert.deepEqual(await carts.get("old-paid"), { attempts: [paidAttempt] });
  // A cart mid-checkout moves a day on, so the next run's page of 100 never stalls behind it.
  assert.deepEqual(await carts.get("old-paying"), { attempts: [{ attemptId: "p-1", phase: "paying" }], cart: { lines: [] }, cartExpires: String(5000 + DAY) });
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
