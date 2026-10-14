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
const isolatedShip = { origin: 'https://ship.sm0ky.dev', audience: 'dinkus-ship-sandbox', recipient: 'ship-sandbox', generation: 'fixture-generation-1', mode: 'test' };

test('isolated Ship admits only the fixed complete TEST tuple; old shape cannot access sandbox', () => {
  assert.deepEqual(admitRegistryCheckoutConfig(legacyStripe({ ship: isolatedShip }), SITE).ship, isolatedShip);
  for (const change of [{ origin: 'https://other.test' }, { audience: 'production' }, { recipient: 'other' }, { generation: '' }, { generation: 'x'.repeat(129) }, { mode: 'live' }]) rejects(legacyStripe({ ship: { ...isolatedShip, ...change } }));
  for (const key of ['recipient','generation','mode']) { const ship = { ...isolatedShip }; delete ship[key]; rejects(legacyStripe({ ship })); }
  rejects(legacyStripe({ ship: { origin: isolatedShip.origin, audience: isolatedShip.audience } }));
  for (const origin of ['https://ship.sm0ky.dev/','https://SHIP.sm0ky.dev','https://ship.sm0ky.dev:443']) rejects(legacyStripe({ship:{origin,audience:'legacy-audience'}}));
  rejects(legacyStripe({ mode: 'live', ship: isolatedShip }));
});

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

test("unknown providers, unknown modes, and overloaded stripeAccountId fail closed", () => {
  rejects(legacyStripe({ providerId: "unsupported" }));
  for (const mode of ["LIVE", "production", "sandbox", "", null, true]) {
    rejects(legacyStripe({ mode }));
    rejects(authorizeNet({ mode }));
  }
  rejects(authorizeNet({ stripeAccountId: "acct_wrong" }));
  rejects(legacyStripe({ authorizeNetMerchantId: "anet" }));
  rejects(authorizeNet({ mode: "test", stripeAccountId: "acct_x" }));
});

test("optional mode test or live is admitted for both providers and reaches the Payments host", () => {
  for (const mode of ["test", "live"]) {
    const stripe = admitRegistryCheckoutConfig(legacyStripe({ mode }), SITE);
    assert.equal(stripe.mode, mode);
    assert.equal(trustedPaymentsHostConfig(stripe, SITE).mode, mode);
    assert.equal(admitRegistryCheckoutConfig(authorizeNet({ mode }), SITE).mode, mode);
  }
  assert.equal(trustedPaymentsHostConfig(admitRegistryCheckoutConfig(legacyStripe(), SITE), SITE).mode, undefined);
});

test("an optional hosted coupon or Ship service needs exactly an https origin and an audience", () => {
  for (const name of ["coupons", "ship"]) {
    const service = { origin: `https://${name}.example.test`, audience: `${name}-aud` };
    const config = changes => legacyStripe({ [name]: { ...service, ...changes } });
    assert.deepEqual(admitRegistryCheckoutConfig(config(), SITE)[name], service);
    assert.deepEqual(admitRegistryCheckoutConfig(authorizeNet({ mode: "test", [name]: service }), SITE)[name], service);
    assert.equal(admitRegistryCheckoutConfig(legacyStripe(), SITE)[name], undefined);
    rejects(legacyStripe({ [name]: null }));
    rejects(legacyStripe({ [name]: { origin: service.origin } }));
    rejects(config({ issuer: "https://identity.example.test" }));
    rejects(config({ origin: `http://${name}.example.test` }));
    rejects(config({ origin: `https://${name}.example.test/v1` }));
    rejects(config({ audience: "" }));
  }
  const coupons = { origin: "https://coupons.example.test", audience: "coupons-aud" };
  const ship = { origin: "https://ship.example.test", audience: "ship-aud" };
  const both = admitRegistryCheckoutConfig(legacyStripe({ mode: "live", coupons, ship }), SITE);
  assert.deepEqual([both.mode, both.coupons, both.ship], ["live", coupons, ship]);
  rejects(legacyStripe({ coupons, ship, shipping2: ship }));
});
