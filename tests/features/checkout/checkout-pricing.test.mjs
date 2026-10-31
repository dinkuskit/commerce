import { withSyntheticCheckoutContact } from './fixture.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import { openStore, fixture, cart } from "./fixture.mjs";
import { createCheckoutCouponPort, createCouponAdmin } from "../../../dist/features/coupons/index.js";
import { startCheckout } from "../../../dist/features/checkout/index.js";

function couponCollection() {
  const records = new Map();
  return {
    async get(id) { return structuredClone(records.get(id)?.value ?? null); },
    async getVersioned(id) {
      const record = records.get(id);
      return record ? { revision: record.revision, value: structuredClone(record.value) } : null;
    },
    async put(id, value) { records.set(id, { revision: "1", value: structuredClone(value) }); },
    async query() {
      return { items: [...records].map(([id, record]) => ({ id, data: structuredClone(record.value) })), hasMore: false };
    },
    async compareAndSet(id, revision, value) {
      const record = records.get(id);
      if (!record || record.revision !== revision) return { applied: false };
      records.set(id, { revision: String(Number(revision) + 1), value: structuredClone(value) });
      return { applied: true };
    },
  };
}

async function setup() {
  const opened = openStore(":memory:");
  const fixtureState = fixture(opened.store, false);
  const coupons = couponCollection();
  const admin = createCouponAdmin(coupons);
  await admin.create({
    code: "SAVE10",
    globalCap: 8,
    rule: {
      ruleId: "pricing-rule",
      version: 1,
      discount: { kind: "fixed", amount: { currency: "USD", minor: "100" } },
      appliesTo: "all-merchandise",
      selectedProductIds: [],
      includeSaleItems: true,
      minimumEligibleMerchandise: { currency: "USD", minor: "0" },
      startsAt: "2026-01-01T00:00:00Z",
      endsAt: "2027-01-01T00:00:00Z",
      timeZone: "UTC",
    },
  });
  fixtureState.execution.now = () => 1791288000;
  return { ...fixtureState, coupons, opened };
}

test("pricing composes real coupon evaluation, flat shipping, conservation, and replay immutability", async (t) => {
  const state = await setup();
  t.after(() => state.opened.db.close());
  let calls = 0;
  state.execution.pricing = {
    coupons: createCheckoutCouponPort(state.coupons),
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
  const first = await startCheckout(state.execution, "priced-cart", withSyntheticCheckoutContact({ lines: cart, couponCode: "save10" }));
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
  const replay = await startCheckout(state.execution, "priced-cart", withSyntheticCheckoutContact({ lines: cart, couponCode: "SAVE10" }));
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
    coupons: createCheckoutCouponPort(state.coupons),
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
    coupons: createCheckoutCouponPort(state.coupons),
    resolveShippingConfiguration: async () => ({
      configurationId: "ship-1", revision: 1, mode: "free",
    }),
  };
  state.execution.resolvePayments = async () => {
    resolved += 1;
    throw new Error("must not resolve");
  };
  await assert.rejects(
    () => startCheckout(state.execution, "unsupported", withSyntheticCheckoutContact({ lines: cart, couponCode: "SAVE10" })),
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
    coupons: createCheckoutCouponPort(state.coupons),
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
  assert.deepEqual(digital.payment.pricing.shipping, { configurationId: "ship-1", revision: 7, mode: "free", charge: { currency: "USD", minor: "0" } });
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

  // A broken shipping configuration still stops a digital-only checkout.
  mark("two", "digital");
  freeOver = "0";
  await assert.rejects(() => startCheckout(state.execution, "digital-bad-config", withSyntheticCheckoutContact({ lines: cart })), /Invalid shipping configuration/);
});
