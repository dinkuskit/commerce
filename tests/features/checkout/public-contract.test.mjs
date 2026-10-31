import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as checkout from "@dinkuskit/commerce/features/checkout";
import * as commerce from "@dinkuskit/commerce";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const contract = readFileSync(join(root, "docs/implementation/guest-checkout-public.md"), "utf8");

test("reference prepare example matches the public capability presentation, not a flat token", async () => {
  const reference = readFileSync(join(root, "docs/website/reference/commerce.md"), "utf8");
  const example = reference.match(/<!-- guest-prepare-capability-example -->\s*```json\n([\s\S]*?)\n```/);
  assert.ok(example, "reference must show the capability presentation object");
  const expected = JSON.parse(example[1]);
  let minted;
  // Pure source-contract test: memory-only mint, no HTTP/provider/binding.
  const prepared = await checkout.prepareGuestCheckout({
    capabilities: { async compareAndSet(id, revision, value) {
      assert.equal(id, "example-capability");
      assert.equal(revision, null);
      minted = value;
      return { applied: true };
    } },
    host: {
      siteUrl: "https://checkout.example.test",
      createCapabilityId: () => "example-capability",
      createCartId: () => "example-cart",
      createCapabilitySecret: () => "example-secret",
      loadCheckoutContactRequirements: async () => ({ requirePhoneNumber: false, shippingCountries: [], revision: null }),
    },
  });
  assert.equal(prepared.ok, true);
  assert.equal(minted.recordKind, "guest-checkout-capability");
  assert.equal(prepared.capabilityId, expected.capabilityId);
  assert.deepEqual(prepared.capability, expected);
  assert.equal(typeof prepared.capability.capability, "string");
  assert.equal(prepared.capability.header, checkout.GUEST_CAPABILITY_HEADER);
  assert.equal(prepared.checkout.attemptId, null);
  assert.equal(prepared.checkout.order, null);
});

test("Template Store consumes only the public checkout contract and mounted guest routes", () => {
  assert.equal(checkout.GUEST_CHECKOUT_PREPARE_ROUTE, "checkout/guest/prepare");
  assert.equal(checkout.GUEST_CHECKOUT_START_ROUTE, "checkout/guest/start");
  assert.equal(checkout.GUEST_CHECKOUT_STATUS_ROUTE, "checkout/guest/status");
  assert.equal(checkout.GUEST_CAPABILITY_HEADER, "x-commerce-guest-capability");
  assert.deepEqual([...checkout.GUEST_CHECKOUT_DECLARED_HEADERS], [
    "x-commerce-guest-capability",
    "origin",
    "sec-fetch-site",
  ]);
  assert.equal(
    checkout.GUEST_CHECKOUT_PROJECTION_SCHEMA,
    "dinkuskit.commerce.guest-checkout-projection/v1",
  );
  assert.equal(checkout.CHECKOUT_COLLECTION, "checkoutCarts");
  assert.equal(checkout.CHECKOUT_SANDBOX_COLLECTION, "checkout_carts");
  assert.equal(typeof checkout.prepareGuestCheckout, "function");
  assert.equal(typeof checkout.startGuestCheckout, "function");
  assert.equal(typeof checkout.statusGuestCheckout, "function");
  assert.equal(typeof checkout.admitGuestCheckoutStartInput, "function");
  assert.equal(typeof checkout.projectGuestCheckout, "function");
  assert.equal(commerce.GUEST_CHECKOUT_PREPARE_ROUTE, checkout.GUEST_CHECKOUT_PREPARE_ROUTE);
  assert.equal(commerce.guestCheckoutPrepareRoute.public, true);
  assert.equal(commerce.guestCheckoutStartRoute.public, true);
  assert.equal(commerce.guestCheckoutStatusRoute.public, true);
  for (const required of [
    "checkout/guest/prepare",
    "checkout/guest/start",
    "checkout/guest/status",
    "x-commerce-guest-capability",
    "origin",
    "sec-fetch-site",
    "json-body",
    "ORIGIN_DENIED",
    "PAYMENTS_UNAVAILABLE",
    "Template Store",
    "Set-Cookie",
    "Stripe",
    "@dinkuskit/commerce/features/checkout",
  ]) {
    assert.ok(contract.includes(required), `public contract must document ${required}`);
  }
  assert.equal(contract.includes("sk_live"), false);
  assert.equal(contract.includes("Bearer "), false);
  const manifest = JSON.parse(readFileSync(join(root, "dist/sandbox/manifest.json"), "utf8"));
  const guestRoutes = Object.fromEntries((manifest.routes ?? []).map((route) => [route.name, route]));
  for (const name of [
    "checkout/guest/prepare",
    "checkout/guest/start",
    "checkout/guest/status",
  ]) {
    assert.equal(guestRoutes[name].public, true);
    assert.deepEqual(guestRoutes[name].request.headers, [
      "x-commerce-guest-capability",
      "origin",
      "sec-fetch-site",
    ]);
  }
});
