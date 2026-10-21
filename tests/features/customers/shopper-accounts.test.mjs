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
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/sign-in/profile",
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

  // Explicitly clearing saved delivery and phone persists null across subsequent profile and orders reads.
  const clearedProfile = await handlers.profile(
    {
      input: { phone: null, delivery: null },
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
  assert.equal(clearedProfile.ok, true);
  assert.equal(clearedProfile.profile.phone, null);
  assert.equal(clearedProfile.profile.delivery, null);

  const rereadProfile = await handlers.profile(
    {
      request: {
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/profile",
        method: "GET",
        headers: { [CUSTOMER_SESSION_HEADER]: sessionToken },
      },
    },
    ctx,
  );
  assert.equal(rereadProfile.ok, true);
  assert.equal(rereadProfile.profile.phone, null);
  assert.equal(rereadProfile.profile.delivery, null);

  const rereadOrders = await handlers.orders(
    {
      request: {
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/orders",
        headers: { [CUSTOMER_SESSION_HEADER]: sessionToken },
      },
    },
    ctx,
  );
  assert.equal(rereadOrders.ok, true);
  assert.equal(rereadOrders.profile.phone, null);
  assert.equal(rereadOrders.profile.delivery, null);

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

test("OTP verification enforces CAS single-use consumption, attempt reservation under contention, and cooldown preservation after exhaustion", async () => {
  let currentNow = 1_760_000_000;
  let currentCode = "111222";
  const { ctx, storage, handlers } = createSandboxFixture({
    now: () => currentNow,
    code: currentCode,
  });
  // Override createLoginCode dynamically via custom handler set
  const dynamicHandlers = createInstalledShopperAccountHandlers(
    (c, emailKey) => listOrdersForEmail(c.storage.orders, emailKey),
    {
      now: () => currentNow,
      createLoginCode: () => currentCode,
    },
  );

  await dynamicHandlers.startSignIn(
    {
      input: { email: "grace@example.com" },
      request: {
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/sign-in/start",
        headers: { origin: "https://store.example.com" },
      },
    },
    ctx,
  );

  // Exhaust all 5 attempts with wrong codes.
  for (let i = 0; i < 5; i += 1) {
    const attemptRes = await dynamicHandlers.verifySignIn(
      {
        input: { email: "grace@example.com", code: "999999" },
        request: {
          url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/sign-in/verify",
          headers: { origin: "https://store.example.com" },
        },
      },
      ctx,
    );
    assert.equal(attemptRes.ok, false);
    assert.equal(attemptRes.error.code, "CODE_INVALID");
  }

  // Even the valid code now fails closed because the attempt budget is exhausted.
  const afterExhaustion = await dynamicHandlers.verifySignIn(
    {
      input: { email: "grace@example.com", code: "111222" },
      request: {
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/sign-in/verify",
        headers: { origin: "https://store.example.com" },
      },
    },
    ctx,
  );
  assert.equal(afterExhaustion.ok, false);
  assert.equal(afterExhaustion.error.code, "CODE_INVALID");

  // Attempting to request a new code within the 30-second cooldown after exhaustion is still RATE_LIMITED.
  currentNow += 10;
  const blockedResend = await dynamicHandlers.startSignIn(
    {
      input: { email: "grace@example.com" },
      request: {
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/sign-in/start",
        headers: { origin: "https://store.example.com" },
      },
    },
    ctx,
  );
  assert.equal(blockedResend.ok, false);
  assert.equal(blockedResend.error.code, "RATE_LIMITED");

  // After 30 seconds from issuedAt, a new code can be issued.
  currentNow += 25;
  currentCode = "333444";
  const reissued = await dynamicHandlers.startSignIn(
    {
      input: { email: "grace@example.com" },
      request: {
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/sign-in/start",
        headers: { origin: "https://store.example.com" },
      },
    },
    ctx,
  );
  assert.equal(reissued.ok, true);

  // Deterministic two-party barrier on getVersioned (#154): two simultaneous valid-code submissions
  // against the same challenge both read getVersioned before either proceeds to compareAndSet.
  // Exactly one succeeds and creates a session; the loser fails closed with CONTENTION.
  const baseGetVersioned = storage[CUSTOMER_LOGIN_CODES_COLLECTION].getVersioned;
  let barrierReads = 0;
  let releaseBarrier;
  const bothReadBarrier = new Promise((resolve) => {
    releaseBarrier = resolve;
  });
  storage[CUSTOMER_LOGIN_CODES_COLLECTION].getVersioned = async (id) => {
    const result = await baseGetVersioned(id);
    if (id === "grace@example.com" && barrierReads < 2) {
      barrierReads += 1;
      if (barrierReads === 2) releaseBarrier();
      await bothReadBarrier;
    }
    return result;
  };

  const verifyCall = () =>
    dynamicHandlers.verifySignIn(
      {
        input: { email: "grace@example.com", code: "333444" },
        request: {
          url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/sign-in/verify",
          headers: { origin: "https://store.example.com" },
        },
      },
      ctx,
    );

  const [concurrentA, concurrentB] = await Promise.all([verifyCall(), verifyCall()]);
  storage[CUSTOMER_LOGIN_CODES_COLLECTION].getVersioned = baseGetVersioned;

  const outcomes = [concurrentA.ok, concurrentB.ok];
  assert.equal(outcomes.filter(Boolean).length, 1, "exactly one concurrent verifier may succeed");
  const loser = concurrentA.ok ? concurrentB : concurrentA;
  assert.equal(loser.ok, false);
  assert.equal(loser.error.code, "CONTENTION");
  const sessionsAfterConcurrentVerify = await storage[CUSTOMER_SESSIONS_COLLECTION].query();
  assert.equal(sessionsAfterConcurrentVerify.items.length, 1, "exactly one session may be created");

  // Confirm stale/expired verification cannot delete or overwrite a newly issued replacement challenge (#154).
  currentNow += 601;
  let pauseStaleOnce = true;
  let releaseStale;
  const stalePaused = new Promise((resolve) => {
    releaseStale = resolve;
  });
  let markStaleRead;
  const staleHasRead = new Promise((resolve) => {
    markStaleRead = resolve;
  });
  storage[CUSTOMER_LOGIN_CODES_COLLECTION].getVersioned = async (id) => {
    const result = await baseGetVersioned(id);
    if (pauseStaleOnce && id === "grace@example.com") {
      pauseStaleOnce = false;
      markStaleRead();
      await stalePaused;
    }
    return result;
  };

  const staleVerifyPromise = dynamicHandlers.verifySignIn(
    {
      input: { email: "grace@example.com", code: "333444" },
      request: {
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/sign-in/verify",
        headers: { origin: "https://store.example.com" },
      },
    },
    ctx,
  );
  await staleHasRead;

  // Issue replacement challenge while stale verification is still in flight.
  currentCode = "777888";
  const replacementStart = await dynamicHandlers.startSignIn(
    {
      input: { email: "grace@example.com" },
      request: {
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/sign-in/start",
        headers: { origin: "https://store.example.com" },
      },
    },
    ctx,
  );
  assert.equal(replacementStart.ok, true);

  releaseStale();
  const staleResult = await staleVerifyPromise;
  storage[CUSTOMER_LOGIN_CODES_COLLECTION].getVersioned = baseGetVersioned;
  assert.equal(staleResult.ok, false);

  // The newly issued replacement challenge ("777888") remains intact and succeeds.
  const replacementVerify = await dynamicHandlers.verifySignIn(
    {
      input: { email: "grace@example.com", code: "777888" },
      request: {
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/sign-in/verify",
        headers: { origin: "https://store.example.com" },
      },
    },
    ctx,
  );
  assert.equal(replacementVerify.ok, true);
  assert.equal((await storage[CUSTOMER_SESSIONS_COLLECTION].query()).items.length, 2);
});

test("listOrdersForEmail sorts by payment timestamp before order number when an older payment arrives later", async () => {
  const { storage } = createSandboxFixture();
  const receiver = createPaidOrderReceiver(storage.orders, storage.order_numbers);

  // Newer payment arrives first and gets order number 1001.
  await receiver.receive(
    makeOrder({
      orderId: "ord_paid_newer",
      email: "chronology@example.com",
      paidAt: "2026-10-20T18:00:00.000Z",
    }),
  );
  // Older payment is retried/delivered second and gets order number 1002.
  await receiver.receive(
    makeOrder({
      orderId: "ord_paid_older",
      email: "chronology@example.com",
      paidAt: "2026-10-18T09:00:00.000Z",
    }),
  );

  const listed = await listOrdersForEmail(storage.orders, "chronology@example.com");
  assert.deepEqual(
    listed.map((o) => ({ orderId: o.orderId, number: o.number, paidAt: o.paidAt })),
    [
      { orderId: "ord_paid_newer", number: 1001, paidAt: "2026-10-20T18:00:00.000Z" },
      { orderId: "ord_paid_older", number: 1002, paidAt: "2026-10-18T09:00:00.000Z" },
    ],
  );
});

test("delayed first sendEmail failure is revision-fenced and preserves a replacement challenge, and same-second profile seeding persists new order details", async () => {
  let currentNow = 1_760_000_000;
  let currentCode = "101010";
  const { ctx, storage } = createSandboxFixture({
    now: () => currentNow,
    code: currentCode,
  });

  let rejectFirstEmail;
  let firstEmailEntered;
  const firstEmailPending = new Promise((resolve) => {
    firstEmailEntered = resolve;
  });
  let firstSendCall = true;
  ctx.email.send = async () => {
    if (firstSendCall) {
      firstSendCall = false;
      firstEmailEntered();
      await new Promise((_, reject) => {
        rejectFirstEmail = reject;
      });
    }
  };

  const dynamicHandlers = createInstalledShopperAccountHandlers(
    (c, emailKey) => listOrdersForEmail(c.storage.orders, emailKey),
    {
      now: () => currentNow,
      createLoginCode: () => currentCode,
    },
  );

  // 1. Start first sign-in; sendEmail hangs beyond the 30-second cooldown.
  const firstStartPromise = dynamicHandlers.startSignIn(
    {
      input: { email: "fenced@example.com" },
      request: {
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/sign-in/start",
        headers: { origin: "https://store.example.com" },
      },
    },
    ctx,
  );
  await firstEmailPending;

  // 2. After 31s cooldown, a second startSignIn replaces the challenge and delivers code "202020".
  currentNow += 31;
  currentCode = "202020";
  const secondStart = await dynamicHandlers.startSignIn(
    {
      input: { email: "fenced@example.com" },
      request: {
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/sign-in/start",
        headers: { origin: "https://store.example.com" },
      },
    },
    ctx,
  );
  assert.equal(secondStart.ok, true);

  // 3. The delayed first sendEmail now fails; revision-fenced rollback must NOT delete the replacement challenge.
  rejectFirstEmail(new Error("SMTP timeout"));
  const firstStart = await firstStartPromise;
  assert.equal(firstStart.ok, false);
  assert.equal(firstStart.error.code, "EMAIL_UNAVAILABLE");

  // 4. Verify with "202020" succeeds (and creates profile with undefined delivery/phone at currentNow).
  const verified = await dynamicHandlers.verifySignIn(
    {
      input: { email: "fenced@example.com", code: "202020" },
      request: {
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/sign-in/verify",
        headers: { origin: "https://store.example.com" },
      },
    },
    ctx,
  );
  assert.equal(verified.ok, true);
  assert.equal(verified.profile.delivery, null);
  assert.equal(verified.profile.phone, null);

  // 5. Within the exact same second (currentNow unchanged), an order arrives for fenced@example.com.
  const receiver = createPaidOrderReceiver(storage.orders, storage.order_numbers);
  await receiver.receive(
    makeOrder({
      orderId: "ord_same_second",
      email: "fenced@example.com",
      phone: "+16175550123",
      delivery: {
        name: "Fenced Shopper",
        line1: "42 Same Second Ave",
        city: "Boston",
        region: "MA",
        postalCode: "02110",
        country: "US",
      },
    }),
  );

  // Reading profile in the same second detects the field change and persists the newly seeded delivery + phone.
  const seededSameSecond = await dynamicHandlers.profile(
    {
      request: {
        url: "https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/profile",
        method: "GET",
        headers: { [CUSTOMER_SESSION_HEADER]: verified.capability.session },
      },
    },
    ctx,
  );
  assert.equal(seededSameSecond.ok, true);
  assert.equal(seededSameSecond.profile.phone, "+16175550123");
  assert.equal(seededSameSecond.profile.delivery.line1, "42 Same Second Ave");
  const persistedCustomer = await storage[CUSTOMERS_COLLECTION].get("fenced@example.com");
  assert.equal(persistedCustomer.phone, "+16175550123");
  assert.equal(persistedCustomer.delivery.line1, "42 Same Second Ave");
});

test('historical US orders and saved profiles retain optional regions outside new checkout capture', async () => {
  const { ctx, storage, handlers } = createSandboxFixture();
  const email = 'legacy-region@example.test';
  const delivery = {
    name: 'Historical Shopper', line1: '1 Example Way', city: 'Testville', postalCode: '00000', country: 'US',
  };
  await createPaidOrderReceiver(storage.orders, storage.order_numbers).receive(
    makeOrder({ orderId: 'legacy-without-region', email, delivery }),
  );
  const request = (route, session, method = 'POST') => ({
    url: `https://store.example.com/_emdash/api/plugins/dinkus-commerce/account/${route}`,
    method,
    headers: { origin: 'https://store.example.com', ...(session ? { [CUSTOMER_SESSION_HEADER]: session } : {}) },
  });
  assert.equal((await handlers.startSignIn({ input: { email }, request: request('sign-in/start') }, ctx)).ok, true);
  const signedIn = await handlers.verifySignIn({ input: { email, code: '482910' }, request: request('sign-in/verify') }, ctx);
  assert.equal(signedIn.ok, true);
  assert.deepEqual(signedIn.profile.delivery, delivery);
  const session = signedIn.capability.session;
  // Saving and re-reading a profile still uses structural address normalization.
  for (const region of [undefined, 'PR', 'Unknown']) {
    const savedDelivery = { ...delivery, ...(region === undefined ? {} : { region }) };
    const saved = await handlers.profile({ input: { delivery: savedDelivery }, request: request('profile', session) }, ctx);
    assert.equal(saved.ok, true);
    assert.deepEqual(saved.profile.delivery, savedDelivery);
    const read = await handlers.profile({ request: request('profile', session, 'GET') }, ctx);
    assert.equal(read.ok, true);
    assert.deepEqual(read.profile.delivery, savedDelivery);
  }
  const orders = await listOrdersForEmail(storage.orders, email);
  assert.equal(orders.length, 1);
  const stored = await storage.orders.get('legacy-without-region');
  assert.deepEqual(stored.paidOrder.contactSnapshot.contact.delivery, delivery);
});
