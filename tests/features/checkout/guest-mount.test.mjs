import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PluginRouteError } from "emdash";

import {
  CHECKOUT_COLLECTION,
  CHECKOUT_GUEST_CAPABILITY_COLLECTION,
  GUEST_CAPABILITY_HEADER,
  GUEST_CHECKOUT_DECLARED_HEADERS,
  GUEST_CHECKOUT_PREPARE_ROUTE,
  GUEST_CHECKOUT_START_ROUTE,
  GUEST_CHECKOUT_STATUS_ROUTE,
  createPlugin,
  createGuestCheckoutPrepareRoute,
  createGuestCheckoutStartRoute,
  guestCheckoutPrepareRoute,
  guestCheckoutStartRoute,
  guestCheckoutStatusRoute,
  bindGuestCheckoutRuntime,
  NATIVE_GUEST_CHECKOUT_STORAGE,
  prepareGuestCheckout,
  projectGuestCheckout,
  startGuestCheckout,
} from "../../../dist/index.js";
import {
  TRUSTED_SITE,
  initializeGuestCheckoutDatabase,
  injectedPluginRoutes,
  invokeGuest,
  openGuestCollections,
  prepareGuest,
  seedGuestCatalog,
  syntheticCheckoutHost,
} from "./guest-dispatch.mjs";

function setup(t, { managed = false, inject = true, host } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "guest-mount-"));
  const path = join(dir, "commerce.sqlite");
  initializeGuestCheckoutDatabase(path);
  const opened = openGuestCollections(path);
  t.after(async () => {
    await opened.db.destroy();
    rmSync(dir, { recursive: true, force: true });
  });
  const synth = syntheticCheckoutHost({ managed, host });
  const plugin = inject ? injectedPluginRoutes(synth.host) : createPlugin({ siteUrl: TRUSTED_SITE });
  return { ...opened, path, synth, plugin };
}

function lines(itemId = "hat", quantity = 1) {
  return { lines: [{ catalogItemId: itemId, quantity }] };
}

function capabilityOf(result) {
  assert.equal(typeof result.capability.capability, "string");
  assert.ok(result.capability.capability.startsWith(`${result.capabilityId}.`));
  assert.equal(result.capability.header, GUEST_CAPABILITY_HEADER);
  assert.equal(result.capability.retention, "json-body");
  return result.capability.capability;
}

async function countCollection(storage, name) {
  return (await storage[name].query({ limit: 50 })).items.length;
}

test("default createPlugin mounts checkout storage and public guest routes without a production payments adapter", () => {
  const plugin = createPlugin();
  assert.ok(plugin.storage[CHECKOUT_COLLECTION]);
  assert.ok(plugin.storage[CHECKOUT_GUEST_CAPABILITY_COLLECTION]);
  assert.equal(plugin.routes[GUEST_CHECKOUT_PREPARE_ROUTE].public, true);
  assert.equal(plugin.routes[GUEST_CHECKOUT_START_ROUTE].public, true);
  assert.equal(plugin.routes[GUEST_CHECKOUT_STATUS_ROUTE].public, true);
  assert.deepEqual(plugin.routes[GUEST_CHECKOUT_START_ROUTE].request.headers, [...GUEST_CHECKOUT_DECLARED_HEADERS]);
  assert.equal(typeof guestCheckoutPrepareRoute.handler, "function");
  assert.equal(typeof guestCheckoutStartRoute.handler, "function");
  assert.equal(typeof guestCheckoutStatusRoute.handler, "function");
  assert.equal(typeof createGuestCheckoutPrepareRoute, "function");
  assert.equal(typeof createGuestCheckoutStartRoute, "function");
});

test("mint without trusted tenant scope is denied and writes no capability", async (t) => {
  const f = setup(t, { inject: false });
  await seedGuestCatalog(f.storage);
  const bare = createPlugin();
  await assert.rejects(
    () => prepareGuest(bare.routes[GUEST_CHECKOUT_PREPARE_ROUTE], f.storage, {
      runtimeSiteUrl: "",
      origin: TRUSTED_SITE,
    }),
    (error) => error instanceof PluginRouteError && error.code === "UNAVAILABLE",
  );
  assert.equal(await countCollection(f.storage, CHECKOUT_GUEST_CAPABILITY_COLLECTION), 0);
  assert.equal(await countCollection(f.storage, CHECKOUT_COLLECTION), 0);
});

test("frozen constructor options snapshot does not mutate caller options or throw", async () => {
  const frozenCheckout = Object.freeze({
    paymentBindingRef: "test-binding",
    resolvePayments: async () => null,
  });
  const plugin = createPlugin({
    siteUrl: "https://shop.example",
    checkout: frozenCheckout,
  });
  assert.ok(plugin);
  assert.equal(frozenCheckout.siteUrl, undefined);
});

test("contradictory or malformed dual siteUrl configurations fail closed before storage writes", async (t) => {
  const f = setup(t, { inject: false });
  await seedGuestCatalog(f.storage);

  const conflicting = createPlugin({
    siteUrl: "https://shop-a.example",
    checkout: { ...f.synth.host, siteUrl: "https://shop-b.example" },
  });
  await assert.rejects(
    () => prepareGuest(conflicting.routes[GUEST_CHECKOUT_PREPARE_ROUTE], f.storage, {
      siteUrl: "https://shop-a.example",
      origin: "https://shop-a.example",
    }),
    (error) => error instanceof PluginRouteError && error.code === "UNAVAILABLE",
  );

  const malformedTop = createPlugin({
    siteUrl: "not-a-valid-url",
    checkout: { ...f.synth.host, siteUrl: TRUSTED_SITE },
  });
  await assert.rejects(
    () => prepareGuest(malformedTop.routes[GUEST_CHECKOUT_PREPARE_ROUTE], f.storage, {
      siteUrl: TRUSTED_SITE,
      origin: TRUSTED_SITE,
    }),
    (error) => error instanceof PluginRouteError && error.code === "UNAVAILABLE",
  );

  const malformedCheckout = createPlugin({
    siteUrl: TRUSTED_SITE,
    checkout: { ...f.synth.host, siteUrl: "not-a-valid-url" },
  });
  await assert.rejects(
    () => prepareGuest(malformedCheckout.routes[GUEST_CHECKOUT_PREPARE_ROUTE], f.storage, {
      siteUrl: TRUSTED_SITE,
      origin: TRUSTED_SITE,
    }),
    (error) => error instanceof PluginRouteError && error.code === "UNAVAILABLE",
  );

  assert.equal(await countCollection(f.storage, CHECKOUT_GUEST_CAPABILITY_COLLECTION), 0);
  assert.equal(await countCollection(f.storage, CHECKOUT_COLLECTION), 0);
});

test("known-site capability is denied for empty, malformed, or conflicting runtime site", async (t) => {
  const f = setup(t);
  await seedGuestCatalog(f.storage);
  const prepared = await prepareGuest(f.plugin.routes[GUEST_CHECKOUT_PREPARE_ROUTE], f.storage);
  const token = capabilityOf(prepared);
  const noConstructor = createPlugin({
    checkout: { ...f.synth.host, siteUrl: undefined },
  });
  await assert.rejects(
    () => invokeGuest(
      noConstructor.routes[GUEST_CHECKOUT_START_ROUTE],
      f.storage,
      lines(),
      { capability: token, runtimeSiteUrl: "" },
    ),
    (error) => error instanceof PluginRouteError && error.code === "UNAVAILABLE",
  );
  await assert.rejects(
    () => invokeGuest(
      f.plugin.routes[GUEST_CHECKOUT_START_ROUTE],
      f.storage,
      lines(),
      { capability: token, runtimeSiteUrl: "not-a-url" },
    ),
    (error) => error instanceof PluginRouteError && error.code === "UNAVAILABLE",
  );
  await assert.rejects(
    () => invokeGuest(
      f.plugin.routes[GUEST_CHECKOUT_START_ROUTE],
      f.storage,
      lines(),
      { capability: token, runtimeSiteUrl: "https://evil.example" },
    ),
    (error) => error instanceof PluginRouteError && error.code === "UNAVAILABLE",
  );
  assert.equal(f.synth.counts().paymentCreates, 0);
  assert.equal(await countCollection(f.storage, CHECKOUT_COLLECTION), 0);
});

test("constructor siteUrl may fill empty runtime and cannot mask a present public runtime URL", async (t) => {
  const f = setup(t);
  await seedGuestCatalog(f.storage);
  const prepared = await prepareGuest(f.plugin.routes[GUEST_CHECKOUT_PREPARE_ROUTE], f.storage, {
    runtimeSiteUrl: "",
  });
  const token = capabilityOf(prepared);
  const started = await invokeGuest(
    f.plugin.routes[GUEST_CHECKOUT_START_ROUTE],
    f.storage,
    lines(),
    { capability: token, runtimeSiteUrl: "" },
  );
  assert.equal(started.checkout.state, "pending");
  assert.equal(await countCollection(f.storage, CHECKOUT_COLLECTION), 1);
});

test("cross-site requests are denied without minting capabilities or starting carts", async (t) => {
  const f = setup(t);
  await seedGuestCatalog(f.storage);
  await assert.rejects(
    () => invokeGuest(
      f.plugin.routes[GUEST_CHECKOUT_PREPARE_ROUTE],
      f.storage,
      {},
      { route: GUEST_CHECKOUT_PREPARE_ROUTE, fetchSite: "cross-site" },
    ),
    (error) => error instanceof PluginRouteError && error.code === "ORIGIN_DENIED",
  );
  await assert.rejects(
    () => invokeGuest(
      f.plugin.routes[GUEST_CHECKOUT_START_ROUTE],
      f.storage,
      lines(),
      { origin: "https://evil.example", fetchSite: "same-origin" },
    ),
    (error) => error instanceof PluginRouteError && error.code === "ORIGIN_DENIED",
  );
  assert.equal(await countCollection(f.storage, CHECKOUT_GUEST_CAPABILITY_COLLECTION), 0);
  assert.equal(await countCollection(f.storage, CHECKOUT_COLLECTION), 0);
});

test("prepare rejects GET and starts with empty, malformed, or missing capabilities fail closed", async (t) => {
  const f = setup(t);
  await seedGuestCatalog(f.storage);
  await assert.rejects(
    () => invokeGuest(f.plugin.routes[GUEST_CHECKOUT_PREPARE_ROUTE], f.storage, {}, {
      method: "GET",
      route: GUEST_CHECKOUT_PREPARE_ROUTE,
    }),
    (error) => error instanceof PluginRouteError && error.code === "METHOD_NOT_ALLOWED",
  );
  for (const badCapability of [undefined, "", "just-an-id", "id.bad.three", "a.b"]) {
    await assert.rejects(
      () => invokeGuest(
        f.plugin.routes[GUEST_CHECKOUT_START_ROUTE],
        f.storage,
        lines(),
        { capability: badCapability },
      ),
      (error) => error instanceof PluginRouteError && error.code === "CAPABILITY_DENIED",
    );
  }
  assert.equal(await countCollection(f.storage, CHECKOUT_COLLECTION), 0);
  assert.equal(f.synth.counts().paymentCreates, 0);
});

test("reused prepare capability fails start closed and preserves the first attempt", async (t) => {
  const f = setup(t);
  await seedGuestCatalog(f.storage);
  const prepared = await prepareGuest(f.plugin.routes[GUEST_CHECKOUT_PREPARE_ROUTE], f.storage);
  const token = capabilityOf(prepared);
  const first = await invokeGuest(
    f.plugin.routes[GUEST_CHECKOUT_START_ROUTE],
    f.storage,
    lines(),
    { capability: token },
  );
  assert.equal(first.checkout.state, "pending");
  assert.equal(f.synth.counts().paymentCreates, 1);
  await assert.rejects(
    () => invokeGuest(
      f.plugin.routes[GUEST_CHECKOUT_START_ROUTE],
      f.storage,
      lines("hat", 2),
      { capability: token },
    ),
    (error) => error instanceof PluginRouteError && error.code === "CHECKOUT_FROZEN",
  );
  assert.equal(f.synth.counts().paymentCreates, 1);
  assert.equal(await countCollection(f.storage, CHECKOUT_COLLECTION), 1);
});

test("prepare capabilities survive process restart before use", async (t) => {
  const f = setup(t);
  await seedGuestCatalog(f.storage);
  const prepared = await prepareGuest(f.plugin.routes[GUEST_CHECKOUT_PREPARE_ROUTE], f.storage);
  const token = capabilityOf(prepared);
  const reopened = openGuestCollections(f.path);
  t.after(async () => {
    await reopened.db.destroy();
  });
  const started = await invokeGuest(
    f.plugin.routes[GUEST_CHECKOUT_START_ROUTE],
    reopened.storage,
    lines(),
    { capability: token },
  );
  assert.equal(started.checkout.state, "pending");
  assert.equal(await countCollection(reopened.storage, CHECKOUT_COLLECTION), 1);
});

test("restarting after power loss replays the exact attempt idempotently and retains single cart", async (t) => {
  const f = setup(t);
  await seedGuestCatalog(f.storage);
  const prepared = await prepareGuest(f.plugin.routes[GUEST_CHECKOUT_PREPARE_ROUTE], f.storage);
  const token = capabilityOf(prepared);
  const first = await invokeGuest(
    f.plugin.routes[GUEST_CHECKOUT_START_ROUTE],
    f.storage,
    lines(),
    { capability: token },
  );
  const reopened = openGuestCollections(f.path);
  t.after(async () => {
    await reopened.db.destroy();
  });
  const restarted = await invokeGuest(
    f.plugin.routes[GUEST_CHECKOUT_START_ROUTE],
    reopened.storage,
    lines(),
    { capability: token },
  );
  assert.equal(restarted.checkout.attemptId, first.checkout.attemptId);
  assert.equal(await countCollection(reopened.storage, CHECKOUT_COLLECTION), 1);
});

test("unmanaged start uses a retained capability, ignores guessed IDs, and never contacts Inventory", async (t) => {
  const f = setup(t);
  await seedGuestCatalog(f.storage);
  f.synth.setResolveInventory(async () => {
    throw new Error("must not call inventory");
  });
  f.synth.setResolveAvailabilityProvider(async () => {
    throw new Error("must not read inventory");
  });
  const prepared = await prepareGuest(f.plugin.routes[GUEST_CHECKOUT_PREPARE_ROUTE], f.storage);
  const token = capabilityOf(prepared);
  const started = await invokeGuest(
    f.plugin.routes[GUEST_CHECKOUT_START_ROUTE],
    f.storage,
    lines(),
    { capability: token },
  );
  assert.equal(started.checkout.state, "pending");
  assert.equal(started.checkout.total.minor, "250");
  assert.equal(started.checkout.order, null);
  assert.equal(started.checkout.unavailable, null);
  await assert.rejects(
    () => invokeGuest(f.plugin.routes[GUEST_CHECKOUT_STATUS_ROUTE], f.storage, { cartId: started.capabilityId }),
    (error) => error instanceof PluginRouteError && error.code === "CAPABILITY_DENIED",
  );
  await assert.rejects(
    () => invokeGuest(
      f.plugin.routes[GUEST_CHECKOUT_STATUS_ROUTE],
      f.storage,
      { attemptId: started.checkout.attemptId, paid: true, paymentId: "forged" },
      { capability: `${started.capabilityId}.guessed` },
    ),
    (error) => error instanceof PluginRouteError && error.code === "CAPABILITY_DENIED",
  );
  const status = await invokeGuest(
    f.plugin.routes[GUEST_CHECKOUT_STATUS_ROUTE],
    f.storage,
    { paid: true, paymentState: "paid", redirectUrl: "https://evil.example", webhook: { paid: true } },
    { capability: token },
  );
  assert.equal(status.checkout.state, "pending");
  assert.equal(status.checkout.order, null);
  assert.equal(f.synth.counts().reserveCalls, 0);
  assert.equal(await countCollection(f.storage, "storeInventoryConfigurations"), 0);
});

test("browser price, provider, redirect and paid fields cannot start or confirm checkout", async (t) => {
  const f = setup(t);
  await seedGuestCatalog(f.storage);
  for (const input of [
    { lines: [{ catalogItemId: "hat", quantity: 1, price: "1" }] },
    { lines: [{ catalogItemId: "hat", quantity: 1 }], total: "1" },
    { lines: [{ catalogItemId: "hat", quantity: 1 }], paymentState: "paid" },
    { lines: [{ catalogItemId: "hat", quantity: 1 }], provider: "stripe" },
    { lines: [{ catalogItemId: "hat", quantity: 0 }] },
  ]) {
    await assert.rejects(
      () => invokeGuest(f.plugin.routes[GUEST_CHECKOUT_START_ROUTE], f.storage, input),
      (error) => error instanceof PluginRouteError && error.code === "INVALID_CART",
    );
  }
});

test("authority from a different cart or site is denied", async (t) => {
  const f = setup(t);
  await seedGuestCatalog(f.storage);
  const first = await prepareGuest(f.plugin.routes[GUEST_CHECKOUT_PREPARE_ROUTE], f.storage);
  const firstToken = capabilityOf(first);
  const started = await invokeGuest(
    f.plugin.routes[GUEST_CHECKOUT_START_ROUTE],
    f.storage,
    lines(),
    { capability: firstToken },
  );
  const other = await prepareGuest(f.plugin.routes[GUEST_CHECKOUT_PREPARE_ROUTE], f.storage);
  await assert.rejects(
    () => invokeGuest(
      f.plugin.routes[GUEST_CHECKOUT_STATUS_ROUTE],
      f.storage,
      { attemptId: started.checkout.attemptId },
      { capability: capabilityOf(other) },
    ),
    (error) => error instanceof PluginRouteError && error.code === "CHECKOUT_NOT_FOUND",
  );
  const otherSite = "http://store-b.test";
  const otherPlugin = createPlugin({
    checkout: { ...f.synth.host, siteUrl: otherSite },
  });
  await assert.rejects(
    () => invokeGuest(
      otherPlugin.routes[GUEST_CHECKOUT_STATUS_ROUTE],
      f.storage,
      {},
      {
        capability: firstToken,
        siteUrl: otherSite,
        runtimeSiteUrl: otherSite,
        origin: otherSite,
      },
    ),
    (error) => error instanceof PluginRouteError && error.code === "CAPABILITY_DENIED",
  );
});

test("forged success, unknown provider, and out-of-order wakes never replace a durable paid order", async (t) => {
  const f = setup(t);
  await seedGuestCatalog(f.storage);
  const prepared = await prepareGuest(f.plugin.routes[GUEST_CHECKOUT_PREPARE_ROUTE], f.storage);
  const token = capabilityOf(prepared);
  const started = await invokeGuest(
    f.plugin.routes[GUEST_CHECKOUT_START_ROUTE],
    f.storage,
    lines(),
    { capability: token },
  );
  assert.equal(typeof started.checkout.attemptId, "string");
  f.synth.setPayment("unknown");
  const unknown = await invokeGuest(
    f.plugin.routes[GUEST_CHECKOUT_STATUS_ROUTE],
    f.storage,
    { wake: true, paid: true, paymentId: "forged" },
    { capability: token },
  );
  assert.equal(unknown.checkout.state, "pending");
  assert.equal(unknown.checkout.order, null);
  f.synth.setPayment("paid");
  const [left, right] = await Promise.all([
    invokeGuest(f.plugin.routes[GUEST_CHECKOUT_STATUS_ROUTE], f.storage, { wake: true }, { capability: token }),
    invokeGuest(f.plugin.routes[GUEST_CHECKOUT_STATUS_ROUTE], f.storage, { wake: true }, { capability: token }),
  ]);
  assert.equal(left.checkout.state, "paid");
  assert.deepEqual(left.checkout.order, right.checkout.order);
  assert.equal(left.checkout.order.total.minor, "250");
  assert.equal(left.checkout.order.paymentId, undefined);
  f.synth.setPayment("expired-unpaid");
  const after = await invokeGuest(
    f.plugin.routes[GUEST_CHECKOUT_STATUS_ROUTE],
    f.storage,
    { wake: true },
    { capability: token },
  );
  assert.equal(after.checkout.state, "paid");
  assert.deepEqual(after.checkout.order, left.checkout.order);
});

test("authoritative terminal release then retry reprices on the same capability", async (t) => {
  const f = setup(t);
  await seedGuestCatalog(f.storage);
  const prepared = await prepareGuest(f.plugin.routes[GUEST_CHECKOUT_PREPARE_ROUTE], f.storage);
  const token = capabilityOf(prepared);
  const started = await invokeGuest(
    f.plugin.routes[GUEST_CHECKOUT_START_ROUTE],
    f.storage,
    lines(),
    { capability: token },
  );
  f.synth.setPayment("expired-unpaid");
  const released = await invokeGuest(
    f.plugin.routes[GUEST_CHECKOUT_STATUS_ROUTE],
    f.storage,
    { wake: true },
    { capability: token },
  );
  assert.equal(released.checkout.state, "released-retry");
  assert.equal(released.checkout.retryAfter, started.checkout.attemptId);
  await f.storage.catalogPrices.put("hat", {
    recordKind: "catalog-price",
    recordId: "hat",
    catalogItemId: "hat",
    regular: { currency: "USD", minor: "300" },
  });
  f.synth.setPayment("open");
  const retried = await invokeGuest(
    f.plugin.routes[GUEST_CHECKOUT_START_ROUTE],
    f.storage,
    lines(),
    { capability: token },
  );
  assert.notEqual(retried.checkout.attemptId, started.checkout.attemptId);
  assert.equal(retried.checkout.total.minor, "300");
});

test("managed basket without an inventory provider stays fail-closed and does not create a store identity", async (t) => {
  const f = setup(t, { managed: true, host: { resolveInventory: async () => null } });
  await seedGuestCatalog(f.storage, { managed: true });
  f.synth.setResolveInventory(async () => null);
  const before = await countCollection(f.storage, "storeInventoryConfigurations");
  const prepared = await prepareGuest(f.plugin.routes[GUEST_CHECKOUT_PREPARE_ROUTE], f.storage);
  const started = await invokeGuest(
    f.plugin.routes[GUEST_CHECKOUT_START_ROUTE],
    f.storage,
    lines(),
    { capability: capabilityOf(prepared) },
  );
  assert.equal(started.checkout.state, "recoverable-failure");
  assert.equal(started.checkout.order, null);
  assert.equal(started.checkout.unavailable?.code, "INVENTORY_UNAVAILABLE");
  assert.equal(started.checkout.total.minor, "250");
  assert.equal(await countCollection(f.storage, "storeInventoryConfigurations"), before);
});

test("frozen active attempt cannot be silently edited into another purchase", async (t) => {
  const f = setup(t);
  await seedGuestCatalog(f.storage);
  await seedGuestCatalog(f.storage, { itemId: "cap", price: "100" });
  const prepared = await prepareGuest(f.plugin.routes[GUEST_CHECKOUT_PREPARE_ROUTE], f.storage);
  const token = capabilityOf(prepared);
  await invokeGuest(f.plugin.routes[GUEST_CHECKOUT_START_ROUTE], f.storage, lines(), { capability: token });
  await assert.rejects(
    () => invokeGuest(
      f.plugin.routes[GUEST_CHECKOUT_START_ROUTE],
      f.storage,
      lines("cap"),
      { capability: token },
    ),
    (error) => error instanceof PluginRouteError && error.code === "CHECKOUT_FROZEN",
  );
});

test("unexpected storage failures stay guest-safe UNAVAILABLE and do not leak source strings", async (t) => {
  const f = setup(t);
  await seedGuestCatalog(f.storage);
  f.storage[CHECKOUT_GUEST_CAPABILITY_COLLECTION].compareAndSet = async () => {
    throw new Error("sqlite secret=sk_live_leak capability boom");
  };
  await assert.rejects(
    () => prepareGuest(f.plugin.routes[GUEST_CHECKOUT_PREPARE_ROUTE], f.storage),
    (error) =>
      error instanceof PluginRouteError &&
      error.code === "UNAVAILABLE" &&
      !String(error.message).includes("sk_live") &&
      !String(error.message).includes("sqlite"),
  );
});

test("kernel called directly still requires trusted site and a capability", async (t) => {
  const f = setup(t);
  await seedGuestCatalog(f.storage);
  const runtime = {
    carts: f.storage[CHECKOUT_COLLECTION],
    capabilities: f.storage[CHECKOUT_GUEST_CAPABILITY_COLLECTION],
    catalog: {
      catalog: f.storage.catalogItems,
      prices: f.storage.catalogPrices,
      backorderPolicies: f.storage.catalogBackorderPolicies,
      configurations: f.storage.storeInventoryConfigurations,
      settings: f.storage.storefrontAvailabilitySettings,
      listing: f.storage.storefrontOutOfStockListing,
      manualAvailability: f.storage.catalogManualAvailability,
    },
    constructorSiteUrl: TRUSTED_SITE,
    host: f.synth.host,
  };
  const prepared = await prepareGuestCheckout(runtime);
  assert.equal(prepared.ok, true);
  const denied = await startGuestCheckout(runtime, lines());
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "CAPABILITY_DENIED");
  const missingTenant = await prepareGuestCheckout({ ...runtime, constructorSiteUrl: undefined, host: { ...f.synth.host, siteUrl: undefined } });
  assert.equal(missingTenant.ok, false);
  assert.equal(missingTenant.error.code, "UNAVAILABLE");
});

function directKernelRuntime(storage, options) {
  return bindGuestCheckoutRuntime(storage, NATIVE_GUEST_CHECKOUT_STORAGE, options);
}

test("direct kernel prepare writes no capability when known host sources conflict or are malformed", async (t) => {
  const f = setup(t);
  await seedGuestCatalog(f.storage);
  const hostBase = { ...f.synth.host };

  const conflicting = directKernelRuntime(f.storage, {
    host: {
      ...hostBase,
      siteUrl: "http://store-b.test",
      topLevelSiteUrl: "http://store-a.test",
      checkoutSiteUrl: "http://store-b.test",
    },
    runtimeSiteUrl: "",
  });
  const conflictingMint = await prepareGuestCheckout(conflicting);
  assert.equal(conflictingMint.ok, false);
  assert.equal(conflictingMint.error.code, "UNAVAILABLE");

  const malformed = directKernelRuntime(f.storage, {
    host: {
      ...hostBase,
      siteUrl: TRUSTED_SITE,
      topLevelSiteUrl: "not-a-url",
      checkoutSiteUrl: TRUSTED_SITE,
    },
    runtimeSiteUrl: "",
  });
  const malformedMint = await prepareGuestCheckout(malformed);
  assert.equal(malformedMint.ok, false);
  assert.equal(malformedMint.error.code, "UNAVAILABLE");

  const emptyRetained = directKernelRuntime(f.storage, {
    topLevelSiteUrl: "",
    host: {
      ...hostBase,
      siteUrl: TRUSTED_SITE,
      topLevelSiteUrl: TRUSTED_SITE,
      checkoutSiteUrl: TRUSTED_SITE,
    },
    runtimeSiteUrl: "",
  });
  const emptyRetainedMint = await prepareGuestCheckout(emptyRetained);
  assert.equal(emptyRetainedMint.ok, false);
  assert.equal(emptyRetainedMint.error.code, "UNAVAILABLE");

  const splitCopies = directKernelRuntime(f.storage, {
    topLevelSiteUrl: "http://store-a.test",
    host: {
      ...hostBase,
      siteUrl: TRUSTED_SITE,
      topLevelSiteUrl: "http://store-b.test",
      checkoutSiteUrl: TRUSTED_SITE,
    },
    runtimeSiteUrl: "",
  });
  const splitMint = await prepareGuestCheckout(splitCopies);
  assert.equal(splitMint.ok, false);
  assert.equal(splitMint.error.code, "UNAVAILABLE");

  assert.equal(await countCollection(f.storage, CHECKOUT_GUEST_CAPABILITY_COLLECTION), 0);
  assert.equal(await countCollection(f.storage, CHECKOUT_COLLECTION), 0);
  assert.equal(f.synth.counts().paymentCreates, 0);
});

test("direct kernel authorize denies an existing secret when known host sources conflict or are malformed", async (t) => {
  const f = setup(t);
  await seedGuestCatalog(f.storage);
  const hostBase = { ...f.synth.host };

  const trusted = directKernelRuntime(f.storage, {
    host: {
      ...hostBase,
      siteUrl: TRUSTED_SITE,
      topLevelSiteUrl: TRUSTED_SITE,
      checkoutSiteUrl: TRUSTED_SITE,
    },
    runtimeSiteUrl: "",
  });
  const prepared = await prepareGuestCheckout(trusted);
  assert.equal(prepared.ok, true);
  const token = capabilityOf(prepared);
  assert.equal(await countCollection(f.storage, CHECKOUT_GUEST_CAPABILITY_COLLECTION), 1);

  const conflictedAuthorize = directKernelRuntime(f.storage, {
    host: {
      ...hostBase,
      siteUrl: TRUSTED_SITE,
      topLevelSiteUrl: "http://store-a.test",
      checkoutSiteUrl: "http://store-b.test",
    },
    runtimeSiteUrl: "",
  });
  const conflictedStart = await startGuestCheckout(conflictedAuthorize, lines(), {
    [GUEST_CAPABILITY_HEADER]: token,
  });
  assert.equal(conflictedStart.ok, false);
  assert.equal(conflictedStart.error.code, "UNAVAILABLE");

  const malformedAuthorize = directKernelRuntime(f.storage, {
    host: {
      ...hostBase,
      siteUrl: TRUSTED_SITE,
      topLevelSiteUrl: "not-a-url",
      checkoutSiteUrl: TRUSTED_SITE,
    },
    runtimeSiteUrl: "",
  });
  const malformedStart = await startGuestCheckout(malformedAuthorize, lines(), {
    [GUEST_CAPABILITY_HEADER]: token,
  });
  assert.equal(malformedStart.ok, false);
  assert.equal(malformedStart.error.code, "UNAVAILABLE");

  const shadowedAuthorize = directKernelRuntime(f.storage, {
    topLevelSiteUrl: "",
    host: {
      ...hostBase,
      siteUrl: TRUSTED_SITE,
      topLevelSiteUrl: TRUSTED_SITE,
      checkoutSiteUrl: TRUSTED_SITE,
    },
    runtimeSiteUrl: "",
  });
  const shadowedStart = await startGuestCheckout(shadowedAuthorize, lines(), {
    [GUEST_CAPABILITY_HEADER]: token,
  });
  assert.equal(shadowedStart.ok, false);
  assert.equal(shadowedStart.error.code, "UNAVAILABLE");

  assert.equal(await countCollection(f.storage, CHECKOUT_GUEST_CAPABILITY_COLLECTION), 1);
  assert.equal(await countCollection(f.storage, CHECKOUT_COLLECTION), 0);
  assert.equal(f.synth.counts().paymentCreates, 0);
  assert.equal(await countCollection(f.storage, "storeInventoryConfigurations"), 0);
});

test("guest projection suppresses redirectUrl in released state and when real provider expiry has passed", () => {
  const baseAttempt = {
    attemptId: "att-1",
    cart: [{ catalogItemId: "hat", quantity: 1 }],
    payment: {
      attemptId: "att-1",
      bindingRef: "stripe-test",
      lines: [{ catalogItemId: "hat", quantity: 1, name: "Hat", unitPrice: { currency: "USD", minor: "250" } }],
      total: { currency: "USD", minor: "250" },
      paymentMethods: ["card"],
      paymentWindow: { minSeconds: 1800, maxSeconds: 1860 },
    },
    phase: "paying",
    session: {
      sessionId: "sess-1",
      redirectUrl: "https://pay.example/session-1",
      createdAt: 1000,
      expiresAt: 2800,
    },
  };

  const active = projectGuestCheckout(baseAttempt, 2000);
  assert.equal(active.redirectUrl, "https://pay.example/session-1");

  const released = projectGuestCheckout({ ...baseAttempt, phase: "released" }, 2000);
  assert.equal(released.redirectUrl, null);
  assert.equal(released.state, "released-retry");

  const expired = projectGuestCheckout(baseAttempt, 2801);
  assert.equal(expired.redirectUrl, null);

  const paid = projectGuestCheckout({
    ...baseAttempt,
    phase: "paid",
    order: {
      orderId: "ord-1",
      receiptId: "rec-1",
      attemptId: "att-1",
      paymentId: "pay-1",
      lines: baseAttempt.payment.lines,
      total: baseAttempt.payment.total,
    },
  }, 2000);
  assert.equal(paid.redirectUrl, null);
  assert.equal(paid.state, "paid");
});
