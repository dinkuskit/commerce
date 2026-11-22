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
import { setOutOfStockListing } from "../../../dist/features/storefront-availability/kernel/index.js";
import {
  TRUSTED_SITE,
  initializeGuestCheckoutDatabase,
  openGuestCollections,
  seedGuestCatalog,
  syntheticCheckoutHost,
} from "./guest-dispatch.mjs";

// The abandoned-cart email (commerce-abandoned-cart-email-20261122).
const HOURS = 3600;
const contact = { email: "Cart-Shopper@Example.test", billing: { name: "Bill Payer", line1: "9 Billing Way", city: "Billtown", postalCode: "00009", country: "US" } };

function memory() {
  const records = new Map();
  return {
    async get(id) { return structuredClone(records.get(id) ?? null); },
    async put(id, value) { records.set(id, structuredClone(value)); },
    records,
  };
}

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
  const stops = memory();
  const sent = [];
  const ctx = {
    storage: {
      checkout_carts: opened.storage[CHECKOUT_COLLECTION],
      checkout_guest_capabilities: opened.storage[CHECKOUT_GUEST_CAPABILITY_COLLECTION],
      storefront_out_of_stock_listing: opened.storage.storefrontOutOfStockListing,
      cart_email_stops: stops,
    },
    site: { url: TRUSTED_SITE, name: "Test Shop" },
    email: { async send(message) { sent.push(message); } },
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
  const mode = cartEmail => setOutOfStockListing(opened.storage.storefrontOutOfStockListing, { hideOutOfStock: false, cartEmail });
  const sweep = at => remindCarts(ctx, at);
  return { runtime, synth, ctx, sent, stops, abandoned, release, mode, sweep, carts: opened.storage[CHECKOUT_COLLECTION] };
}

/** The pick-up link's capability, as the store's /cart/c/ page sets it in the cart cookie. */
function linkKey(text) {
  const match = /\/cart\/c\/([^?\s]+)\?key=([0-9a-f]+)\s/.exec(text);
  assert.ok(match, text);
  return `${match[1]}.${match[2]}`;
}

test("a shopper who ticked the box gets one email 10 hours on, and its link opens the same cart", async (t) => {
  const f = await setup(t);
  const { headers, cartId } = await f.abandoned();
  await f.release(headers);
  await f.sweep(1000 + 10 * HOURS - 1);
  assert.equal(f.sent.length, 0, "not before 10 hours");
  await f.sweep(1000 + 10 * HOURS + 1);
  assert.equal(f.sent.length, 1);
  const [mail] = f.sent;
  assert.equal(mail.to, contact.email);
  assert.equal(mail.subject, "You left something in your cart at Test Shop");
  assert.match(mail.text, /1 x Hat|1 x /);
  assert.ok(mail.text.includes(`${TRUSTED_SITE}/cart/c/`));
  assert.match(mail.text, /To stop cart reminder emails: \S+&stop=1/);
  // A fresh key for the same cart, not the shopper's own cookie key.
  const key = linkKey(mail.text);
  assert.notEqual(key, headers[GUEST_CAPABILITY_HEADER]);
  const picked = await cartGuestCheckout(f.runtime, {}, { [GUEST_CAPABILITY_HEADER]: key });
  assert.equal(picked.ok, true, JSON.stringify(picked));
  assert.deepEqual(picked.cart.lines, [{ catalogItemId: "hat", quantity: 1 }]);
  assert.equal(picked.checkout.state, "released-retry");
  // At most one per cart: later runs, and a second unpaid checkout, send nothing.
  await f.sweep(1000 + 30 * HOURS);
  f.synth.setPayment("open");
  await startGuestCheckout(f.runtime, { contact, news: true }, headers);
  await f.release(headers);
  await f.sweep(1000 + 60 * HOURS);
  assert.equal(f.sent.length, 1);
  assert.equal((await f.carts.get(cartId)).emailed, true);
  assert.equal((await f.carts.get(cartId)).remindAt, undefined);
});

test("the stop link stops cart reminders to that email, for every later cart", async (t) => {
  const f = await setup(t);
  const first = await f.abandoned();
  await f.release(first.headers);
  await f.sweep(1000 + 11 * HOURS);
  const key = linkKey(f.sent[0].text);
  assert.equal((await cartGuestCheckout(f.runtime, { stop: "yes" }, { [GUEST_CAPABILITY_HEADER]: key }, f.stops)).error.code, "INVALID_CART");
  const stopped = await cartGuestCheckout(f.runtime, { stop: true }, { [GUEST_CAPABILITY_HEADER]: key }, f.stops);
  assert.equal(stopped.ok, true, JSON.stringify(stopped));
  assert.equal(f.stops.records.size, 1);
  // A stop needs the link's key.
  assert.equal((await cartGuestCheckout(f.runtime, { stop: true }, {}, f.stops)).error.code, "CAPABILITY_DENIED");
  // Kept by the email's hash, whatever its case.
  const second = await f.abandoned({ contact: { ...contact, email: "cart-shopper@example.test" }, news: true });
  await f.release(second.headers);
  await f.sweep(1000 + 22 * HOURS);
  assert.equal(f.sent.length, 1);
});

test("the owner's setting: ticked shoppers only by default, All customers, or Off", async (t) => {
  const f = await setup(t);
  const unticked = await f.abandoned({ contact });
  await f.release(unticked.headers);
  await f.sweep(1000 + 11 * HOURS);
  assert.equal(f.sent.length, 0, "no tick, no email by default");
  assert.equal((await f.carts.get(unticked.cartId)).remindAt, undefined, "looked at once");

  await f.mode("all");
  const any = await f.abandoned({ contact });
  await f.release(any.headers);
  await f.sweep(1000 + 11 * HOURS);
  assert.equal(f.sent.length, 1, "All customers");

  await f.mode("off");
  const ticked = await f.abandoned();
  await f.release(ticked.headers);
  await f.sweep(1000 + 11 * HOURS);
  assert.equal(f.sent.length, 1, "Off sends none, even when ticked");
});

test("a paid, emptied or still-open checkout gets no email", async (t) => {
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
  assert.equal(f.sent.length, 0);
  // The open checkout is looked at again an hour on; once it ends unpaid, the email goes.
  assert.equal((await f.carts.get(open.cartId)).remindAt, String(1000 + 12 * HOURS));
  await f.release(open.headers);
  await f.sweep(1000 + 12 * HOURS + 1);
  assert.equal(f.sent.length, 1);
});

test("the tick must be true, and a cart change keeps the reminder", async (t) => {
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
  assert.equal(f.sent.length, 1);
  // The cart no longer holds what went to checkout, so the email names no items.
  assert.doesNotMatch(f.sent[0].text, / x /);
});

test("the setting is saved as off, ticked or all, and anything else is refused", async (t) => {
  const f = await setup(t);
  const listing = f.ctx.storage.storefront_out_of_stock_listing;
  assert.equal((await f.mode("ticked")).changed, false, "ticked is the default");
  assert.equal((await f.mode("all")).listing.cartEmail, "all");
  assert.equal((await setOutOfStockListing(listing, { hideOutOfStock: true })).listing.cartEmail, "all", "left out keeps the choice");
  assert.equal("cartEmail" in (await f.mode("ticked")).listing, false);
  await assert.rejects(() => f.mode("sometimes"), /cartEmail only/);
});

test("the email's key lasts only as long as its cart, and its stop link stops the address it went to", async (t) => {
  const f = await setup(t);
  const { headers, cartId } = await f.abandoned();
  await f.release(headers);
  await f.sweep(1000 + 11 * HOURS);
  const emailed = { [GUEST_CAPABILITY_HEADER]: linkKey(f.sent[0].text) };
  // The shopper tries the same cart again with another email, which also ends unpaid.
  f.synth.setPayment("open");
  assert.equal((await startGuestCheckout(f.runtime, { contact: { ...contact, email: "sam@example.test" } }, headers)).ok, true);
  await f.release(headers);
  // The email's stop link stops the address it was sent to, not the latest checkout's; the shopper's own key stops nothing.
  assert.equal((await cartGuestCheckout(f.runtime, { stop: true }, headers, f.stops)).error.code, "CHECKOUT_NOT_FOUND");
  assert.equal((await cartGuestCheckout(f.runtime, { stop: true }, emailed, f.stops)).ok, true);
  assert.deepEqual([...f.stops.records.keys()], [await stopKey(contact.email)]);
  // Past the cart's 30 days the emailed key is refused, while the shopper's own key still answers.
  const expires = +(await f.carts.get(cartId)).cartExpires;
  const at = now => ({ ...f.runtime, host: { ...f.runtime.host, now: () => now } });
  assert.equal((await cartGuestCheckout(at(expires - 1), {}, emailed)).ok, true);
  assert.equal((await cartGuestCheckout(at(expires), {}, emailed)).error.code, "CAPABILITY_DENIED");
  assert.equal((await cartGuestCheckout(at(expires), {}, headers)).ok, true);
  // Once the cleanup deletes the cart, the emailed key cannot bring it back.
  await clearExpiredCarts(f.carts, expires + 1);
  assert.equal(await f.carts.get(cartId), null);
  const recreate = await cartGuestCheckout(f.runtime, { version: null, lines: [{ catalogItemId: "hat", quantity: 1 }] }, emailed);
  assert.equal(recreate.error.code, "CAPABILITY_DENIED");
  assert.equal(await f.carts.get(cartId), null);
  // The shopper's own key makes a new cart under the same id; the old emailed key stays refused for it.
  assert.equal((await cartGuestCheckout(f.runtime, { version: null, lines: [{ catalogItemId: "hat", quantity: 1 }] }, headers)).ok, true);
  assert.equal((await cartGuestCheckout(f.runtime, {}, emailed)).error.code, "CAPABILITY_DENIED");
  assert.equal((await cartGuestCheckout(f.runtime, { stop: true }, emailed, f.stops)).error.code, "CAPABILITY_DENIED");
});
