import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bindGuestCheckoutRuntime,
  createPlugin,
  createCheckoutPaymentAssociationPort,
  createTrustedTestPaymentsCheckoutHost,
  createTrustedTestPaymentPort,
  NATIVE_GUEST_CHECKOUT_STORAGE,
  reconcileGuestPaymentWakes,
  reconcilePaymentWakes,
  startCheckout,
} from "../../../dist/index.js";
import {
  GUEST_CHECKOUT_PREPARE_ROUTE,
  GUEST_CHECKOUT_START_ROUTE,
  TRUSTED_SITE,
  initializeGuestCheckoutDatabase,
  invokeGuest,
  openGuestCollections,
  prepareGuest,
  seedGuestCatalog,
  syntheticCheckoutHost,
} from "./guest-dispatch.mjs";
import { fixture, cart, openStore } from "./fixture.mjs";

const CONFIG = {
  paymentsOrigin: "https://payments.example.test",
  commerceOrigin: "https://shop.example.test",
  siteId: "site-example",
  bindingRef: "binding-test",
  providerId: "stripe",
  stripeAccountId: "acct_test",
};

function response(value, ok = true) {
  return new Response(JSON.stringify(value), {
    status: ok ? 200 : 500,
    headers: { "content-type": "application/json" },
  });
}

test("trusted TEST adapter pins identity, auth, endpoints, and frozen request body", async () => {
  const calls = [];
  const credential = async () => "credential-is-resolved-lazily";
  const port = createTrustedTestPaymentPort({
    ...CONFIG,
    credentialResolver: credential,
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url.includes("checkout-binding")) {
        return response({ bindingRef: CONFIG.bindingRef, providerId: "stripe", stripeAccountId: "acct_test", mode: "test", ready: true });
      }
      return response({
        outcome: "open",
        attemptId: "attempt-1",
        total: { currency: "USD", minor: "250" },
        session: { sessionId: "session-1", redirectUrl: "https://checkout.stripe.com/test", createdAt: 1000, expiresAt: 2800 },
      });
    },
  });
  const request = {
    attemptId: "attempt-1",
    bindingRef: CONFIG.bindingRef,
    lines: [{ catalogItemId: "hat", quantity: 1, name: "Hat", unitPrice: { currency: "USD", minor: "250" } }],
    total: { currency: "USD", minor: "250" },
    paymentWindow: { minSeconds: 1800, maxSeconds: 1860 },
    paymentMethods: ["card"],
  };
  const original = structuredClone(request);
  const result = await port.ensureSession(request);
  assert.equal(result.outcome, "open");
  assert.deepEqual(request, original);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://payments.example.test/v1/checkout-binding?bindingRef=binding-test");
  assert.equal(calls[1].url, "https://payments.example.test/v1/checkout/session");
  assert.deepEqual(JSON.parse(calls[1].init.body), original);
  assert.equal(calls[1].init.headers.authorization, "Bearer credential-is-resolved-lazily");
  assert.equal(calls[1].init.headers["x-dinkus-site"], CONFIG.siteId);
});

function streamedResponse(chunks, headers = {}, hooks = {}) {
  let index = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
    cancel(reason) {
      hooks.cancel?.(reason);
    },
  }), { headers });
}

function bindingJson(binding = CONFIG.bindingRef) {
  return JSON.stringify({
    bindingRef: binding,
    providerId: "stripe",
    stripeAccountId: CONFIG.stripeAccountId,
    mode: "test",
    ready: true,
  });
}

function requestForCapTests() {
  return {
    attemptId: "attempt-cap",
    bindingRef: CONFIG.bindingRef,
    lines: [],
    total: { currency: "USD", minor: "1" },
    paymentWindowSeconds: 1800,
    paymentMethods: ["card"],
  };
}

test("finite oversized binding rejects before reaching session transport", async () => {
  const calls = [];
  const payload = JSON.stringify({ ...JSON.parse(bindingJson()), padding: "x".repeat(1024 * 1024) });
  assert.ok(new TextEncoder().encode(payload).byteLength > 1024 * 1024);
  const port = createTrustedTestPaymentPort({
    ...CONFIG,
    credentialResolver: async () => "synthetic-test-credential",
    fetch: async (url) => {
      calls.push(new URL(url).pathname);
      return calls.length === 1
        ? new Response(payload, { headers: { "content-length": "12" } })
        : response({ outcome: "unknown" });
    },
  });
  await assert.rejects(() => port.ensureSession(requestForCapTests()), /Malformed Payments response/);
  assert.deepEqual(calls, ["/v1/checkout-binding"]);
});

test("trusted TEST adapter bounds every binding and checkout response by actual bytes", async () => {
  const calls = [];
  const port = createTrustedTestPaymentPort({
    ...CONFIG,
    credentialResolver: async () => "credential",
    fetch: async (url) => {
      calls.push(url);
      return streamedResponse([
        new TextEncoder().encode('{"bindingRef":"binding-test","providerId":"stripe","stripeAccountId":"acct_test","mode":"test","ready":true}'),
      ]);
    },
  });
  const request = requestForCapTests();
  await assert.rejects(() => port.ensureSession(request), /Malformed Payments outcome/);
  assert.deepEqual(calls, [
    "https://payments.example.test/v1/checkout-binding?bindingRef=binding-test",
    "https://payments.example.test/v1/checkout/session",
  ]);
});

test("trusted TEST adapter accepts the exact finite byte bound and handles UTF-8 split across chunks", async () => {
  const fixed = {
    bindingRef: CONFIG.bindingRef,
    providerId: "stripe",
    stripeAccountId: CONFIG.stripeAccountId,
    mode: "test",
    ready: true,
    note: "",
  };
  const fixedBytes = new TextEncoder().encode(JSON.stringify(fixed)).byteLength;
  const payload = JSON.stringify({ ...fixed, note: `é${"x".repeat(131072 - fixedBytes - 2)}` });
  const encoded = new TextEncoder().encode(payload);
  assert.equal(encoded.byteLength, 131072);
  const split = encoded.indexOf(0xc3) + 1;
  const calls = [];
  const port = createTrustedTestPaymentPort({
    ...CONFIG,
    credentialResolver: async () => "credential",
    fetch: async (url) => {
      calls.push(url);
      return url.endsWith("/checkout-binding?bindingRef=binding-test")
        ? streamedResponse([encoded.slice(0, split), encoded.slice(split)])
        : response({ outcome: "open", attemptId: "attempt-cap", total: { currency: "USD", minor: "1" } });
    },
  });
  const result = await port.ensureSession(requestForCapTests());
  assert.equal(result.outcome, "open");
  assert.deepEqual(calls, [
    "https://payments.example.test/v1/checkout-binding?bindingRef=binding-test",
    "https://payments.example.test/v1/checkout/session",
  ]);
});

test("trusted TEST adapter rejects missing, malformed, unreadable, and non-byte response bodies", async () => {
  const bodies = [
    () => new Response(null),
    () => streamedResponse([new Uint8Array([0xc3, 0x28])]),
    () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error("unreadable")); },
    })),
    () => ({
      ok: true,
      body: { getReader() { throw new Error("unsupported"); } },
    }),
  ];
  for (const makeResponse of bodies) {
    const port = createTrustedTestPaymentPort({
      ...CONFIG,
      credentialResolver: async () => "credential",
      fetch: async () => makeResponse(),
    });
    await assert.rejects(() => port.ensureSession(requestForCapTests()), /Malformed Payments response/);
  }
});

test("oversized responses are rejected before session or lookup and ignore misleading Content-Length", async () => {
  const oversized = (value, cancel) => {
    const bytes = new TextEncoder().encode(`${" ".repeat(131073)}${JSON.stringify(value)}`);
    let index = 0;
    return new Response(new ReadableStream({
      pull(controller) {
        if (index < 2) controller.enqueue(index++ === 0 ? bytes.slice(0, 17) : bytes.slice(17));
      },
      cancel,
    }), { headers: { "content-length": "1" } });
  };
  const binding = () => response({
    bindingRef: CONFIG.bindingRef,
    providerId: "stripe",
    stripeAccountId: CONFIG.stripeAccountId,
    mode: "test",
    ready: true,
  });
  for (const target of [
    "/v1/checkout-binding",
    "/v1/existing-binding",
    "/v1/checkout/session",
    "/v1/checkout/lookup",
  ]) {
    const calls = [];
    let delivered;
    let canceled = false;
    const port = createTrustedTestPaymentPort({
      ...CONFIG,
      credentialResolver: async () => "credential",
      fetch: async (url) => {
        calls.push(url);
        const endpoint = new URL(url).pathname;
        if (endpoint === target) {
          delivered = oversized(endpoint.includes("binding")
            ? JSON.parse(bindingJson())
            : { outcome: "open" }, () => { canceled = true; });
          return delivered;
        }
        if (endpoint === "/v1/checkout-binding" || endpoint === "/v1/existing-binding") return binding();
        return response({ outcome: "open", attemptId: "attempt-cap", total: { currency: "USD", minor: "1" } });
      },
    });
    const operation = target === "/v1/existing-binding" || target === "/v1/checkout/lookup"
      ? () => port.lookup(requestForCapTests())
      : () => port.ensureSession(requestForCapTests());
    await assert.rejects(operation, /Malformed Payments response/);
    assert.equal(canceled, true);
    assert.equal(delivered.body.locked, false);
    assert.equal(calls.some((url) => new URL(url).pathname === target), true);
    if (target === "/v1/checkout-binding") {
      assert.equal(calls.includes("https://payments.example.test/v1/checkout/session"), false);
    }
    if (target === "/v1/existing-binding") {
      assert.equal(calls.includes("https://payments.example.test/v1/checkout/lookup"), false);
    }
  }
});

test("trusted TEST adapter denies wrong mode/account and preserves lookup create separation", async () => {
  for (const bad of [
    { ...CONFIG, paymentsOrigin: "http://payments.example.test" },
    { ...CONFIG, commerceOrigin: "https://shop.example.test/path" },
    { ...CONFIG, bindingRef: "" },
  ]) {
    assert.throws(() => createTrustedTestPaymentPort({
      ...bad,
      credentialResolver: async () => "credential",
      fetch: async () => response({}),
    }), /Invalid trusted TEST Payments configuration/);
  }
  let sessionCreates = 0;
  const port = createTrustedTestPaymentPort({
    ...CONFIG,
    credentialResolver: async () => "credential",
    fetch: async (url) => {
      if (url.includes("existing-binding")) {
        return response({ bindingRef: CONFIG.bindingRef, providerId: "stripe", stripeAccountId: "acct_test", mode: "test", ready: false });
      }
      if (url.includes("checkout-binding")) {
        return response({ bindingRef: CONFIG.bindingRef, providerId: "stripe", stripeAccountId: "acct_other", mode: "test", ready: true });
      }
      sessionCreates++;
      return response({
        outcome: "paid",
        attemptId: "attempt-1",
        total: { currency: "USD", minor: "1" },
        session: { sessionId: "session-1", redirectUrl: "https://checkout.stripe.com/test", createdAt: 1000, expiresAt: 2800 },
        paymentId: "payment-1",
      });
    },
  });
  const request = {
    attemptId: "attempt-1",
    bindingRef: CONFIG.bindingRef,
    lines: [],
    total: { currency: "USD", minor: "1" },
    paymentWindowSeconds: 1800,
    paymentMethods: ["card"],
  };
  await assert.rejects(() => port.ensureSession(request), /binding mismatch/);
  assert.equal(sessionCreates, 0);
  await assert.rejects(
    () => port.lookup({ ...request, bindingRef: "other-binding" }),
    /Malformed payment request/,
  );
  const lookup = await port.lookup(request);
  assert.equal(lookup.outcome, "paid");
  assert.equal(sessionCreates, 1);
});

test("authorize_net TEST adapter admits sandbox bindings and rejects live or stripe overload", async () => {
  assert.throws(() => createTrustedTestPaymentPort({
    ...CONFIG,
    providerId: "authorize_net",
    stripeAccountId: "acct_test",
    credentialResolver: async () => "credential",
    fetch: async () => response({}),
  }), /must not set stripeAccountId/);
  assert.throws(() => createTrustedTestPaymentPort({
    ...CONFIG,
    authorizeNetMerchantId: "anet",
    credentialResolver: async () => "credential",
    fetch: async () => response({}),
  }), /must not set authorizeNetMerchantId/);
  const anet = {
    paymentsOrigin: CONFIG.paymentsOrigin,
    commerceOrigin: CONFIG.commerceOrigin,
    siteId: CONFIG.siteId,
    bindingRef: CONFIG.bindingRef,
    providerId: "authorize_net",
    authorizeNetMerchantId: "authorize_net",
  };
  const port = createTrustedTestPaymentPort({
    ...anet,
    credentialResolver: async () => "credential",
    fetch: async (url) => {
      if (url.includes("binding")) {
        return response({
          bindingRef: anet.bindingRef,
          providerId: "authorize_net",
          authorizeNetMerchantId: "authorize_net",
          mode: "live",
          ready: true,
        });
      }
      return response({ outcome: "unknown" });
    },
  });
  const request = {
    attemptId: "anet-1",
    bindingRef: anet.bindingRef,
    lines: [{ catalogItemId: "hat", quantity: 1, name: "Hat", unitPrice: { currency: "USD", minor: "250" } }],
    total: { currency: "USD", minor: "250" },
    paymentWindow: { minSeconds: 1800, maxSeconds: 1860 },
    paymentMethods: ["card"],
  };
  await assert.rejects(() => port.ensureSession(request), /binding mismatch/);
  const ok = createTrustedTestPaymentPort({
    ...anet,
    credentialResolver: async () => "credential",
    fetch: async (url) => {
      if (url.includes("binding")) {
        return response({
          bindingRef: anet.bindingRef,
          providerId: "authorize_net",
          authorizeNetMerchantId: "authorize_net",
          mode: "test",
          ready: true,
        });
      }
      return response({
        outcome: "open",
        attemptId: request.attemptId,
        total: request.total,
        session: {
          sessionId: "token",
          redirectUrl: "https://test.authorize.net/payment/payment?token=x",
          createdAt: 1000,
          expiresAt: 2800,
        },
      });
    },
  });
  assert.equal((await ok.ensureSession(request)).outcome, "open");
});


test("authorize_net binding rejects stripeAccountId wire field with no fallback", async () => {
  const anet = {
    paymentsOrigin: CONFIG.paymentsOrigin,
    commerceOrigin: CONFIG.commerceOrigin,
    siteId: CONFIG.siteId,
    bindingRef: CONFIG.bindingRef,
    providerId: "authorize_net",
    authorizeNetMerchantId: "anet_merchant",
  };
  const port = createTrustedTestPaymentPort({
    ...anet,
    credentialResolver: async () => "credential",
    fetch: async (url) => {
      if (url.includes("binding")) {
        return response({
          bindingRef: anet.bindingRef,
          providerId: "authorize_net",
          stripeAccountId: "anet_merchant",
          mode: "test",
          ready: true,
        });
      }
      return response({ outcome: "unknown" });
    },
  });
  const request = {
    attemptId: "anet-wire",
    bindingRef: anet.bindingRef,
    lines: [{ catalogItemId: "hat", quantity: 1, name: "Hat", unitPrice: { currency: "USD", minor: "250" } }],
    total: { currency: "USD", minor: "250" },
    paymentWindow: { minSeconds: 1800, maxSeconds: 1860 },
    paymentMethods: ["card"],
  };
  await assert.rejects(() => port.ensureSession(request), /binding mismatch/);
});

test("trusted host returns the canonical Commerce site and hardens transport", async () => {
  const calls = [];
  const host = createTrustedTestPaymentsCheckoutHost({
    ...CONFIG,
    commerceOrigin: TRUSTED_SITE,
    credentialResolver: async () => "credential",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return response(url.includes("checkout-binding") || url.includes("existing-binding")
        ? {
            bindingRef: CONFIG.bindingRef,
            providerId: "stripe",
            stripeAccountId: CONFIG.stripeAccountId,
            mode: "test",
            ready: true,
          }
        : {
            outcome: "open",
            attemptId: "attempt-transport",
            total: { currency: "USD", minor: "1" },
            session: { sessionId: "session-transport", redirectUrl: "https://checkout.stripe.com/test", createdAt: 1000, expiresAt: 2800 },
          });
    },
  });
  assert.equal(host.siteUrl, TRUSTED_SITE);
  assert.equal(host.paymentBindingRef, CONFIG.bindingRef);
  assert.throws(
    () => createTrustedTestPaymentsCheckoutHost({
      ...CONFIG,
      commerceOrigin: "https://shop.example.test/path",
      credentialResolver: async () => "credential",
      fetch: async () => response({}),
    }),
    /Invalid trusted TEST Payments configuration/,
  );
  await host.resolvePayments(CONFIG.bindingRef).then((port) => port.ensureSession({
    attemptId: "attempt-transport",
    bindingRef: CONFIG.bindingRef,
    lines: [],
    total: { currency: "USD", minor: "1" },
    paymentWindowSeconds: 1800,
    paymentMethods: ["card"],
  }));
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.cache, "no-store");
});

test("native plugin retains existing public routes and additive association storage", () => {
  const plugin = createPlugin();
  assert.ok(plugin.storage.checkoutPaymentAssociations);
  assert.ok(plugin.routes["checkout/guest/prepare"]);
  assert.ok(plugin.routes["checkout/guest/start"]);
  assert.ok(plugin.routes["checkout/guest/status"]);
});

test("trusted host snapshots normalized identity before lazy resolution", async () => {
  const input = {
    ...CONFIG,
    commerceOrigin: ` ${TRUSTED_SITE}/ `,
    bindingRef: " binding-test ",
    siteId: " site-example ",
    credentialResolver: async () => "credential",
    fetch: async (url) => response(url.includes("binding")
      ? { bindingRef: "binding-test", providerId: "stripe", stripeAccountId: "acct_test", mode: "test", ready: true }
      : { outcome: "open", attemptId: "attempt-snapshot", total: { currency: "USD", minor: "1" }, session: { sessionId: "session", redirectUrl: "https://checkout.stripe.com/test", createdAt: 1000, expiresAt: 2800 } }),
  };
  const host = createTrustedTestPaymentsCheckoutHost(input);
  input.commerceOrigin = "https://changed.example.test/";
  input.bindingRef = "changed-binding";
  input.siteId = "changed-site";
  assert.equal(host.siteUrl, TRUSTED_SITE);
  assert.equal(host.paymentBindingRef, CONFIG.bindingRef);
  assert.ok(await host.resolvePayments(CONFIG.bindingRef));
  assert.equal(await host.resolvePayments("changed-binding"), null);
});

test("wake reconciliation uses durable association, is at-least-once, and retains unknown", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "commerce-test-payments-reconcile-"));
  const opened = openStore(join(dir, "checkout.sqlite"));
  const f = fixture(opened.store, false);
  t.after(() => {
    opened.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const associations = new Map();
  f.execution.paymentAssociations = {
    async claim(record) {
      const existing = associations.get(record.attemptId);
      if (existing) return JSON.stringify(existing) === JSON.stringify(record);
      associations.set(record.attemptId, structuredClone(record));
      return true;
    },
    async get(attemptId) {
      return structuredClone(associations.get(attemptId) ?? null);
    },
  };
  const attempt = await startCheckout(f.execution, "wake-cart", cart);
  const wake = { eventId: "evt-1", attemptId: attempt.attemptId, bindingRef: "stripe-test-binding", deliveryGeneration: 1, wokeAt: 2000 };
  let state = "unknown";
  let acknowledged = [];
  const wakes = {
    async list() { return [wake, wake]; },
    async acknowledge(value) {
      acknowledged.push(`${value.eventId}:${value.deliveryGeneration}`);
      return true;
    },
  };
  f.execution.payments.lookup = async (request) => state === "unknown"
    ? { outcome: "unknown" }
    : {
        outcome: "paid",
        attemptId: request.attemptId,
        total: request.total,
        session: { sessionId: "session-"+request.attemptId, redirectUrl: "https://checkout.stripe.com/test", createdAt: 1000, expiresAt: 2800 },
        paymentId: "payment-"+request.attemptId,
      };
  let retained = await reconcilePaymentWakes(f.execution, f.execution.paymentAssociations, wakes);
  assert.deepEqual(retained.map((r) => r.status), ["retained", "retained"]);
  assert.equal(acknowledged.length, 0);
  state = "paid";
  const paid = await reconcilePaymentWakes(f.execution, f.execution.paymentAssociations, wakes);
  assert.deepEqual(paid.map((r) => r.status), ["acknowledged", "acknowledged"]);
  assert.equal(acknowledged.length, 2);
  assert.equal(paid[0].attempt.phase, "paid");
  const staleGeneration = await reconcilePaymentWakes(
    f.execution,
    f.execution.paymentAssociations,
    {
      async list() { return [{ ...wake, deliveryGeneration: 0 }]; },
      async acknowledge() {
        throw new Error("stale generation must not be acknowledged");
      },
    },
  );
  assert.deepEqual(staleGeneration, [{ wake: { ...wake, deliveryGeneration: 0 }, status: "retained", reason: "unknown" }]);
});

test("authorize_net wake alone never marks paid; amount or currency mismatch stays unpaid", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "commerce-anet-paid-authority-"));
  const opened = openStore(join(dir, "checkout.sqlite"));
  const f = fixture(opened.store, false);
  t.after(() => {
    opened.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const associations = new Map();
  f.execution.paymentAssociations = {
    async claim(record) {
      const existing = associations.get(record.attemptId);
      if (existing) return JSON.stringify(existing) === JSON.stringify(record);
      associations.set(record.attemptId, structuredClone(record));
      return true;
    },
    async get(attemptId) {
      return structuredClone(associations.get(attemptId) ?? null);
    },
  };
  const attempt = await startCheckout(f.execution, "anet-wake-cart", cart);
  const session = structuredClone(attempt.session);
  assert.ok(session);
  const wake = {
    eventId: "evt_anet1",
    attemptId: attempt.attemptId,
    bindingRef: "stripe-test-binding",
    deliveryGeneration: 1,
    wokeAt: 2000,
  };
  let acknowledged = 0;
  const wakes = {
    async list() { return [wake]; },
    async acknowledge() { acknowledged++; return true; },
  };
  // Signed webhook wake with lookup still open: never paid.
  f.execution.payments.lookup = async () => ({
    outcome: "open", attemptId: attempt.attemptId, total: attempt.payment.total, session,
  });
  const pending = await reconcilePaymentWakes(f.execution, f.execution.paymentAssociations, wakes);
  assert.equal(pending[0].status, "retained");
  assert.equal(acknowledged, 0);
  assert.equal((await f.execution.store.read("anet-wake-cart")).record.attempts[0].phase, "paying");

  // Authoritative lookup claims paid but amount mismatches: never paid.
  f.execution.payments.lookup = async (request) => ({
    outcome: "paid",
    attemptId: request.attemptId,
    total: { currency: "USD", minor: "1" },
    session,
    paymentId: "txn_mismatch_amount",
  });
  const amountMismatch = await reconcilePaymentWakes(f.execution, f.execution.paymentAssociations, wakes);
  assert.equal(amountMismatch[0].status, "retained");
  assert.equal(acknowledged, 0);
  assert.equal((await f.execution.store.read("anet-wake-cart")).record.attempts[0].phase, "paying");

  f.execution.payments.lookup = async (request) => ({
    outcome: "paid",
    attemptId: request.attemptId,
    total: { currency: "EUR", minor: request.total.minor },
    session,
    paymentId: "txn_mismatch_currency",
  });
  const currencyMismatch = await reconcilePaymentWakes(f.execution, f.execution.paymentAssociations, wakes);
  assert.equal(currencyMismatch[0].status, "retained");
  assert.equal(acknowledged, 0);

  // Matching authoritative lookup is the only path to paid.
  f.execution.payments.lookup = async (request) => ({
    outcome: "paid",
    attemptId: request.attemptId,
    total: request.total,
    session,
    paymentId: "txn_authoritative",
  });
  const paid = await reconcilePaymentWakes(f.execution, f.execution.paymentAssociations, wakes);
  assert.equal(paid[0].status, "acknowledged");
  assert.equal(acknowledged, 1);
  assert.equal(paid[0].attempt.phase, "paid");
  assert.equal(paid[0].attempt.order.paymentId, "txn_authoritative");
});
test("paid wake without a matching durable order retains without acknowledgement", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "commerce-test-payments-missing-order-"));
  const opened = openStore(join(dir, "checkout.sqlite"));
  const f = fixture(opened.store, false);
  t.after(() => {
    opened.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const attempt = await startCheckout(f.execution, "missing-order-cart", cart);
  const association = {
    recordKind: "checkout-payment-association",
    attemptId: attempt.attemptId,
    cartId: "missing-order-cart",
    bindingRef: "stripe-test-binding",
  };
  f.execution.paymentAssociations = {
    async claim() { return true; },
    async get() { return association; },
  };
  f.execution.store = {
    async read() {
      return { version: "1", record: { attempts: [{ ...attempt, phase: "paid", order: undefined }] } };
    },
    async compareAndSet() { return true; },
  };
  f.execution.payments.lookup = async (request) => ({
    outcome: "paid",
    attemptId: request.attemptId,
    total: request.total,
    session: { sessionId: "session", redirectUrl: "https://checkout.stripe.com/test", createdAt: 1000, expiresAt: 2800 },
    paymentId: "payment",
  });
  let acknowledged = 0;
  const results = await reconcilePaymentWakes(f.execution, f.execution.paymentAssociations, {
    async list() {
      return [{ eventId: "evt-missing-order", attemptId: attempt.attemptId, bindingRef: association.bindingRef, deliveryGeneration: 1, wokeAt: 2000 }];
    },
    async acknowledge() { acknowledged++; return true; },
  });
  assert.equal(results[0].status, "retained");
  assert.equal(acknowledged, 0);
});

test("failed association claim makes no payment session or inventory hold", async () => {
  const f = fixture({ async read() { return null; }, async compareAndSet() { return false; } }, false);
  f.execution.paymentAssociations = {
    async claim() { throw new Error("association CAS unavailable"); },
    async get() { return null; },
  };
  await assert.rejects(() => startCheckout(f.execution, "association-failure-cart", cart), /association CAS unavailable/);
  assert.equal(f.sessions.size, 0);
  assert.equal(f.holds.size, 0);
});

test("association storage rejects malformed and stored-key-mismatched records", async () => {
  const records = new Map([[
    "attempt-1",
    { recordKind: "checkout-payment-association", attemptId: "attempt-other", cartId: "cart-1", bindingRef: "binding-1" },
  ]]);
  const port = createCheckoutPaymentAssociationPort({
    async get(key) { return records.get(key) ?? null; },
    async compareAndSet(key, expected, value) {
      if (expected !== null || records.has(key)) return { applied: false };
      records.set(key, value);
      return { applied: true };
    },
  });
  assert.equal(await port.get("attempt-1"), null);
  assert.equal(await port.claim({ recordKind: "checkout-payment-association", attemptId: "attempt-1", cartId: "cart-1", bindingRef: "binding-1" }), false);
  assert.equal(await port.claim({ recordKind: "checkout-payment-association", attemptId: "attempt-2", cartId: "", bindingRef: "binding-1" }), false);
});

test("bounded overflow stays unknown in canonical reconciliation without order, release, or acknowledgement", async () => {
  let record = null;
  let version = 0;
  const store = {
    async read() {
      return record ? { version: String(version), record: structuredClone(record) } : null;
    },
    async compareAndSet(_cartId, expected, value) {
      if ((record ? String(version) : null) !== expected) return false;
      record = structuredClone(value);
      version++;
      return true;
    },
  };
  const f = fixture(store, true);
  const bindingRef = "stripe-test-binding";
  const overflow = () => new Response(`${" ".repeat(131073)}{}`);
  f.execution.payments = createTrustedTestPaymentPort({
    ...CONFIG,
    bindingRef,
    credentialResolver: async () => "credential",
    fetch: async (url) => {
      const endpoint = new URL(url).pathname;
      if (endpoint === "/v1/checkout-binding") {
        return response({ bindingRef, providerId: "stripe", stripeAccountId: CONFIG.stripeAccountId, mode: "test", ready: true });
      }
      return overflow();
    },
  });
  const attempt = await startCheckout(f.execution, "cart-cap", cart);
  assert.equal(attempt.phase, "paying");
  const associations = {
    async get(attemptId) {
      return { recordKind: "checkout-payment-association", attemptId, cartId: "cart-cap", bindingRef };
    },
  };
  let acknowledged = 0;
  const results = await reconcilePaymentWakes(f.execution, associations, {
    async list() {
      return [{ eventId: "evt-cap", attemptId: attempt.attemptId, bindingRef, deliveryGeneration: 1, wokeAt: 2000 }];
    },
    async acknowledge() {
      acknowledged++;
      return true;
    },
  });
  assert.deepEqual(results.map((result) => result.status), ["retained"]);
  assert.equal(results[0].reason, "unknown");
  assert.equal(record.attempts[0].order, undefined);
  assert.equal(f.counts().releaseCalls, 0);
  assert.equal(acknowledged, 0);
});

test("native public handlers reopen durable storage and reconcile one order per event-safe wake", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "commerce-test-payments-native-"));
  const path = join(dir, "commerce.sqlite");
  initializeGuestCheckoutDatabase(path);
  let opened = openGuestCollections(path);
  t.after(async () => {
    await opened.db.destroy();
    rmSync(dir, { recursive: true, force: true });
  });
  await seedGuestCatalog(opened.storage, { managed: false });
  const acknowledgements = [];
  let failNextAck = true;
  let pending = [];
  const synthetic = syntheticCheckoutHost({ managed: false });
  let sessionAssociationSeen = false;
  const host = createTrustedTestPaymentsCheckoutHost({
    ...CONFIG,
    bindingRef: "stripe-test-binding",
    commerceOrigin: ` ${TRUSTED_SITE}/ `,
    credentialResolver: async () => "credential",
    fetch: async (url, init) => {
      const endpoint = new URL(url).pathname;
      if (endpoint === "/v1/checkout-binding" || endpoint === "/v1/existing-binding") {
        return response({
          bindingRef: "stripe-test-binding",
          providerId: "stripe",
          stripeAccountId: CONFIG.stripeAccountId,
          mode: "test",
          ready: true,
        });
      }
      const request = JSON.parse(init.body);
      const syntheticPort = await synthetic.host.resolvePayments("stripe-test-binding");
      if (endpoint === "/v1/checkout/session") {
        sessionAssociationSeen = Boolean(await opened.storage.checkoutPaymentAssociations.get(request.attemptId));
        return response(await syntheticPort.ensureSession(request));
      }
      if (endpoint === "/v1/checkout/lookup") return response(await syntheticPort.lookup(request));
      throw new Error(`unexpected Payments endpoint: ${endpoint}`);
    },
  });
  const checkoutHost = {
    ...host,
    now: synthetic.host.now,
    createAttemptId: synthetic.host.createAttemptId,
  };
  const plugin = createPlugin({ siteUrl: TRUSTED_SITE, checkout: checkoutHost });
  const prepared = await prepareGuest(plugin.routes[GUEST_CHECKOUT_PREPARE_ROUTE], opened.storage);
  const token = prepared.capability.capability;
  const started = await invokeGuest(
    plugin.routes[GUEST_CHECKOUT_START_ROUTE],
    opened.storage,
    { lines: [{ catalogItemId: "hat", quantity: 1 }] },
    { capability: token },
  );
  assert.equal(started.checkout.state, "pending");
  const attemptId = started.checkout.attemptId;
  assert.equal(sessionAssociationSeen, true);
  await opened.db.destroy();
  opened = openGuestCollections(path);
  const reopened = opened;
  const runtime = bindGuestCheckoutRuntime(reopened.storage, NATIVE_GUEST_CHECKOUT_STORAGE, {
    siteUrl: TRUSTED_SITE,
    host: checkoutHost,
  });
  const event1 = { eventId: "evt-1", attemptId, bindingRef: "stripe-test-binding", deliveryGeneration: 1, wokeAt: 2000 };
  pending = [event1];
  const wakes = {
    async list() { return pending.map((wake) => structuredClone(wake)); },
    async acknowledge(wake) {
      if (failNextAck) {
        failNextAck = false;
        return false;
      }
      acknowledgements.push(structuredClone(wake));
      pending = pending.filter((candidate) =>
        candidate.eventId !== wake.eventId ||
        candidate.deliveryGeneration !== wake.deliveryGeneration);
      return true;
    },
  };
  synthetic.setPayment("paid");
  const first = await reconcileGuestPaymentWakes(runtime, wakes);
  assert.equal(first[0].status, "retained");
  assert.deepEqual((await reconcileGuestPaymentWakes(runtime, wakes)).map((result) => result.status), ["acknowledged"]);
  const stored = await reopened.storage.checkoutCarts.get(attemptId);
  assert.equal(stored, null);
  const capability = await reopened.storage.checkoutGuestCapabilities.get(prepared.capabilityId);
  const cartRecord = await runtime.carts.getVersioned(capability.cartId);
  assert.equal(cartRecord.value.attempts[0].phase, "paid");
  assert.equal(cartRecord.value.attempts[0].order.orderId, `order:${attemptId}`);
  assert.equal(acknowledgements.length, 1);

  const newer = { ...event1, eventId: "evt-2", deliveryGeneration: 2 };
  pending = [event1, newer];
  assert.equal(await wakes.acknowledge(event1), true);
  assert.deepEqual(pending, [newer]);
  await reopened.db.destroy();
  opened = openGuestCollections(path);
  const finalRuntime = bindGuestCheckoutRuntime(opened.storage, NATIVE_GUEST_CHECKOUT_STORAGE, {
    siteUrl: TRUSTED_SITE,
    host: checkoutHost,
  });
  const finalCapability = await opened.storage.checkoutGuestCapabilities.get(prepared.capabilityId);
  const finalCart = await finalRuntime.carts.getVersioned(finalCapability.cartId);
  assert.equal(finalCart.value.attempts[0].order.orderId, `order:${attemptId}`);
  const oldAck = await reconcileGuestPaymentWakes(finalRuntime, wakes);
  assert.deepEqual(oldAck.map((result) => result.status), ["acknowledged"]);
  assert.deepEqual(pending, []);
  assert.equal(acknowledgements.filter((wake) => wake.eventId === "evt-2").length, 1);

  pending = [{ ...newer, bindingRef: "wrong-binding" }];
  const mismatch = await reconcileGuestPaymentWakes(finalRuntime, wakes);
  assert.equal(mismatch[0].status, "retained");
  assert.equal(acknowledgements.length, 3);
});
