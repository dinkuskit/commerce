import { withSyntheticCheckoutContact } from './fixture.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import { openStore, fixture, cart } from "./fixture.mjs";
import { createTrustedTestPaymentPort, startCheckout } from "../../../dist/features/checkout/index.js";
import { projectGuestCheckout } from "../../../dist/index.js";

// What a checkout with nothing to ship freezes as its shipping, whatever the store's configuration says.
const NOT_SHIPPED = { configurationId: "not-shipped", revision: 1, mode: "free", charge: { currency: "USD", minor: "0" } };

async function setup() {
  const opened = openStore(":memory:");
  const fixtureState = fixture(opened.store, false);
  fixtureState.execution.now = () => 1791288000;
  return { ...fixtureState, opened };
}

/** An add-on's answer as the store's own code hands it in (commerce-addons-door-20261124): one is $0.50 a line off "one", $0.50 off "two". */
const answer = (offs = ["50", "50"], extra = {}) => ({ from: "dinkus-coupons", ref: "hold-1", codes: ["SAVE10"],
  lines: [{ item: "one", price: "75", qty: 2, off: offs[0] }, { item: "two", price: "100", qty: 1, off: offs[1] }], ...extra });

test("add-on answers price the lines, flat shipping, conservation, and replay immutability", async (t) => {
  const state = await setup();
  t.after(() => state.opened.db.close());
  let calls = 0;
  state.execution.pricing = {
    resolveShippingConfiguration: async () => ({
      configurationId: "ship-1",
      revision: 3,
      mode: "flat",
      amount: { currency: "USD", minor: "50" },
    }),
    paymentPricingSchema: 'dinkuskit.commerce.checkout-pricing/v1',
  };
  state.execution.resolvePayments = async () => ({
    pricingSchema: 'dinkuskit.commerce.checkout-pricing/v1',
    ensureSession: async (request) => {
      calls += 1;
      return {
        outcome: "open",
        attemptId: request.attemptId,
        total: request.total,
        session: {
          sessionId: `session-${request.attemptId}`,
          redirectUrl: "https://pay.example/session",
          createdAt: 1000,
          expiresAt: 2800,
        },
      };
    },
    lookup: async () => ({ outcome: "unknown" }),
  });
  const first = await startCheckout(state.execution, "priced-cart", withSyntheticCheckoutContact({ lines: cart, addons: [answer()] }));
  assert.equal(first.payment.pricing.finalTotal.minor, "200");
  assert.equal(first.payment.pricing.merchandiseSubtotal.minor, "250");
  assert.equal(first.payment.pricing.couponDiscount.minor, "100");
  assert.equal(first.payment.pricing.netMerchandise.minor, "150");
  assert.equal(first.payment.pricing.shipping.charge.minor, "50");
  assert.equal(first.payment.pricing.lines.reduce((sum, line) => sum + BigInt(line.discount.minor), 0n), 100n);
  state.execution.pricing.resolveShippingConfiguration = async () => ({
    configurationId: "changed",
    revision: 4,
    mode: "flat",
    amount: { currency: "USD", minor: "999" },
  });
  assert.deepEqual(first.payment.pricing.lines.map(line => [line.discount.minor, line.netAmount.minor]), [["50", "100"], ["50", "50"]]);
  assert.deepEqual(first.addons, [{ from: "dinkus-coupons", ref: "hold-1", codes: ["SAVE10"] }]);
  // The same codes replay the frozen checkout, even with another reference; other codes or none are refused while it is open.
  const replay = await startCheckout(state.execution, "priced-cart", withSyntheticCheckoutContact({ lines: cart, addons: [answer(["0", "0"], { ref: "hold-2" })] }));
  for (const other of [{ addons: [answer(undefined, { codes: ["OTHER"] })] }, {}]) {
    await assert.rejects(() => startCheckout(state.execution, "priced-cart", withSyntheticCheckoutContact({ lines: cart, ...other })), /frozen/);
  }
  assert.equal(replay.payment.pricing.finalTotal.minor, "200");
  assert.equal(replay.payment.pricing.shipping.configurationId, "ship-1");
  assert.equal(calls, 2);
});

// checkout-free-shipping-over-20261027: the owner's amount from DinkusKit.com waives flat shipping.
test("flat shipping is free once the goods reach the owner's free-shipping amount", async (t) => {
  const state = await setup();
  t.after(() => state.opened.db.close());
  let freeOver = "250";
  state.execution.pricing = {
    resolveShippingConfiguration: async () => ({
      configurationId: "ship-1", revision: 5, mode: "flat",
      amount: { currency: "USD", minor: "50" }, freeOver: { currency: "USD", minor: freeOver },
    }),
    paymentPricingSchema: 'dinkuskit.commerce.checkout-pricing/v1',
  };
  state.execution.resolvePayments = async () => ({
    pricingSchema: 'dinkuskit.commerce.checkout-pricing/v1',
    ensureSession: async (request) => ({
      outcome: "open", attemptId: request.attemptId, total: request.total,
      session: { sessionId: `session-${request.attemptId}`, redirectUrl: "https://pay.example/session", createdAt: 1000, expiresAt: 2800 },
    }),
    lookup: async () => ({ outcome: "unknown" }),
  });
  const reached = (await startCheckout(state.execution, "free-over", withSyntheticCheckoutContact({ lines: cart }))).payment.pricing;
  assert.equal(reached.netMerchandise.minor, "250");
  assert.deepEqual(reached.shipping, { configurationId: "ship-1", revision: 5, mode: "free", charge: { currency: "USD", minor: "0" } });
  assert.equal(reached.finalTotal.minor, "250");
  freeOver = "251";
  const under = (await startCheckout(state.execution, "under-free-over", withSyntheticCheckoutContact({ lines: cart }))).payment.pricing;
  assert.deepEqual(under.shipping, { configurationId: "ship-1", revision: 5, mode: "flat", charge: { currency: "USD", minor: "50" } });
  assert.equal(under.finalTotal.minor, "300");
  freeOver = "0";
  await assert.rejects(() => startCheckout(state.execution, "zero-free-over", withSyntheticCheckoutContact({ lines: cart })), /Invalid shipping configuration/);
});

test("unsupported pricing schema fails before payment resolution", async (t) => {
  const state = await setup();
  t.after(() => state.opened.db.close());
  let resolved = 0;
  state.execution.pricing = {
    resolveShippingConfiguration: async () => ({
      configurationId: "ship-1", revision: 1, mode: "free",
    }),
  };
  state.execution.resolvePayments = async () => {
    resolved += 1;
    throw new Error("must not resolve");
  };
  await assert.rejects(
    () => startCheckout(state.execution, "unsupported", withSyntheticCheckoutContact({ lines: cart, addons: [answer()] })),
    /pricing schema unsupported/,
  );
  assert.equal(resolved, 0);
});

// checkout-digital-only-no-shipping-20261031 (issue 235): nothing physical, nothing to ship.
test("a checkout with only digital items pays no shipping; one physical item brings the charge back", async (t) => {
  const state = await setup();
  t.after(() => state.opened.db.close());
  let freeOver;
  state.execution.pricing = {
    resolveShippingConfiguration: async () => ({
      configurationId: "ship-1", revision: 7, mode: "flat", amount: { currency: "USD", minor: "500" },
      ...(freeOver ? { freeOver: { currency: "USD", minor: freeOver } } : {}),
    }),
    paymentPricingSchema: 'dinkuskit.commerce.checkout-pricing/v1',
  };
  state.execution.resolvePayments = async () => ({
    pricingSchema: 'dinkuskit.commerce.checkout-pricing/v1',
    ensureSession: async (request) => ({
      outcome: "open", attemptId: request.attemptId, total: request.total,
      session: { sessionId: `session-${request.attemptId}`, redirectUrl: "https://pay.example/session", createdAt: 1000, expiresAt: 2800 },
    }),
    lookup: async () => ({ outcome: "unknown" }),
  });
  const items = state.execution.catalog.catalog.records;
  const mark = (id, fulfillment) => items.set(id, { ...items.get(id), fulfillment });
  mark("one", "digital");
  mark("two", "digital");
  const digital = await startCheckout(state.execution, "digital-only", withSyntheticCheckoutContact({ lines: cart }));
  assert.deepEqual(digital.payment.pricing.shipping, NOT_SHIPPED);
  assert.equal(digital.payment.pricing.finalTotal.minor, "250");
  assert.equal(digital.payment.total.minor, "250");
  assert.equal(digital.contactSnapshot.contact.delivery, undefined);

  // One physical item (here unmarked, which counts as physical) keeps the flat charge, once.
  mark("two", undefined);
  const mixed = await startCheckout(state.execution, "mixed", withSyntheticCheckoutContact({ lines: cart }));
  assert.deepEqual(mixed.payment.pricing.shipping, { configurationId: "ship-1", revision: 7, mode: "flat", charge: { currency: "USD", minor: "500" } });
  assert.equal(mixed.payment.pricing.finalTotal.minor, "750");

  // Free shipping over still waives a mixed basket's charge.
  freeOver = "250";
  const waived = await startCheckout(state.execution, "mixed-free-over", withSyntheticCheckoutContact({ lines: cart }));
  assert.equal(waived.payment.pricing.shipping.mode, "free");
  assert.equal(waived.payment.pricing.finalTotal.minor, "250");

  // A broken shipping configuration stops the basket that ships, never the digital-only one (issue 302).
  freeOver = "0";
  await assert.rejects(() => startCheckout(state.execution, "mixed-bad-config", withSyntheticCheckoutContact({ lines: cart })), /Invalid shipping configuration/);
  mark("two", "digital");
  const unread = await startCheckout(state.execution, "digital-bad-config", withSyntheticCheckoutContact({ lines: cart }));
  assert.deepEqual(unread.payment.pricing.shipping, NOT_SHIPPED);
});

// Issue 302: a store that ships nothing needs no shipping configuration, and checkout never reads it.
test("a digital-only checkout neither reads nor needs the shipping configuration, with or without an add-on answer", async (t) => {
  const state = await setup();
  t.after(() => state.opened.db.close());
  let reads = 0;
  state.execution.pricing = {
    resolveShippingConfiguration: async () => { reads += 1; return null; },
    paymentPricingSchema: 'dinkuskit.commerce.checkout-pricing/v1',
  };
  const requests = [];
  state.execution.resolvePayments = async () => ({
    pricingSchema: 'dinkuskit.commerce.checkout-pricing/v1',
    ensureSession: async (request) => {
      requests.push(request);
      return { outcome: "open", attemptId: request.attemptId, total: request.total,
        session: { sessionId: `session-${request.attemptId}`, redirectUrl: "https://pay.example/session", createdAt: 1000, expiresAt: 2800 } };
    },
    lookup: async () => ({ outcome: "unknown" }),
  });
  const items = state.execution.catalog.catalog.records;
  const mark = (id, fulfillment) => items.set(id, { ...items.get(id), fulfillment });
  mark("one", "digital");
  mark("two", "digital");

  const plain = await startCheckout(state.execution, "digital-no-config", withSyntheticCheckoutContact({ lines: cart }));
  assert.deepEqual(plain.payment.pricing.shipping, NOT_SHIPPED);
  assert.equal(plain.payment.pricing.finalTotal.minor, "250");
  assert.equal(plain.payment.total.minor, "250");

  const couponed = await startCheckout(state.execution, "digital-no-config-coupon", withSyntheticCheckoutContact({ lines: cart, addons: [answer()] }));
  assert.deepEqual(couponed.payment.pricing.shipping, NOT_SHIPPED);
  assert.equal(couponed.payment.pricing.couponDiscount.minor, "100");
  assert.equal(couponed.payment.pricing.finalTotal.minor, "150");
  assert.equal(couponed.payment.total.minor, "150");
  assert.equal(requests.length, 2);
  assert.equal(reads, 0);

  // One physical item needs the configuration again, and nothing is frozen or sent without it.
  mark("two", undefined);
  await assert.rejects(() => startCheckout(state.execution, "physical-no-config", withSyntheticCheckoutContact({ lines: cart })), /Pricing configuration unavailable/);
  await assert.rejects(() => startCheckout(state.execution, "physical-no-config-coupon", withSyntheticCheckoutContact({ lines: cart, addons: [answer()] })), /Pricing configuration unavailable/);
  assert.equal(reads, 2);
  assert.equal(requests.length, 2);
  assert.equal(await state.execution.store.read("physical-no-config"), null);
});

// commerce-addons-door-20261124: the answer must have seen Commerce's own items and prices, and stay in bounds.
test("add-on answers that saw other prices, take a line below zero or break the bounds freeze nothing", async (t) => {
  const state = await setup();
  t.after(() => state.opened.db.close());
  let calls = 0;
  state.execution.pricing = {
    resolveShippingConfiguration: async () => ({ configurationId: "ship-1", revision: 1, mode: "flat", amount: { currency: "USD", minor: "50" } }),
    paymentPricingSchema: 'dinkuskit.commerce.checkout-pricing/v1',
  };
  state.execution.resolvePayments = async () => { calls += 1; throw new Error("must not resolve"); };
  const start = (addons) => startCheckout(state.execution, "bad-answers", withSyntheticCheckoutContact({ lines: cart, addons }));
  await assert.rejects(() => start([answer(undefined, { lines: [{ item: "one", price: "100", qty: 2, off: "0" }, { item: "two", price: "100", qty: 1, off: "0" }] })]), /contention/);
  await assert.rejects(() => start([answer(undefined, { lines: [{ item: "two", price: "100", qty: 1, off: "0" }, { item: "one", price: "75", qty: 2, off: "0" }] })]), /contention/);
  await assert.rejects(() => start([answer(undefined, { lines: [{ item: "one", price: "75", qty: 2, off: "0" }] })]), /contention/);
  // A quantity the add-on did not see (the shopper changed the cart since the store asked) is contention too.
  await assert.rejects(() => start([answer(undefined, { lines: [{ item: "one", price: "75", qty: 1, off: "50" }, { item: "two", price: "100", qty: 1, off: "0" }] })]), /contention/);
  await assert.rejects(() => start([answer(["151", "0"])]), /Invalid add-on answer/);
  await assert.rejects(() => start([answer(["100", "0"]), { from: "other", lines: [{ item: "one", price: "75", qty: 2, off: "51" }, { item: "two", price: "100", qty: 1, off: "0" }] }]), /Invalid add-on answer/);
  for (const bad of [[], [answer(), answer()], Array(5).fill(0).map((_, i) => answer(undefined, { from: "a" + i })), [answer(["-1", "0"])],
    [answer(["1.5", "0"])], [answer(["1000000001", "0"])], [answer(undefined, { ship: true })], [answer(undefined, { codes: Array(7).fill("X") })],
    [answer(undefined, { codes: ["x".repeat(65)] })], [answer(undefined, { ref: "" })], [answer(undefined, { from: "x".repeat(65) })], [answer(undefined, { rate: "0.07" })]]) {
    await assert.rejects(() => start(bad), JSON.stringify(bad).slice(0, 80));
  }
  assert.equal(calls, 0);
  assert.equal(await state.execution.store.read("bad-answers"), null);
});

test("the Payments adapter sends an add-on priced checkout unchanged and refuses divergent arithmetic before any call", async (t) => {
  const state = await setup();
  t.after(() => state.opened.db.close());
  state.execution.pricing = {
    resolveShippingConfiguration: async () => ({ configurationId: "ship-1", revision: 1, mode: "flat", amount: { currency: "USD", minor: "50" } }),
    paymentPricingSchema: 'dinkuskit.commerce.checkout-pricing/v1',
  };
  state.execution.resolvePayments = async () => ({ pricingSchema: 'dinkuskit.commerce.checkout-pricing/v1',
    ensureSession: async () => ({ outcome: "unknown" }), lookup: async () => ({ outcome: "unknown" }) });
  const a = await startCheckout(state.execution, "adapter", withSyntheticCheckoutContact({ lines: cart, addons: [answer()] }));
  let credentials = 0;
  const calls = [];
  const port = createTrustedTestPaymentPort({
    paymentsOrigin: 'https://payments.example', commerceOrigin: 'https://store.example', siteId: 'synthetic-site',
    bindingRef: a.payment.bindingRef, providerId: 'stripe', stripeAccountId: 'synthetic-account', pricingSchema: a.payment.pricing.schema,
    credentialResolver: async () => { credentials++; return 'synthetic-test-token'; },
    fetch: async (url, init) => {
      calls.push({ url, body: init.body });
      return new Response(JSON.stringify(init.method === 'GET' ? {
        bindingRef: a.payment.bindingRef, providerId: 'stripe', stripeAccountId: 'synthetic-account', mode: 'test', ready: true,
      } : { outcome: 'unknown' }));
    },
  });
  const mutations = [
    r => { r.total.minor = '201'; },
    r => { r.pricing.finalTotal.minor = '201'; },
    r => { r.pricing.couponDiscount.minor = '99'; },
    r => { r.pricing.netMerchandise.minor = '151'; },
    r => { r.pricing.shipping.mode = 'free'; },
    r => { r.pricing.lines[0].discount.minor = '49'; },
    r => { r.pricing.lines[0].netAmount.minor = '101'; },
    r => { r.pricing.lines[1].discount.minor = '150'; r.pricing.lines[1].netAmount.minor = '-50'; },
    r => { r.pricing.lines.pop(); },
  ];
  for (const mutate of mutations) {
    const request = structuredClone(a.payment);
    mutate(request);
    await assert.rejects(port.ensureSession(request), /Malformed payment pricing|Invalid/);
    await assert.rejects(port.lookup(request), /Malformed payment pricing|Invalid/);
  }
  assert.equal(credentials, 0);
  assert.equal(calls.length, 0);
  await port.ensureSession(a.payment);
  assert.deepEqual(JSON.parse(calls.at(-1).body), a.payment);
  assert.equal(JSON.parse(calls.at(-1).body).total.minor, '200');
});

// dinkuskit/tax ledger: Tax picks each line's rate and shipping's (tax-picks-rate-commerce-does-math), through the add-ons door
// beside Coupons (shared-addons-door); Commerce takes discounts off first, then rounds each line's tax once, halves up (round-per-line-half-up).
const TO = "1 Example Way\n\nTestville\nCA\n00000\nUS";
const taxAnswer = (rates = ["97500", "70000"], extra = {}) => ({ from: "dinkus-tax", ref: "tax-1", to: TO, shipRate: "97500",
  lines: [{ item: "one", price: "75", qty: 2, off: "0", rate: rates[0] }, { item: "two", price: "100", qty: 1, off: "0", rate: rates[1] }], ...extra });
const flatPricing = () => ({
  resolveShippingConfiguration: async () => ({ configurationId: "ship-1", revision: 1, mode: "flat", amount: { currency: "USD", minor: "50" } }),
  paymentPricingSchema: 'dinkuskit.commerce.checkout-pricing/v1',
});
const openPayments = () => ({ pricingSchema: 'dinkuskit.commerce.checkout-pricing/v1',
  ensureSession: async (request) => ({ outcome: "open", attemptId: request.attemptId, total: request.total,
    session: { sessionId: `session-${request.attemptId}`, redirectUrl: "https://pay.example/session", createdAt: 1000, expiresAt: 2800 } }),
  lookup: async () => ({ outcome: "unknown" }) });

test("a tax answer taxes each line after discounts and shipping, rounding each line once, halves up", async (t) => {
  const state = await setup();
  t.after(() => state.opened.db.close());
  state.execution.pricing = flatPricing();
  state.execution.resolvePayments = async () => openPayments();
  const a = await startCheckout(state.execution, "taxed", withSyntheticCheckoutContact({ lines: cart, addons: [answer(), taxAnswer()] }));
  const p = a.payment.pricing;
  // "one" is $1.50 less $0.50 off: 9.75% of $1.00 is 9.75¢, so 10¢. "two" is $1.00 less $0.50: 7% of 50¢ is 3.5¢, so 4¢.
  assert.deepEqual(p.lines.map(line => [line.netAmount.minor, line.tax.minor]), [["100", "10"], ["50", "4"]]);
  // Shipping: 9.75% of 50¢ is 4.875¢, so 5¢. All tax is 19¢: $1.50 of goods + 50¢ shipping + 19¢.
  assert.deepEqual([p.tax.minor, p.finalTotal.minor, a.payment.total.minor], ["19", "219", "219"]);
  // The order keeps who answered and their references, never the address or the rates.
  assert.deepEqual(a.addons, [{ from: "dinkus-coupons", ref: "hold-1", codes: ["SAVE10"] }, { from: "dinkus-tax", ref: "tax-1" }]);
  // The thank-you page shows the tax the shopper paid.
  const shown = projectGuestCheckout({ ...a, phase: "paid", order: { orderId: "order-taxed", receiptId: "receipt-taxed", total: a.payment.total, pricing: p } }, 2000);
  assert.deepEqual([shown.order.pricing.tax, shown.order.pricing.finalTotal], [{ currency: "USD", minor: "19" }, { currency: "USD", minor: "219" }]);

  // A rate of zero on every line and on shipping still records tax, at zero.
  const zero = await startCheckout(state.execution, "untaxed", withSyntheticCheckoutContact({ lines: cart, addons: [taxAnswer(["0", "0"], { shipRate: "0" })] }));
  assert.deepEqual([zero.payment.pricing.tax.minor, zero.payment.pricing.finalTotal.minor], ["0", "300"]);
  // Without a tax answer the pricing carries no tax at all, so a Payments service that knows no tax still takes it.
  const plain = await startCheckout(state.execution, "plain", withSyntheticCheckoutContact({ lines: cart, addons: [answer()] }));
  assert.equal("tax" in plain.payment.pricing, false);
  assert.equal(plain.payment.pricing.lines.some(line => "tax" in line), false);
});

test("a tax answer for another address, or with a missing or malformed rate, freezes nothing", async (t) => {
  const state = await setup();
  t.after(() => state.opened.db.close());
  let calls = 0;
  state.execution.pricing = flatPricing();
  state.execution.resolvePayments = async () => { calls += 1; throw new Error("must not resolve"); };
  const start = (addons) => startCheckout(state.execution, "bad-tax", withSyntheticCheckoutContact({ lines: cart, addons }));
  // Priced for another street: the shopper changed the address since the store asked Tax.
  await assert.rejects(() => start([taxAnswer(undefined, { to: TO.replace("1 Example", "2 Example") })]), /contention/);
  const noRate = taxAnswer();
  delete noRate.lines[1].rate;
  for (const bad of [[noRate], [taxAnswer(["1000000", "0"])], [taxAnswer(["9.75", "0"])], [taxAnswer(["-1", "0"])],
    [taxAnswer(undefined, { shipRate: "0.0975" })], [taxAnswer(undefined, { shipRate: undefined })], [taxAnswer(undefined, { to: 7 })],
    // A rate only counts beside the address it was priced for.
    [answer(undefined, { lines: taxAnswer().lines })], [answer(undefined, { shipRate: "97500" })]]) {
    await assert.rejects(() => start(bad), JSON.stringify(bad).slice(0, 80));
  }
  assert.equal(calls, 0);
  assert.equal(await state.execution.store.read("bad-tax"), null);
});

test("the Payments adapter sends a taxed checkout unchanged and refuses tax that does not add up", async (t) => {
  const state = await setup();
  t.after(() => state.opened.db.close());
  state.execution.pricing = flatPricing();
  state.execution.resolvePayments = async () => ({ pricingSchema: 'dinkuskit.commerce.checkout-pricing/v1',
    ensureSession: async () => ({ outcome: "unknown" }), lookup: async () => ({ outcome: "unknown" }) });
  const a = await startCheckout(state.execution, "taxed-adapter", withSyntheticCheckoutContact({ lines: cart, addons: [answer(), taxAnswer()] }));
  const calls = [];
  const port = createTrustedTestPaymentPort({
    paymentsOrigin: 'https://payments.example', commerceOrigin: 'https://store.example', siteId: 'synthetic-site',
    bindingRef: a.payment.bindingRef, providerId: 'stripe', stripeAccountId: 'synthetic-account', pricingSchema: a.payment.pricing.schema,
    credentialResolver: async () => 'synthetic-test-token',
    fetch: async (url, init) => {
      calls.push({ url, body: init.body });
      return new Response(JSON.stringify(init.method === 'GET' ? {
        bindingRef: a.payment.bindingRef, providerId: 'stripe', stripeAccountId: 'synthetic-account', mode: 'test', ready: true,
      } : { outcome: 'unknown' }));
    },
  });
  const mutations = [
    r => { r.pricing.tax.minor = '20'; },
    r => { delete r.pricing.tax; },
    r => { delete r.pricing.lines[0].tax; },
    r => { r.pricing.lines[0].tax.minor = '16'; },
  ];
  for (const mutate of mutations) {
    const request = structuredClone(a.payment);
    mutate(request);
    await assert.rejects(port.ensureSession(request), /Malformed payment pricing|Invalid/);
  }
  assert.equal(calls.length, 0);
  await port.ensureSession(a.payment);
  assert.deepEqual(JSON.parse(calls.at(-1).body), a.payment);
  assert.equal(JSON.parse(calls.at(-1).body).pricing.tax.minor, '19');
});
