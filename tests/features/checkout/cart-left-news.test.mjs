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
import { stopKey } from "../../../dist/features/checkout/guest.js";
import { remindCarts } from "../../../dist/features/checkout/remind.js";
import { clearExpiredCarts } from "../../../dist/features/checkout/storage.js";
import { courierOutbox } from "../../../dist/features/orders/index.js";
import { loadOutOfStockListing, setOutOfStockListing } from "../../../dist/features/storefront-availability/kernel/index.js";
import {
  TRUSTED_SITE,
  initializeGuestCheckoutDatabase,
  openGuestCollections,
  seedGuestCatalog,
  syntheticCheckoutHost,
} from "./guest-dispatch.mjs";

// A left cart becomes the courier's cart.left news for Store emails (store-emails-plugin-20261122); Commerce sends no email
// itself. The tick box, stop list and cart link stay from commerce-abandoned-cart-email-20261122.
const HOURS = 3600;
const contact = { email: "Cart-Shopper@Example.test", billing: { name: "Bill Payer", line1: "9 Billing Way", city: "Billtown", postalCode: "00009", country: "US" } };

async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "cart-email-"));
  const path = join(dir, "commerce.sqlite");
  initializeGuestCheckoutDatabase(path);
  const opened = openGuestCollections(path);
  t.after(async () => { await opened.db.destroy(); rmSync(dir, { recursive: true, force: true }); });
  await seedGuestCatalog(opened.storage);
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
  // The stop list is EmDash's own plugin storage on SQLite, as in a store.
  const stops = opened.storage.cart_email_stops;
  /** The stop list's keys, read back from SQLite. */
  const stopped = async () => (await stops.query({ limit: 100 })).items.map(item => item.id);
  const ctx = {
    storage: {
      checkout_carts: opened.storage[CHECKOUT_COLLECTION],
      checkout_guest_capabilities: opened.storage[CHECKOUT_GUEST_CAPABILITY_COLLECTION],
      storefront_out_of_stock_listing: opened.storage.storefrontOutOfStockListing,
      cart_email_stops: stops,
    },
    site: { url: TRUSTED_SITE, name: "Test Shop" },
  };
  /** A new shopper's cart with one hat, checked out and left unpaid. */
  async function abandoned(input = { contact, news: true }) {
    const prepared = await prepareGuestCheckout(runtime);
    const headers = { [GUEST_CAPABILITY_HEADER]: prepared.capability.capability };
    await cartGuestCheckout(runtime, { version: null, lines: [{ catalogItemId: "hat", quantity: 1 }] }, headers);
    synth.setPayment("open");
    const started = await startGuestCheckout(runtime, input, headers);
    assert.equal(started.ok, true, JSON.stringify(started));
    return { headers, cartId: (await runtime.capabilities.get(prepared.capabilityId)).cartId };
  }
  const release = headers => { synth.setPayment("expired-unpaid"); return cartGuestCheckout(runtime, {}, headers); };
  const sweep = at => remindCarts(ctx, at);
  /** What the store's courier reads from Commerce's outbox for cart.left, from the start. */
  const left = async () => (await courierOutbox({ input: { courier: 1, op: "since", topic: "cart.left", after: null, limit: 100 } }, ctx)).items;
  return { runtime, synth, ctx, stops, stopped, abandoned, release, sweep, left, carts: opened.storage[CHECKOUT_COLLECTION], capabilities: opened.storage[CHECKOUT_GUEST_CAPABILITY_COLLECTION] };
}

/** The pick-up link's capability, as the store's /cart/c/ page sets it in the cart cookie. */
function linkKey(link) {
  const match = /\/cart\/c\/([^?\s]+)\?key=([0-9a-f]+)$/.exec(link);
  assert.ok(match, link);
  return `${match[1]}.${match[2]}`;
}

test("a cart left unpaid 10 hours after the email was given is cart.left news once, and its link opens the same cart", async (t) => {
  const f = await setup(t);
  const { headers, cartId } = await f.abandoned();
  await f.release(headers);
  await f.sweep(1000 + 10 * HOURS - 1);
  assert.deepEqual(await f.left(), [], "not before 10 hours");
  await f.sweep(1000 + 10 * HOURS + 1);
  const [news, ...more] = await f.left();
  assert.equal(more.length, 0);
  const { link } = news.data;
  assert.deepEqual(news, { id: `${cartId}:left`, at: new Date((1000 + 10 * HOURS + 1) * 1000).toISOString(), data: {
    email: contact.email, ticked: true, link, stopLink: `${link}&stop=1`, lines: [{ name: "hat", quantity: 1, options: "" }] } });
  assert.ok(link.startsWith(`${TRUSTED_SITE}/cart/c/`), link);
  // The key is made once: the courier may read the same news again, and it carries the same link.
  assert.deepEqual(await f.left(), [news]);
  // A fresh key for the same cart, not the shopper's own cookie key.
  const key = linkKey(link);
  assert.notEqual(key, headers[GUEST_CAPABILITY_HEADER]);
  const picked = await cartGuestCheckout(f.runtime, {}, { [GUEST_CAPABILITY_HEADER]: key });
  assert.equal(picked.ok, true, JSON.stringify(picked));
  assert.deepEqual(picked.cart.lines, [{ catalogItemId: "hat", quantity: 1 }]);
  assert.equal(picked.checkout.state, "released-retry");
  // At most once per cart: later runs, and a second unpaid checkout, add nothing.
  await f.sweep(1000 + 30 * HOURS);
  f.synth.setPayment("open");
  await startGuestCheckout(f.runtime, { contact, news: true }, headers);
  await f.release(headers);
  await f.sweep(1000 + 60 * HOURS);
  assert.deepEqual(await f.left(), [news]);
  const record = await f.carts.get(cartId);
  assert.equal(record.remindAt, undefined);
  assert.equal(record.leftLink, link);
  console.log("cart.left proof", JSON.stringify({ ...news, data: { ...news.data, link: "<cart link>", stopLink: "<cart link>&stop=1" } }));
});

test("a cart emailed by a 0.9.0 beta is never left again", async (t) => {
  const f = await setup(t);
  const { headers, cartId } = await f.abandoned();
  await f.release(headers);
  // What the beta left behind once it sent its own email.
  const { remindAt: _, ...rest } = await f.carts.get(cartId);
  const { revision } = await f.carts.getVersioned(cartId);
  assert.equal((await f.carts.compareAndSet(cartId, revision, { ...rest, emailed: true })).applied, true);
  f.synth.setPayment("open");
  await startGuestCheckout(f.runtime, { contact, news: true }, headers);
  await f.release(headers);
  assert.equal((await f.carts.get(cartId)).remindAt, undefined);
  await f.sweep(1000 + 60 * HOURS);
  assert.deepEqual(await f.left(), []);
});

test("the stop link stops cart news for that email, for every later cart", async (t) => {
  const f = await setup(t);
  const first = await f.abandoned();
  await f.release(first.headers);
  await f.sweep(1000 + 11 * HOURS);
  const key = linkKey((await f.left())[0].data.link);
  assert.equal((await cartGuestCheckout(f.runtime, { stop: "yes" }, { [GUEST_CAPABILITY_HEADER]: key }, f.stops)).error.code, "INVALID_CART");
  const stopped = await cartGuestCheckout(f.runtime, { stop: true }, { [GUEST_CAPABILITY_HEADER]: key }, f.stops);
  assert.equal(stopped.ok, true, JSON.stringify(stopped));
  assert.deepEqual(await f.stopped(), [await stopKey(contact.email)]);
  // A stop needs the link's key.
  assert.equal((await cartGuestCheckout(f.runtime, { stop: true }, {}, f.stops)).error.code, "CAPABILITY_DENIED");
  // Kept by the email's hash, whatever its case.
  const second = await f.abandoned({ contact: { ...contact, email: "cart-shopper@example.test" }, news: true });
  await f.release(second.headers);
  await f.sweep(1000 + 22 * HOURS);
  assert.equal((await f.left()).length, 1);
  assert.equal((await f.carts.get(second.cartId)).leftKey, undefined);
});

test("every left cart is news, ticked or not: Store emails applies the owner's choice", async (t) => {
  const f = await setup(t);
  const unticked = await f.abandoned({ contact });
  await f.release(unticked.headers);
  const ticked = await f.abandoned();
  await f.release(ticked.headers);
  await f.sweep(1000 + 11 * HOURS);
  const news = await f.left();
  assert.deepEqual(news.map(item => [item.id, item.data.ticked]).sort(), [[`${unticked.cartId}:left`, false], [`${ticked.cartId}:left`, true]].sort());
  // The courier's bookmark: nothing again after the last key given.
  const page = await courierOutbox({ input: { courier: 1, op: "since", topic: "cart.left", after: null, limit: 1 } }, f.ctx);
  assert.equal(page.more, true);
  const rest = await courierOutbox({ input: { courier: 1, op: "since", topic: "cart.left", after: page.next, limit: 50 } }, f.ctx);
  assert.deepEqual([...page.items, ...rest.items].map(item => item.id), news.map(item => item.id));
  assert.equal(rest.more, false);
});

test("a paid, emptied or still-open checkout is not left", async (t) => {
  const f = await setup(t);
  const paid = await f.abandoned();
  f.synth.setPayment("paid");
  await cartGuestCheckout(f.runtime, {}, paid.headers);

  const emptied = await f.abandoned();
  const released = await f.release(emptied.headers);
  await cartGuestCheckout(f.runtime, { version: released.cart.version, lines: [] }, emptied.headers);

  const open = await f.abandoned();
  f.synth.setPayment("open");
  await f.sweep(1000 + 11 * HOURS);
  assert.deepEqual(await f.left(), []);
  // The open checkout is looked at again an hour on; once it ends unpaid, it is left.
  assert.equal((await f.carts.get(open.cartId)).remindAt, String(1000 + 12 * HOURS));
  await f.release(open.headers);
  await f.sweep(1000 + 12 * HOURS + 1);
  assert.deepEqual((await f.left()).map(item => item.id), [`${open.cartId}:left`]);
});

test("the tick must be true, and a cart change keeps the news but names no items", async (t) => {
  const f = await setup(t);
  const prepared = await prepareGuestCheckout(f.runtime);
  const headers = { [GUEST_CAPABILITY_HEADER]: prepared.capability.capability };
  await cartGuestCheckout(f.runtime, { version: null, lines: [{ catalogItemId: "hat", quantity: 1 }] }, headers);
  assert.equal((await startGuestCheckout(f.runtime, { contact, news: "yes" }, headers)).error.code, "INVALID_CART");

  const left = await f.abandoned();
  const released = await f.release(left.headers);
  const changed = await cartGuestCheckout(f.runtime, { version: released.cart.version, lines: [{ catalogItemId: "hat", quantity: 2 }] }, left.headers);
  assert.equal(changed.ok, true, JSON.stringify(changed));
  await f.sweep(1000 + 11 * HOURS);
  const [news] = await f.left();
  // The cart no longer holds what went to checkout, so the news names no items.
  assert.equal(news.data.lines, null);
});

test("a store that saved the 0.9.0 beta cart email setting still loads its settings, and the next save drops it", async (t) => {
  const f = await setup(t);
  const listing = f.ctx.storage.storefront_out_of_stock_listing;
  await listing.put("active", { recordKind: "storefront-out-of-stock-listing", recordId: "active",
    hideOutOfStock: false, cartEmail: "all", updatedAt: "2026-11-22T00:00:00.000Z" });
  assert.equal((await loadOutOfStockListing(listing)).hideOutOfStock, false);
  // Saving the same Catalog choices still drops it.
  const same = await setOutOfStockListing(listing, { hideOutOfStock: false });
  assert.equal(same.changed, true);
  assert.equal("cartEmail" in (await listing.get("active")), false);
  const saved = await setOutOfStockListing(listing, { hideOutOfStock: true });
  assert.equal("cartEmail" in saved.listing, false);
  await assert.rejects(() => setOutOfStockListing(listing, { hideOutOfStock: true, cartEmail: "all" }), /invalid field/);
});

test("the email's key lasts only as long as its cart, and its stop link stops the address it went to", async (t) => {
  const f = await setup(t);
  const { headers, cartId } = await f.abandoned();
  await f.release(headers);
  await f.sweep(1000 + 11 * HOURS);
  const [news] = await f.left();
  const emailed = { [GUEST_CAPABILITY_HEADER]: linkKey(news.data.link) };
  // The shopper tries the same cart again with another email, unticked, which also ends unpaid.
  f.synth.setPayment("open");
  assert.equal((await startGuestCheckout(f.runtime, { contact: { ...contact, email: "sam@example.test" } }, headers)).ok, true);
  await f.release(headers);
  // The courier may read the news again after that: it still names the address and tick the link was made for.
  const [again, ...more] = await f.left();
  assert.equal(more.length, 0);
  assert.deepEqual(again, news);
  assert.equal(again.data.email, contact.email);
  assert.equal(again.data.ticked, true);
  console.log("cart.left after a changed-email retry", JSON.stringify({ email: again.data.email, ticked: again.data.ticked, sameLink: again.data.link === news.data.link }));
  // The email's stop link stops the address it was sent to, not the latest checkout's. The shopper's own key and a
  // made-up key stop nothing.
  assert.equal((await cartGuestCheckout(f.runtime, { stop: true }, headers, f.stops)).error.code, "CHECKOUT_NOT_FOUND");
  const madeUp = { [GUEST_CAPABILITY_HEADER]: `${emailed[GUEST_CAPABILITY_HEADER].split(".")[0]}.${"0".repeat(64)}` };
  assert.equal((await cartGuestCheckout(f.runtime, { stop: true }, madeUp, f.stops)).error.code, "CAPABILITY_DENIED");
  assert.deepEqual(await f.stopped(), []);
  assert.equal((await cartGuestCheckout(f.runtime, { stop: true }, emailed, f.stops)).ok, true);
  const stoppedAfterRetry = await f.stopped();
  assert.deepEqual(stoppedAfterRetry, [await stopKey(contact.email)]);
  // Past the cart's 30 days the emailed key is refused, and so is the shopper's own key (commerce-cart-key-expiry-20261125).
  const expires = +(await f.carts.get(cartId)).cartExpires;
  const at = now => ({ ...f.runtime, host: { ...f.runtime.host, now: () => now } });
  assert.equal((await cartGuestCheckout(at(expires - 1), {}, emailed)).ok, true);
  assert.equal((await cartGuestCheckout(at(expires), {}, emailed)).error.code, "CAPABILITY_DENIED");
  assert.equal((await cartGuestCheckout(at(expires), { stop: true }, emailed, f.stops)).error.code, "CAPABILITY_DENIED");
  assert.equal((await cartGuestCheckout(at(expires), {}, headers)).error.code, "CAPABILITY_DENIED");
  // Once the cleanup deletes the cart, the emailed key cannot bring it back.
  await clearExpiredCarts(f.carts, expires + 1, f.capabilities);
  assert.equal(await f.carts.get(cartId), null);
  const recreate = await cartGuestCheckout(f.runtime, { version: null, lines: [{ catalogItemId: "hat", quantity: 1 }] }, emailed);
  assert.equal(recreate.error.code, "CAPABILITY_DENIED");
  assert.equal(await f.carts.get(cartId), null);
  // The same cleanup deleted the shopper's own key, past its date with its cart gone, so nothing can make that cart
  // again; the storefront asks for a new key. The old emailed key stays refused.
  assert.equal(await f.capabilities.get(headers[GUEST_CAPABILITY_HEADER].split(".")[0]), null);
  assert.equal((await cartGuestCheckout(f.runtime, { version: null, lines: [{ catalogItemId: "hat", quantity: 1 }] }, headers)).error.code, "CAPABILITY_DENIED");
  assert.equal(await f.carts.get(cartId), null);
  assert.equal((await cartGuestCheckout(f.runtime, {}, emailed)).error.code, "CAPABILITY_DENIED");
  assert.equal((await cartGuestCheckout(f.runtime, { stop: true }, emailed, f.stops)).error.code, "CAPABILITY_DENIED");
  assert.deepEqual(await f.stopped(), stoppedAfterRetry, "a refused key writes nothing");
  console.log("cart.left stop proof", JSON.stringify({ stopRows: stoppedAfterRetry.length, stopsFirstAddress: stoppedAfterRetry[0] === await stopKey(contact.email),
    stopsSam: stoppedAfterRetry.includes(await stopKey("sam@example.test")), afterExpiry: "CAPABILITY_DENIED", afterCartMadeAgain: "CAPABILITY_DENIED", madeUpKey: "CAPABILITY_DENIED" }));
});

test("the email's key is checked against the cart each request reads, so cleanup in between changes nothing", async (t) => {
  const f = await setup(t);
  const { headers, cartId } = await f.abandoned();
  await f.release(headers);
  await f.sweep(1000 + 11 * HOURS);
  const emailed = { [GUEST_CAPABILITY_HEADER]: linkKey((await f.left())[0].data.link) };
  const expires = +(await f.carts.get(cartId)).cartExpires;
  // The request is let in just before the cart's 30 days end; the cleanup deletes the cart right after the
  // request reads it, before the request writes.
  let race = null;
  const carts = {
    get: id => f.carts.get(id), query: q => f.carts.query(q), compareAndSet: (...a) => f.carts.compareAndSet(...a),
    async getVersioned(id) { const read = await f.carts.getVersioned(id); if (race) { const run = race; race = null; await run(); } return read; },
  };
  const racing = { ...f.runtime, carts, host: { ...f.runtime.host, now: () => expires - 1 } };
  assert.equal((await cartGuestCheckout(racing, {}, emailed)).ok, true);
  race = () => clearExpiredCarts(f.carts, expires + 1, f.capabilities);
  // A write sent as if the cart were new (version null) must not make the deleted cart again.
  const write = await cartGuestCheckout(racing, { version: null, lines: [{ catalogItemId: "hat", quantity: 2 }] }, emailed);
  assert.equal(write.ok, false, JSON.stringify(write));
  assert.equal(await f.carts.get(cartId), null, "the deleted cart is not made again");
  // The cleanup also deleted the shopper's own key (past its date, cart gone), so it cannot make the cart again
  // either; the emailed key stays refused.
  assert.equal((await cartGuestCheckout(f.runtime, { version: null, lines: [{ catalogItemId: "hat", quantity: 1 }] }, headers)).error.code, "CAPABILITY_DENIED");
  assert.equal(await f.carts.get(cartId), null);
  assert.equal((await cartGuestCheckout(racing, {}, emailed)).error.code, "CAPABILITY_DENIED");
  f.synth.setPayment("open");
  assert.equal((await startGuestCheckout({ ...racing, host: { ...racing.host, now: () => 1000 } }, { contact }, emailed)).error.code, "CAPABILITY_DENIED");
});
