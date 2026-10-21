import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOMERS_COLLECTION,
  CUSTOMER_LOGIN_CODES_COLLECTION,
  CUSTOMER_SESSIONS_COLLECTION,
  CUSTOMER_SESSION_HEADER,
  PAID_ORDER_SCHEMA,
  SHOPPER_ACCOUNT_ORDERS_ROUTE,
  SHOPPER_ACCOUNT_PROFILE_ROUTE,
  SHOPPER_SIGN_IN_START_ROUTE,
  SHOPPER_SIGN_IN_VERIFY_ROUTE,
  SHOPPER_SIGN_OUT_ROUTE,
  createInstalledShopperAccountHandlers,
  createPaidOrderReceiver,
  createPlugin,
  listOrdersForEmail,
} from "../../../dist/index.js";

function memoryCollection() {
  const map = new Map();
  let rev = 0;
  return {
    async get(id) {
      const entry = map.get(id);
      return entry ? structuredClone(entry.value) : null;
    },
    async getVersioned(id) {
      const entry = map.get(id);
      return entry ? { value: structuredClone(entry.value), revision: entry.revision } : null;
    },
    async compareAndSet(id, expectedRevision, nextValue) {
      const current = map.get(id);
      const currentRev = current ? current.revision : null;
      if (currentRev !== expectedRevision) {
        return { applied: false, revision: currentRev };
      }
      rev += 1;
      const nextRev = `r${rev}`;
      map.set(id, { value: structuredClone(nextValue), revision: nextRev });
      return { applied: true, revision: nextRev };
    },
    async delete(id) {
      map.delete(id);
    },
    async query({ limit = 100, cursor } = {}) {
      const keys = [...map.keys()].sort();
      const start = cursor ? keys.indexOf(cursor) + 1 : 0;
      const slice = keys.slice(start, start + limit);
      return {
        items: slice.map((id) => ({ id, data: structuredClone(map.get(id).value) })),
        hasMore: start + limit < keys.length,
        cursor: start + limit < keys.length ? slice.at(-1) : undefined,
      };
    },
  };
}

function makeOrder({
  orderId,
  email,
  paidAt = "2026-10-20T12:00:00.000Z",
  phone = "+15550101",
  delivery = {
    name: "Ada Lovelace",
    line1: "123 Analytical Way",
    city: "Boston",
    region: "MA",
    postalCode: "02110",
    country: "US",
  },
}) {
  return {
    schema: PAID_ORDER_SCHEMA,
    orderId,
    receiptId: `rcpt_${orderId}`,
    attemptId: `att_${orderId}`,
    paidAt,
    mode: "test",
    lines: [
      {
        catalogItemId: "item_1",
        name: "Brass Compass",
        quantity: 1,
        unitPrice: { currency: "USD", minor: "4500" },
      },
    ],
    total: { currency: "USD", minor: "4500" },
    contactSnapshot: {
      schema: "dinkuskit.commerce.checkout-contact/v1",
      requirePhoneNumber: false,
      revision: "rev_1",
      contact: {
        email,
        ...(phone ? { phone } : {}),
        ...(delivery ? { delivery } : {}),
      },
    },
  };
}

function createSandboxFixture({ now = () => 1_760_000_000, code = "482910", shippingCountries = ["US", "CA"], requirePhoneNumber = false } = {}) {
  const sentEmails = [];
  const storage = {
    orders: memoryCollection(),
    order_numbers: memoryCollection(),
    [CUSTOMERS_COLLECTION]: memoryCollection(),
    [CUSTOMER_LOGIN_CODES_COLLECTION]: memoryCollection(),
    [CUSTOMER_SESSIONS_COLLECTION]: memoryCollection(),
    merchant_store_settings: memoryCollection(),
  };
  const settings = {
    async getVersioned(key) {
      if (key === "merchantStoreSettings") {
        return {
          revision: "s1",
          value: {
            recordKind: "merchant-store-settings",
            storeCountry: "US",
            sellingCountries: shippingCountries,
            shippingCountries,
            requirePhoneNumber,
          },
        };
      }
      return null;
    },
  };
  const ctx = {
    plugin: { id: "dinkus-commerce", version: "0.3.0" },
    site: { url: "https://store.example.com", title: "Example Outpost" },
    storage,
    settings,
    email: {
      async send(msg) {
        sentEmails.push(msg);
      },
    },
  };
  const handlers = createInstalledShopperAccountHandlers(
    (c, emailKey) => listOrdersForEmail(c.storage.orders, emailKey),
    {
      now,
      createLoginCode: () => code,
    },
  );
  return { ctx, storage, sentEmails, handlers };
}

test("6-digit OTP sign-in mints an origin-bound session, auto-links case-folded guest orders, and auto-seeds default delivery address", async () => {
  let currentNow = 1_760_000_000;
  const { ctx, storage, sentEmails, handlers } = createSandboxFixture({
    now: () => currentNow,
    code: "654321",
  });

  const receiver = createPaidOrderReceiver(storage.orders, storage.order_numbers);
  await receiver.receive(
    makeOrder({
      orderId: "ord_older",
      email: "Ada.Lovelace@Example.com",
      paidAt: "2026-10-19T10:00:00.000Z",
      delivery: {
        name: "Ada Lovelace",
        line1: "10 Old St",
        city: "Cambridge",
        region: "MA",
        postalCode: "02139",
        country: "US",
      },
    }),
  );
  await receiver.receive(
    makeOrder({
      orderId: "ord_newer",
      email: "ada.lovelace@example.com",
      paidAt: "2026-10-20T15:00:00.000Z",
      phone: "+16175550199",
      delivery: {
        name: "Ada Lovelace",
        line1: "99 New Beacon St",
        city: "Boston",
        region: "MA",
        postalCode: "02110",
        country: "US",
      },
    }),
  );
  await receiver.receive(
    makeOrder({
      orderId: "ord_other_buyer",
      email: "someone.else@example.com",
    }),
  );

  const started = await handlers.startSignIn(
    {
      input: { email: "  ADA.LOVELACE@example.com " },
      request: {
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/sign-in/start",
        headers: { origin: "https://store.example.com" },
      },
    },
    ctx,
  );
  assert.equal(started.ok, true);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, "ADA.LOVELACE@example.com");
  assert.match(sentEmails[0].subject, /654321/);

  // Rate-limit immediate repeat within 30s cooldown.
  const rateLimited = await handlers.startSignIn(
    {
      input: { email: "ada.lovelace@example.com" },
      request: {
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/sign-in/start",
        headers: { origin: "https://store.example.com" },
      },
    },
    ctx,
  );
  assert.deepEqual(rateLimited, {
    ok: false,
    error: { code: "RATE_LIMITED", message: "Please wait before requesting another sign-in code" },
  });

  // Wrong code increments attempts and rejects.
  const wrongCode = await handlers.verifySignIn(
    {
      input: { email: "ada.lovelace@example.com", code: "000000" },
      request: {
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/sign-in/verify",
        headers: { origin: "https://store.example.com" },
      },
    },
    ctx,
  );
  assert.equal(wrongCode.ok, false);
  assert.equal(wrongCode.error.code, "CODE_INVALID");

  // Correct 6-digit code succeeds, consumes challenge, mints capability, and auto-seeds from newest order (1002).
  const verified = await handlers.verifySignIn(
    {
      input: { email: "ada.lovelace@example.com", code: "654321" },
      request: {
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/sign-in/verify",
        headers: { origin: "https://store.example.com" },
      },
    },
    ctx,
  );
  assert.equal(verified.ok, true);
  assert.equal(verified.capability.header, CUSTOMER_SESSION_HEADER);
  assert.equal(verified.capability.retention, "json-body");
  assert.equal(verified.profile.email, "ada.lovelace@example.com");
  assert.equal(verified.profile.phone, "+16175550199");
  assert.deepEqual(verified.profile.delivery, {
    name: "Ada Lovelace",
    line1: "99 New Beacon St",
    city: "Boston",
    region: "MA",
    postalCode: "02110",
    country: "US",
  });

  // Replaying the same 6-digit code fails closed.
  const replay = await handlers.verifySignIn(
    {
      input: { email: "ada.lovelace@example.com", code: "654321" },
      request: {
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/sign-in/verify",
        headers: { origin: "https://store.example.com" },
      },
    },
    ctx,
  );
  assert.equal(replay.ok, false);
  assert.equal(replay.error.code, "CODE_INVALID");

  const sessionToken = verified.capability.session;

  // Read orders returns both case-folded orders newest-first (1002 then 1001) and excludes other buyers.
  const ordersRes = await handlers.orders(
    {
      request: {
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/orders",
        headers: { [CUSTOMER_SESSION_HEADER]: sessionToken },
      },
    },
    ctx,
  );
  assert.equal(ordersRes.ok, true);
  assert.deepEqual(
    ordersRes.orders.map((o) => ({ orderId: o.orderId, number: o.number, status: o.status })),
    [
      { orderId: "ord_newer", number: 1002, status: "processing" },
      { orderId: "ord_older", number: 1001, status: "processing" },
    ],
  );

  // Update saved shipping address and phone in Account profile.
  const updatedProfile = await handlers.profile(
    {
      input: {
        phone: "+16175550999",
        delivery: {
          name: "Countess Ada",
          line1: "1 Computing Plaza",
          line2: "Suite 4",
          city: "Boston",
          region: "MA",
          postalCode: "02116",
          country: "us",
        },
      },
      request: {
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/profile",
        method: "POST",
        headers: {
          origin: "https://store.example.com",
          [CUSTOMER_SESSION_HEADER]: sessionToken,
        },
      },
    },
    ctx,
  );
  assert.equal(updatedProfile.ok, true);
  assert.equal(updatedProfile.profile.phone, "+16175550999");
  assert.equal(updatedProfile.profile.delivery.country, "US");
  assert.equal(updatedProfile.profile.delivery.line1, "1 Computing Plaza");

  // Disallowed shipping country is rejected.
  const badCountry = await handlers.profile(
    {
      input: {
        delivery: {
          name: "Countess Ada",
          line1: "10 Downing St",
          city: "London",
          postalCode: "SW1A 2AA",
          country: "GB",
        },
      },
      request: {
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/profile",
        method: "POST",
        headers: {
          origin: "https://store.example.com",
          [CUSTOMER_SESSION_HEADER]: sessionToken,
        },
      },
    },
    ctx,
  );
  assert.equal(badCountry.ok, false);
  assert.equal(badCountry.error.code, "DELIVERY_COUNTRY_UNAVAILABLE");

  // Sign-out revokes session immediately.
  const signedOut = await handlers.signOut(
    {
      input: {},
      request: {
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/sign-out",
        headers: {
          origin: "https://store.example.com",
          [CUSTOMER_SESSION_HEADER]: sessionToken,
        },
      },
    },
    ctx,
  );
  assert.deepEqual(signedOut, { ok: true, signedOut: true });

  const afterSignOut = await handlers.orders(
    {
      request: {
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/orders",
        headers: { [CUSTOMER_SESSION_HEADER]: sessionToken },
      },
    },
    ctx,
  );
  assert.equal(afterSignOut.ok, false);
  assert.equal(afterSignOut.error.code, "SESSION_DENIED");
});

test("native createPlugin mounts the shopper account routes and storage collections", async () => {
  const plugin = createPlugin({ siteUrl: "https://store.example.com" });
  assert.ok(plugin.capabilities.includes("email:send"));
  for (const route of [
    SHOPPER_SIGN_IN_START_ROUTE,
    SHOPPER_SIGN_IN_VERIFY_ROUTE,
    SHOPPER_SIGN_OUT_ROUTE,
    SHOPPER_ACCOUNT_ORDERS_ROUTE,
    SHOPPER_ACCOUNT_PROFILE_ROUTE,
  ]) {
    assert.equal(plugin.routes[route]?.public, true, `${route} should be mounted as public`);
  }
});
