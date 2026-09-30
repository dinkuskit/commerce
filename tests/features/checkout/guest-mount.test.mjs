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
  GUEST_CHECKOUT_START_ROUTE,
  GUEST_CHECKOUT_STATUS_ROUTE,
  createPlugin,
  createGuestCheckoutStartRoute,
  guestCheckoutStartRoute,
  guestCheckoutStatusRoute,
} from "../../../dist/index.js";
import {
  initializeGuestCheckoutDatabase,
  injectedPluginRoutes,
  invokeGuest,
  openGuestCollections,
  seedGuestCatalog,
  syntheticCheckoutHost,
} from "./guest-dispatch.mjs";

function setup(t, { managed = false, inject = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "guest-mount-"));
  const path = join(dir, "commerce.sqlite");
  initializeGuestCheckoutDatabase(path);
  const opened = openGuestCollections(path);
  t.after(async () => {
    await opened.db.destroy();
    rmSync(dir, { recursive: true, force: true });
  });
  const synth = syntheticCheckoutHost({ managed });
  const plugin = inject ? injectedPluginRoutes(synth.host) : createPlugin();
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

test("default createPlugin mounts checkout storage and public guest routes without a production payments adapter", () => {
  const plugin = createPlugin();
  assert.ok(plugin.storage[CHECKOUT_COLLECTION]);
  assert.ok(plugin.storage[CHECKOUT_GUEST_CAPABILITY_COLLECTION]);
  assert.equal(plugin.routes[GUEST_CHECKOUT_START_ROUTE].public, true);
  assert.equal(plugin.routes[GUEST_CHECKOUT_STATUS_ROUTE].public, true);
  assert.deepEqual(plugin.routes[GUEST_CHECKOUT_START_ROUTE].request.headers, [GUEST_CAPABILITY_HEADER]);
  assert.equal(typeof guestCheckoutStartRoute.handler, "function");
  assert.equal(typeof guestCheckoutStatusRoute.handler, "function");
  assert.equal(typeof createGuestCheckoutStartRoute, "function");
});

test("missing production payments adapter is explicit unavailability and does not mint a capability", async (t) => {
  const f = setup(t, { inject: false });
  await seedGuestCatalog(f.storage);
  await assert.rejects(
    () => invokeGuest(f.plugin.routes[GUEST_CHECKOUT_START_ROUTE], f.storage, lines()),
    (error) => error instanceof PluginRouteError && error.code === "PAYMENTS_UNAVAILABLE" && error.status === 503,
  );
  assert.equal((await f.storage[CHECKOUT_GUEST_CAPABILITY_COLLECTION].query({ limit: 10 })).items.length, 0);
  assert.equal((await f.storage[CHECKOUT_COLLECTION].query({ limit: 10 })).items.length, 0);
  assert.equal((await f.storage.storeInventoryConfigurations.query({ limit: 10 })).items.length, 0);
});

test("unmanaged start mints a retained capability, ignores guessed IDs, and never contacts Inventory", async (t) => {
  const f = setup(t);
  await seedGuestCatalog(f.storage);
  f.synth.host.resolveInventory = async () => {
    throw new Error("must not call inventory");
  };
  f.synth.host.resolveAvailabilityProvider = async () => {
    throw new Error("must not read inventory");
  };
  const started = await invokeGuest(f.plugin.routes[GUEST_CHECKOUT_START_ROUTE], f.storage, lines());
  const token = capabilityOf(started);
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
  assert.equal((await f.storage.storeInventoryConfigurations.query({ limit: 10 })).items.length, 0);
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

test("retry and process restart keep one attempt; cross-site and cross-cart capabilities are denied", async (t) => {
  const f = setup(t);
  await seedGuestCatalog(f.storage);
  const first = await invokeGuest(f.plugin.routes[GUEST_CHECKOUT_START_ROUTE], f.storage, lines());
  const token = capabilityOf(first);
  const retry = await invokeGuest(
    f.plugin.routes[GUEST_CHECKOUT_START_ROUTE],
    f.storage,
    lines(),
    { capability: token },
  );
  assert.equal(retry.capability, undefined);
  assert.equal(retry.checkout.attemptId, first.checkout.attemptId);
  const other = await invokeGuest(f.plugin.routes[GUEST_CHECKOUT_START_ROUTE], f.storage, lines());
  await assert.rejects(
    () => invokeGuest(
      f.plugin.routes[GUEST_CHECKOUT_STATUS_ROUTE],
      f.storage,
      { attemptId: first.checkout.attemptId },
      { capability: capabilityOf(other) },
    ),
    (error) => error instanceof PluginRouteError && error.code === "CHECKOUT_NOT_FOUND",
  );
  await assert.rejects(
    () => invokeGuest(
      f.plugin.routes[GUEST_CHECKOUT_STATUS_ROUTE],
      f.storage,
      {},
      { capability: token, siteUrl: "http://store-b.test" },
    ),
    (error) => error instanceof PluginRouteError && error.code === "CAPABILITY_DENIED",
  );
  await f.db.destroy();
  const reopened = openGuestCollections(f.path);
  t.after(() => reopened.db.destroy());
  const restarted = await invokeGuest(
    f.plugin.routes[GUEST_CHECKOUT_START_ROUTE],
    reopened.storage,
    lines(),
    { capability: token },
  );
  assert.equal(restarted.checkout.attemptId, first.checkout.attemptId);
});

test("forged success, unknown provider, and out-of-order wakes never replace a durable paid order", async (t) => {
  const f = setup(t);
  await seedGuestCatalog(f.storage);
  const started = await invokeGuest(f.plugin.routes[GUEST_CHECKOUT_START_ROUTE], f.storage, lines());
  const token = capabilityOf(started);
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
  const started = await invokeGuest(f.plugin.routes[GUEST_CHECKOUT_START_ROUTE], f.storage, lines());
  const token = capabilityOf(started);
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
  const f = setup(t, { managed: true });
  await seedGuestCatalog(f.storage, { managed: true });
  f.synth.host.resolveInventory = async () => null;
  const before = (await f.storage.storeInventoryConfigurations.query({ limit: 10 })).items.length;
  const started = await invokeGuest(f.plugin.routes[GUEST_CHECKOUT_START_ROUTE], f.storage, lines());
  assert.equal(started.checkout.state, "recoverable-failure");
  assert.equal(started.checkout.order, null);
  assert.equal((await f.storage.storeInventoryConfigurations.query({ limit: 10 })).items.length, before);
});

test("frozen active attempt cannot be silently edited into another purchase", async (t) => {
  const f = setup(t);
  await seedGuestCatalog(f.storage);
  await seedGuestCatalog(f.storage, { itemId: "cap", price: "100" });
  const started = await invokeGuest(f.plugin.routes[GUEST_CHECKOUT_START_ROUTE], f.storage, lines());
  const token = capabilityOf(started);
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
