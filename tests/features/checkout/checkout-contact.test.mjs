import assert from "node:assert/strict";
import test from "node:test";

import {
  CheckoutContactError,
  captureCheckoutContact,
  normalizeCheckoutContactInput,
} from "../../../dist/features/checkout-contact/index.js";

const billing = { name: "Bill Payer", line1: "9 Billing Way", city: "Toronto", region: "ON", postalCode: "M5V 1A1", country: "CA" };

async function rejectsWithCode(operation, code) {
  await assert.rejects(
    operation,
    (error) => error instanceof CheckoutContactError && error.code === code,
  );
}

test("requires an ordinary bounded email and rejects missing, malformed, long, and control input", async () => {
  await rejectsWithCode(Promise.resolve().then(() => normalizeCheckoutContactInput({})), "INVALID_INPUT");
  await rejectsWithCode(
    Promise.resolve().then(() => normalizeCheckoutContactInput({ email: "" })),
    "EMAIL_REQUIRED",
  );
  for (const email of ["not-an-email", "a@", "@example.test", "a b@example.test", "a..b@example.test", ".a@example.test", "a.@example.test", "a@-example.test", "a@example..test", "a@<example>.test", "a@example.test/path"]) {
    await rejectsWithCode(
      Promise.resolve().then(() => normalizeCheckoutContactInput({ email })),
      "EMAIL_INVALID",
    );
  }
  await rejectsWithCode(
    Promise.resolve().then(() => normalizeCheckoutContactInput({ email: `a${"x".repeat(254)}@example.test` })),
    "EMAIL_INVALID",
  );
  await rejectsWithCode(
    Promise.resolve().then(() => normalizeCheckoutContactInput({ email: "a@example.test\nbcc@example.test" })),
    "EMAIL_INVALID",
  );
});

test("does not create or accept an account field for guest contact", () => {
  assert.deepEqual(
    normalizeCheckoutContactInput({ email: " guest@example.test " }),
    { email: "guest@example.test" },
  );
  assert.throws(
    () => normalizeCheckoutContactInput({ email: "guest@example.test", account: "acct-1" }),
    (error) => error instanceof CheckoutContactError && error.code === "INVALID_INPUT",
  );
});

test("accepts optional phone when the merchant requirement is off and omits empty phone", async () => {
  const optional = await captureCheckoutContact(
    { email: "guest@example.test", phone: "  (555) 010-1234 ", billing },
    async () => ({ requirePhoneNumber: false, shippingCountries: [], revision: "rev-7" }),
  );
  assert.deepEqual(optional.contact, {
    email: "guest@example.test",
    phone: "(555) 010-1234",
    billing,
  });
  assert.deepEqual(
    (await captureCheckoutContact(
      { email: "guest@example.test", phone: "   ", billing },
      async () => ({ requirePhoneNumber: false, shippingCountries: [], revision: null }),
    )).contact,
    { email: "guest@example.test", billing },
  );
});

test("requires a nonempty phone when the merchant requirement is on", async () => {
  await rejectsWithCode(
    captureCheckoutContact(
      { email: "guest@example.test", phone: "" },
      async () => ({ requirePhoneNumber: true, shippingCountries: [], revision: "r1" }),
    ),
    "PHONE_REQUIRED",
  );
  await rejectsWithCode(
    captureCheckoutContact(
      { email: "guest@example.test" },
      async () => ({ requirePhoneNumber: true, shippingCountries: [], revision: "r1" }),
    ),
    "PHONE_REQUIRED",
  );
});

test("rejects phone controls, overlong phone, and all client requirement overrides", async () => {
  for (const phone of ["\n5550101", "x".repeat(65)]) {
    await rejectsWithCode(
      captureCheckoutContact(
        { email: "guest@example.test", phone },
        async () => ({ requirePhoneNumber: false, shippingCountries: [], revision: null }),
      ),
      "INVALID_INPUT",
    );
  }
  for (const input of [
    { email: "guest@example.test", requirePhoneNumber: true },
    { email: "guest@example.test", revision: "client-rev" },
    { email: "guest@example.test", phone: "555", account: null },
  ]) {
    await rejectsWithCode(
      Promise.resolve().then(() => normalizeCheckoutContactInput(input)),
      "INVALID_INPUT",
    );
  }
});

test("fails closed for loader failure and malformed requirements", async () => {
  await rejectsWithCode(
    captureCheckoutContact({ email: "guest@example.test" }, async () => {
      throw new Error("private storage detail");
    }),
    "REQUIREMENTS_UNAVAILABLE",
  );
  for (const requirements of [
    null,
    { requirePhoneNumber: "yes", revision: null },
    { requirePhoneNumber: false, revision: 7 },
    { requirePhoneNumber: false, revision: null, extra: true },
  ]) {
    await rejectsWithCode(
      captureCheckoutContact({ email: "guest@example.test" }, async () => requirements),
      "REQUIREMENTS_UNAVAILABLE",
    );
  }
});

test("captures exact requirement flag and revision in a frozen detached snapshot", async () => {
  const input = { email: "guest@example.test", phone: "555 0101", billing: { ...billing } };
  const requirements = { requirePhoneNumber: true, shippingCountries: [], revision: "" };
  const snapshot = await captureCheckoutContact(input, async () => requirements);

  assert.deepEqual(snapshot, {
    schema: "dinkuskit.commerce.checkout-contact/v1",
    contact: { email: "guest@example.test", phone: "555 0101", billing },
    requirePhoneNumber: true,
    revision: "",
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.contact), true);

  input.email = "changed@example.test";
  input.phone = "changed";
  requirements.requirePhoneNumber = false;
  requirements.revision = "changed";
  input.billing.city = "changed";
  assert.deepEqual(snapshot.contact, { email: "guest@example.test", phone: "555 0101", billing });
  assert.equal(Object.isFrozen(snapshot.contact.billing), true);
  assert.equal(snapshot.requirePhoneNumber, true);
  assert.equal(snapshot.revision, "");
});

 test("ordinary plus-tag and subdomain email retains local case without claiming ownership", () => {
  assert.deepEqual(normalizeCheckoutContactInput({ email: "Guest+proof@shop.example.test" }), { email: "Guest+proof@shop.example.test" });
});

test("every checkout needs a billing address, checked like delivery but in any country", async () => {
  const ships = async () => ({ requirePhoneNumber: false, shippingCountries: ["US"], revision: null });
  const delivery = { name: "Fixture Shopper", line1: "1 Example Way", city: "Testville", region: "NY", postalCode: "10001", country: "US" };
  // Digital and physical baskets alike; Commerce never copies delivery into billing.
  await rejectsWithCode(captureCheckoutContact({ email: "guest@example.test" }, ships), "BILLING_INVALID");
  await rejectsWithCode(captureCheckoutContact({ email: "guest@example.test", delivery }, ships, true), "BILLING_INVALID");
  for (const bad of [{ ...billing, line1: " " }, { ...billing, postalCode: undefined }, { ...billing, city: "a\nb" },
    { ...billing, country: "CAN" }, { ...billing, extra: "x" }, { ...billing, name: "x".repeat(201) }, "same"]) {
    await rejectsWithCode(Promise.resolve().then(() => normalizeCheckoutContactInput({ email: "guest@example.test", billing: bad })), "BILLING_INVALID");
  }
  // Canadian billing with US delivery: only delivery is held to the shipping destinations.
  const snapshot = await captureCheckoutContact({ email: "guest@example.test", delivery, billing: { ...billing, country: "ca", line2: " " } }, ships, true);
  assert.deepEqual(snapshot.contact, { email: "guest@example.test", delivery, billing });
  // A digital-only basket drops delivery but keeps billing.
  assert.deepEqual((await captureCheckoutContact({ email: "guest@example.test", delivery, billing }, ships)).contact,
    { email: "guest@example.test", billing });
});
