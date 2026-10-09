import assert from "node:assert/strict";
import test from "node:test";
import {
  GuestCheckoutError,
  REGISTRY_CHECKOUT_CONFIG_SCHEMA,
  admitRegistryCheckoutConfig,
  trustedPaymentsHostConfig,
} from "../../../dist/features/checkout/index.js";

const SITE = "https://shop.example.test";
const shipping = { configurationId: "ship", revision: 1, mode: "free" };

function legacyStripe(extra = {}) {
  return {
    schema: REGISTRY_CHECKOUT_CONFIG_SCHEMA,
    enabled: true,
    commerceOrigin: SITE,
    siteId: "site",
    paymentsOrigin: "https://payments.example.test",
    bindingRef: "binding",
    providerId: "stripe",
    stripeAccountId: "acct_legacy",
    pricingSchema: "dinkuskit.commerce.checkout-pricing/v1",
    issuer: "https://identity.example.test",
    audience: "aud",
    shipping,
    ...extra,
  };
}

function authorizeNet(extra = {}) {
  const { stripeAccountId: _drop, ...base } = legacyStripe();
  return { ...base, providerId: "authorize_net", ...extra };
}

function rejects(config) {
  assert.throws(
    () => admitRegistryCheckoutConfig(config, SITE),
    (error) => error instanceof GuestCheckoutError && error.code === "UNAVAILABLE",
  );
}

test("legacy enabled v1 stripe config without mode or authorize fields still admits", () => {
  const admitted = admitRegistryCheckoutConfig(legacyStripe(), SITE);
  assert.equal(admitted.providerId, "stripe");
  assert.equal(admitted.stripeAccountId, "acct_legacy");
  assert.equal(admitted.mode, undefined);
  assert.equal(admitted.authorizeNetMerchantId, undefined);
});

test("authorize_net is admitted beside stripe with optional merchant field", () => {
  const bare = admitRegistryCheckoutConfig(authorizeNet(), SITE);
  assert.equal(bare.providerId, "authorize_net");
  assert.equal(bare.stripeAccountId, undefined);
  assert.equal(bare.authorizeNetMerchantId, undefined);
  const withMerchant = admitRegistryCheckoutConfig(
    authorizeNet({ authorizeNetMerchantId: "anet_merchant" }),
    SITE,
  );
  assert.equal(withMerchant.authorizeNetMerchantId, "anet_merchant");
  const host = trustedPaymentsHostConfig(withMerchant, SITE);
  assert.equal(host.providerId, "authorize_net");
  assert.equal(host.authorizeNetMerchantId, "anet_merchant");
  assert.equal(host.stripeAccountId, undefined);
});

test("unknown providers, live mode, and overloaded stripeAccountId fail closed", () => {
  rejects(legacyStripe({ providerId: "unsupported" }));
  rejects(legacyStripe({ mode: "live" }));
  rejects(authorizeNet({ mode: "live" }));
  rejects(authorizeNet({ stripeAccountId: "acct_wrong" }));
  rejects(legacyStripe({ authorizeNetMerchantId: "anet" }));
  rejects(authorizeNet({ mode: "test", stripeAccountId: "acct_x" }));
});

test("optional mode test is admitted for both providers", () => {
  assert.equal(admitRegistryCheckoutConfig(legacyStripe({ mode: "test" }), SITE).mode, "test");
  assert.equal(admitRegistryCheckoutConfig(authorizeNet({ mode: "test" }), SITE).mode, "test");
});

test("an optional hosted coupon service needs exactly an https origin and an audience", () => {
  const coupons = { origin: "https://coupons.example.test", audience: "coupons-aud" };
  assert.deepEqual(admitRegistryCheckoutConfig(legacyStripe({ coupons }), SITE).coupons, coupons);
  assert.deepEqual(admitRegistryCheckoutConfig(authorizeNet({ mode: "test", coupons }), SITE).coupons, coupons);
  assert.equal(admitRegistryCheckoutConfig(legacyStripe(), SITE).coupons, undefined);
  rejects(legacyStripe({ coupons: null }));
  rejects(legacyStripe({ coupons: { origin: coupons.origin } }));
  rejects(legacyStripe({ coupons: { ...coupons, issuer: "https://identity.example.test" } }));
  rejects(legacyStripe({ coupons: { ...coupons, origin: "http://coupons.example.test" } }));
  rejects(legacyStripe({ coupons: { ...coupons, origin: "https://coupons.example.test/v1" } }));
  rejects(legacyStripe({ coupons: { ...coupons, audience: "" } }));
});
