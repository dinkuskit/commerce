import { withSyntheticCheckoutContact } from './fixture.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import { openStore, fixture, cart } from "./fixture.mjs";
import { createCouponAdmin } from "../../../dist/features/coupons/index.js";
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
    coupons: state.coupons,
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

test("unsupported pricing schema fails before payment resolution", async (t) => {
  const state = await setup();
  t.after(() => state.opened.db.close());
  let resolved = 0;
  state.execution.pricing = {
    coupons: state.coupons,
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
