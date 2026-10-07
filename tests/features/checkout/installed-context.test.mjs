import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

// Optional fresh extracted owner package root; defaults to this compiled package.
const packageRoot = process.env.COMMERCE_INSTALLED_PACKAGE_ROOT;
const checkoutUrl = packageRoot
  ? pathToFileURL(resolve(packageRoot, "dist/features/checkout/index.js"))
  : new URL("../../../dist/features/checkout/index.js", import.meta.url);
const {
  COMMERCE_CHECKOUT_WAKES_TASK,
  COMMERCE_REGISTRY_RUNTIME_ID,
  GUEST_CHECKOUT_PREPARE_ROUTE,
  GUEST_CHECKOUT_START_ROUTE,
  SANDBOX_GUEST_CHECKOUT_STORAGE,
  createInstalledCheckoutHandlers,
  createTrustedTestPaymentsCheckoutHost,
} = await import(checkoutUrl.href);
const sandboxUrl = packageRoot
  ? pathToFileURL(resolve(packageRoot, "dist/sandbox/plugin.mjs"))
  : new URL("../../../dist/sandbox/plugin.mjs", import.meta.url);
const manifestUrl = packageRoot
  ? pathToFileURL(resolve(packageRoot, "dist/sandbox/manifest.json"))
  : new URL("../../../dist/sandbox/manifest.json", import.meta.url);
const sandboxManifest = JSON.parse(await readFile(manifestUrl, "utf8"));
const sandboxPlugin = (await import(sandboxUrl.href)).default;
import { syntheticCheckoutHost } from "./guest-dispatch.mjs";

const site = "http://store-a.test";

function collection(records = []) {
  const values = new Map(records.map(([id, value]) => [id, structuredClone(value)]));
  const revisions = new Map();
  return {
    async get(id) { return structuredClone(values.get(id) ?? null); },
    async getVersioned(id) {
      return values.has(id) ? { revision: revisions.get(id) ?? "1", value: structuredClone(values.get(id)) } : null;
    },
    async compareAndSet(id, expected, value) {
      const present = values.has(id);
      if ((!present && expected === null) ||
          (present && expected !== null && expected === (revisions.get(id) ?? "1"))) {
        values.set(id, structuredClone(value));
        revisions.set(id, String(Number(revisions.get(id) ?? "1") + 1));
        return { applied: true };
      }
      return { applied: false };
    },
    async query() { return { items: [...values].map(([id, data]) => ({ id, data: structuredClone(data) })), hasMore: false }; },
    snapshot() { return structuredClone([...values]); },
    async put(id, value) { values.set(id, structuredClone(value)); revisions.set(id, "1"); },
  };
}

function storage() {
  const catalogItems = collection([["hat", {
    recordKind: "catalog-item", itemId: "hat", name: "Hat", sku: "HAT", skuKey: "HAT",
    stockManagement: { mode: "unmanaged" }, state: "draft",
  }]]);
  const catalogPrices = collection([["hat", {
    recordKind: "catalog-price", recordId: "hat", catalogItemId: "hat",
    regular: { currency: "USD", minor: "250" },
  }]]);
  const empty = () => collection();
  return {
    [SANDBOX_GUEST_CHECKOUT_STORAGE.carts]: collection(),
    [SANDBOX_GUEST_CHECKOUT_STORAGE.capabilities]: collection(),
    [SANDBOX_GUEST_CHECKOUT_STORAGE.catalogItems]: catalogItems,
    [SANDBOX_GUEST_CHECKOUT_STORAGE.prices]: catalogPrices,
    [SANDBOX_GUEST_CHECKOUT_STORAGE.backorderPolicies]: empty(),
    [SANDBOX_GUEST_CHECKOUT_STORAGE.manualAvailability]: collection([["hat", {
      recordKind: "catalog-manual-availability", recordId: "hat", catalogItemId: "hat", status: "in-stock",
    }]]),
    [SANDBOX_GUEST_CHECKOUT_STORAGE.configurations]: empty(),
    [SANDBOX_GUEST_CHECKOUT_STORAGE.settings]: empty(),
    [SANDBOX_GUEST_CHECKOUT_STORAGE.listing]: empty(),
    [SANDBOX_GUEST_CHECKOUT_STORAGE.paymentAssociations]: collection(),
  };
}

function context(storageValue = storage()) {
  return {
    plugin: { id: COMMERCE_REGISTRY_RUNTIME_ID, version: "0.0.0" },
    storage: storageValue,
    site: { url: site, name: "Synthetic test site", locale: "en" },
  };
}

function request(input, capability, origin = site) {
  return new Request(`${site}/checkout`, {
    method: "POST",
    headers: {
      origin,
      "sec-fetch-site": "same-origin",
      ...(capability ? { "x-commerce-guest-capability": capability } : {}),
    },
    body: JSON.stringify(input),
  });
}

test("compiled installed export and sandbox metadata expose fixed public seam", async () => {
  assert.equal(typeof createInstalledCheckoutHandlers, "function");
  assert.equal(sandboxManifest.id, "dinkus-commerce");
  assert.deepEqual(sandboxManifest.capabilities, ["media:read"]);
  assert.deepEqual(sandboxManifest.allowedHosts, []);
  assert.equal(typeof sandboxPlugin.routes[GUEST_CHECKOUT_PREPARE_ROUTE].handler, "function");
});

test("invalid origin is denied before trusted service resolution", async () => {
  let resolved = false;
  const handlers = createInstalledCheckoutHandlers(async () => {
    resolved = true;
    throw new Error("resolver must not run");
  });
  const ctx = context();
  const result = await handlers.prepare({
    input: {},
    request: request({}, undefined, "https://evil.test"),
    requestMeta: {},
  }, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "ORIGIN_DENIED");
  assert.equal(resolved, false);
});

test("wrong owner and missing fixed storage fail closed before resolver", async () => {
  let calls = 0;
  const handlers = createInstalledCheckoutHandlers(async () => {
    calls += 1;
    return { host: {} };
  });
  const badOwner = { ...context(), plugin: { id: "other-plugin", version: "1.0.0" } };
  const incomplete = storage();
  delete incomplete[SANDBOX_GUEST_CHECKOUT_STORAGE.paymentAssociations];
  const missing = { ...context(), storage: incomplete };
  for (const ctx of [badOwner, missing]) {
    const result = await handlers.prepare({
      input: {}, request: request({}), requestMeta: {},
    }, ctx);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "UNAVAILABLE");
  }
  assert.equal(calls, 0);
});

test("guest and wake handlers share the durable association and produce one order", async () => {
  const synth = syntheticCheckoutHost({ managed: false });
  const wakes = [{
    eventId: "wake-1", attemptId: "", bindingRef: "stripe-test-binding",
    deliveryGeneration: 1, wokeAt: 1000,
  }];
  const ctx = context();
  const handlers = createInstalledCheckoutHandlers(async () => ({ host: synth.host, wakes: {
    async list() { return wakes; },
    async acknowledge(wake) {
      if (wake.eventId !== "wake-1") return false;
      wakes.splice(0, 1);
      return true;
    },
  } }));
  const prepared = await handlers.prepare({
    input: {}, request: request({}), requestMeta: {},
  }, ctx);
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const capability = prepared.capability.capability;
  const started = await handlers.start({
    input: { lines: [{ catalogItemId: "hat", quantity: 1 }] },
    request: request({}, capability), requestMeta: {},
  }, ctx);
  assert.equal(started.ok, true, JSON.stringify(started));
  wakes[0].attemptId = started.checkout.attemptId;
  synth.setPayment("paid");
  await handlers.cron({ name: COMMERCE_CHECKOUT_WAKES_TASK, scheduledAt: new Date().toISOString() }, ctx);
  const status = await handlers.status({
    input: {}, request: request({}, capability), requestMeta: {},
  }, ctx);
  assert.equal(status.checkout.state, "paid");
  assert.ok(status.checkout.order.orderId);
  assert.equal(wakes.length, 0);
  const before = ctx.storage[SANDBOX_GUEST_CHECKOUT_STORAGE.carts].snapshot();
  wakes.push({ eventId: "wake-1", attemptId: started.checkout.attemptId, bindingRef: "stripe-test-binding", deliveryGeneration: 1, wokeAt: 1000 });
  await handlers.cron({ name: COMMERCE_CHECKOUT_WAKES_TASK, scheduledAt: new Date().toISOString() }, ctx);
  assert.deepEqual(ctx.storage[SANDBOX_GUEST_CHECKOUT_STORAGE.carts].snapshot(), before);
  assert.equal(wakes.length, 0);
});

// These contexts and HTTP outcomes are synthetic behavior proof, not Registry installation.
test("exact Registry owner ID is derived from manifest and other Registry owners are rejected", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../../emdash-plugin.jsonc", import.meta.url), "utf8"));
  const hash = createHash("sha256").update(`${manifest.publisher}\n${manifest.slug}`).digest();
  let bits = 0, value = 0, encoded = "";
  for (const byte of hash) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { bits -= 5; encoded += "abcdefghijklmnopqrstuvwxyz234567"[(value >>> bits) & 31]; }
  }
  assert.equal(COMMERCE_REGISTRY_RUNTIME_ID, "r_" + encoded.slice(0, 16));
  const other = { ...context(), plugin: { id: "r_aaaaaaaaaaaaaaaa", version: "0.0.0" } };
  const result = await createInstalledCheckoutHandlers().prepare({ input: {}, request: request({}) }, other);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "UNAVAILABLE");
});

test("compiled default sandbox entry preserves prepare and unavailable Payments without configuration", async () => {
  const ctx = context();
  const prepared = await sandboxPlugin.routes[GUEST_CHECKOUT_PREPARE_ROUTE].handler({ input: {}, request: request({}) }, ctx);
  assert.equal(prepared.ok, true);
  const started = await sandboxPlugin.routes[GUEST_CHECKOUT_START_ROUTE].handler({
    input: { lines: [{ catalogItemId: "hat", quantity: 1 }] },
    request: request({}, prepared.capability.capability),
  }, ctx);
  assert.equal(started.ok, false);
  assert.equal(started.error.code, "PAYMENTS_UNAVAILABLE");
  assert.deepEqual(ctx.storage[SANDBOX_GUEST_CHECKOUT_STORAGE.carts].snapshot(), []);
  assert.deepEqual(await createInstalledCheckoutHandlers().reconcileWakes(ctx), { executed: false, reason: "not-configured" });
});

test("route input cannot overwrite the original trusted resolver context or host site", async () => {
  const ctx = context();
  let calls = 0;
  const handlers = createInstalledCheckoutHandlers(original => {
    calls++;
    assert.equal(original, ctx);
    assert.equal(original.input, undefined);
    return { host: { siteUrl: "https://other-site.test" } };
  });
  const result = await handlers.prepare({ input: { siteId: "forged", paymentBindingRef: "forged" },
    plugin: { id: "other-plugin" }, storage: {}, request: request({}),
  }, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "UNAVAILABLE");
  assert.equal(calls, 1);
  assert.deepEqual(ctx.storage[SANDBOX_GUEST_CHECKOUT_STORAGE.capabilities].snapshot(), []);
});

test("cron ignores unrelated tasks and denies invalid site before trusted resolution", async () => {
  let calls = 0;
  const handlers = createInstalledCheckoutHandlers(() => { calls++; return { host: {} }; });
  await handlers.cron({ name: "unrelated", scheduledAt: "2026-10-05T00:00:00Z" }, context());
  assert.equal(calls, 0);
  const invalid = { ...context(), site: { url: "" } };
  assert.deepEqual(await handlers.reconcileWakes(invalid), { executed: false, reason: "unavailable" });
  assert.equal(calls, 0);
});

function paymentTransport() {
  let mode = "open", requestBody, canceled = 0;
  const calls = [];
  const config = {
    paymentsOrigin: "https://payments.example.test", siteId: "synthetic-site",
    commerceOrigin: site, bindingRef: "stripe-test-binding", providerId: "stripe",
    stripeAccountId: "acct_synthetic", credentialResolver: async () => "synthetic-test-only",
    async fetch(url, init) {
      const path = new URL(url).pathname;
      calls.push(path);
      if (path.endsWith("binding")) return Response.json({
        bindingRef: config.bindingRef, providerId: "stripe", stripeAccountId: config.stripeAccountId,
        mode: "test", ready: true,
      });
      const body = JSON.parse(init.body);
      if (path.endsWith("session")) requestBody = structuredClone(body);
      if (path.endsWith("lookup") && mode === "oversize") {
        const bytes = new TextEncoder().encode(JSON.stringify({ outcome: "unknown", padding: "x".repeat(131073) }));
        return new Response(new ReadableStream({
          pull(controller) { controller.enqueue(bytes); },
          cancel() { canceled++; },
        }, { highWaterMark: 0 }));
      }
      if (mode === "unknown") return Response.json({ outcome: "unknown" });
      return Response.json({ outcome: mode, attemptId: body.attemptId, total: body.total,
        session: { sessionId: "cs_test_SYNTHETIC", redirectUrl: "https://checkout.stripe.com/test",
          createdAt: 1000, expiresAt: 2800 },
        ...(mode === "paid" ? { paymentId: "pi_SYNTHETIC" } : {}),
      });
    },
  };
  return { host: createTrustedTestPaymentsCheckoutHost(config), calls,
    setMode(value) { mode = value; }, snapshot: () => structuredClone(requestBody), cancellations: () => canceled };
}

for (const mode of ["unknown", "oversize"]) {
  test(`installed guest and wake use actual canonical transport; ${mode} retains attempt without ACK or order`, async () => {
    const ctx = context();
    const synth = syntheticCheckoutHost({ managed: false });
    const transport = paymentTransport();
    let ack = 0;
    const wake = { eventId: "evt_SYNTHETIC", attemptId: "", bindingRef: "stripe-test-binding", deliveryGeneration: 1, wokeAt: 1000 };
    const handlers = createInstalledCheckoutHandlers(() => ({
      host: { ...synth.host, ...transport.host },
      wakes: { async list() { return [wake]; }, async acknowledge() { ack++; return true; } },
    }));
    const prepared = await handlers.prepare({ input: {}, request: request({}) }, ctx);
    assert.equal(prepared.ok, true);
    const capability = prepared.capability.capability;
    const started = await handlers.start({ input: { lines: [{ catalogItemId: "hat", quantity: 1 }] }, request: request({}, capability) }, ctx);
    assert.equal(started.ok, true, JSON.stringify(started));
    wake.attemptId = started.checkout.attemptId;
    const storedBefore = ctx.storage[SANDBOX_GUEST_CHECKOUT_STORAGE.carts].snapshot()[0][1].attempts[0];
    assert.equal(storedBefore.phase, "paying");
    assert.ok(storedBefore.session);
    transport.setMode(mode);
    const result = await handlers.reconcileWakes(ctx);
    assert.equal(result.executed, true);
    assert.equal(result.results[0].status, "retained");
    assert.equal(ack, 0);
    assert.equal(synth.counts().releaseCalls, 0);
    const stored = ctx.storage[SANDBOX_GUEST_CHECKOUT_STORAGE.carts].snapshot()[0][1].attempts[0];
    assert.equal(stored.order, undefined);
    assert.equal(stored.attemptId, storedBefore.attemptId);
    assert.deepEqual(stored.payment, storedBefore.payment);
    assert.deepEqual(stored.session, storedBefore.session);
    assert.deepEqual(transport.snapshot(), storedBefore.payment);
    assert.ok(transport.calls.includes("/v1/checkout/lookup"));
    assert.equal(transport.cancellations(), mode === "oversize" ? 1 : 0);
  });
}

test("capability from one owner namespace does not authorize another context's cart", async () => {
  const one = context(), two = context();
  const synth = syntheticCheckoutHost({ managed: false });
  const handlers = createInstalledCheckoutHandlers(() => ({ host: synth.host }));
  const prepared = await handlers.prepare({ input: {}, request: request({}) }, one);
  const denied = await handlers.start({ input: { lines: [{ catalogItemId: "hat", quantity: 1 }] }, request: request({}, prepared.capability.capability) }, two);
  assert.equal(denied.ok, false);
  assert.equal(synth.counts().paymentCreates, 0);
  assert.deepEqual(two.storage[SANDBOX_GUEST_CHECKOUT_STORAGE.carts].snapshot(), []);
});
