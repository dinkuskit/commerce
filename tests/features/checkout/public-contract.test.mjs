import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as checkout from "@dinkuskit/commerce/features/checkout";
import * as commerce from "@dinkuskit/commerce";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const contract = readFileSync(join(root, "docs/implementation/guest-checkout-public.md"), "utf8");

test("Template Store consumes only the public checkout contract and mounted guest routes", () => {
  assert.equal(checkout.GUEST_CHECKOUT_START_ROUTE, "checkout/guest/start");
  assert.equal(checkout.GUEST_CHECKOUT_STATUS_ROUTE, "checkout/guest/status");
  assert.equal(checkout.GUEST_CAPABILITY_HEADER, "x-commerce-guest-capability");
  assert.equal(
    checkout.GUEST_CHECKOUT_PROJECTION_SCHEMA,
    "dinkuskit.commerce.guest-checkout-projection/v1",
  );
  assert.equal(checkout.CHECKOUT_COLLECTION, "checkoutCarts");
  assert.equal(checkout.CHECKOUT_SANDBOX_COLLECTION, "checkout_carts");
  assert.equal(typeof checkout.startGuestCheckout, "function");
  assert.equal(typeof checkout.statusGuestCheckout, "function");
  assert.equal(typeof checkout.admitGuestCheckoutStartInput, "function");
  assert.equal(typeof checkout.projectGuestCheckout, "function");
  assert.equal(commerce.GUEST_CHECKOUT_START_ROUTE, checkout.GUEST_CHECKOUT_START_ROUTE);
  assert.equal(commerce.guestCheckoutStartRoute.public, true);
  assert.equal(commerce.guestCheckoutStatusRoute.public, true);
  for (const required of [
    "checkout/guest/start",
    "checkout/guest/status",
    "x-commerce-guest-capability",
    "json-body",
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
});
