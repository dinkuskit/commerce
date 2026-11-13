import { randomUUID } from "node:crypto";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { PluginStorageRepository } from "emdash";

import {
  CHECKOUT_COLLECTION,
  CHECKOUT_GUEST_CAPABILITY_COLLECTION,
  CHECKOUT_PAYMENT_ASSOCIATIONS_COLLECTION,
  COMMERCE_PLUGIN_ID,
  GUEST_CHECKOUT_CART_ROUTE,
  GUEST_CHECKOUT_PREPARE_ROUTE,
  GUEST_CHECKOUT_START_ROUTE,
  GUEST_CHECKOUT_STATUS_ROUTE,
  createGuestCheckoutCartRoute,
  ORDER_NUMBERS_COLLECTION,
  ORDERS_COLLECTION,
  createGuestCheckoutPrepareRoute,
  createGuestCheckoutStartRoute,
  createGuestCheckoutStatusRoute,
  createPaidOrderReceiver,
  guestCheckoutPrepareRoute,
  guestCheckoutStartRoute,
  guestCheckoutStatusRoute,
} from "../../../dist/index.js";
import { initializeCatalogDatabase } from "../../integration/sqlite-fixture.mjs";
import { fixture } from "./fixture.mjs";

export const TRUSTED_SITE = "http://store-a.test";

const PLUGIN_STORAGE_TABLE = `
  CREATE TABLE IF NOT EXISTS _plugin_storage (
    plugin_id TEXT NOT NULL,
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    revision TEXT NOT NULL DEFAULT '0',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (plugin_id, collection, id)
  )
`;

export function initializeGuestCheckoutDatabase(path) {
  initializeCatalogDatabase(path);
  const database = new BetterSqlite3(path);
  database.exec(PLUGIN_STORAGE_TABLE);
  database.close();
}

export function openGuestCollections(path) {
  const database = new BetterSqlite3(path);
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  const db = new Kysely({ dialect: new SqliteDialect({ database }) });
  const collection = (name, indexes = []) =>
    new PluginStorageRepository(db, COMMERCE_PLUGIN_ID, name, indexes);
  return {
    db,
    storage: {
      catalogItems: collection("catalogItems"),
      catalogPrices: collection("catalogPrices"),
      catalogBackorderPolicies: collection("catalogBackorderPolicies"),
      catalogManualAvailability: collection("catalogManualAvailability"),
      storeInventoryConfigurations: collection("storeInventoryConfigurations", ["configurationKey"]),
      storefrontAvailabilitySettings: collection("storefrontAvailabilitySettings"),
      storefrontOutOfStockListing: collection("storefrontOutOfStockListing"),
      managedSkuClaims: collection("managedSkuClaims"),
      [CHECKOUT_COLLECTION]: collection(CHECKOUT_COLLECTION, ["cartExpires"]),
      [CHECKOUT_GUEST_CAPABILITY_COLLECTION]: collection(CHECKOUT_GUEST_CAPABILITY_COLLECTION),
      [CHECKOUT_PAYMENT_ASSOCIATIONS_COLLECTION]: collection(CHECKOUT_PAYMENT_ASSOCIATIONS_COLLECTION),
    },
  };
}

export async function seedGuestCatalog(storage, { managed = false, itemId = "hat", price = "250" } = {}) {
  const now = "2026-09-30T00:00:00.000Z";
  await storage.catalogItems.put(itemId, {
    recordKind: "catalog-item",
    itemId,
    commandId: `catalog:create:${itemId}`,
    creationIntent: { manageStock: managed },
    kind: "simple-product",
    // Digital, so contact-only scenarios need no delivery address.
    fulfillment: "digital",
    name: itemId,
    sku: itemId.toUpperCase(),
    skuKey: itemId.toUpperCase(),
    stockManagement: managed
      ? { mode: "managed", status: "active", inventorySkuId: `sku-${itemId}` }
      : { mode: "unmanaged" },
    state: "draft",
    createdAt: now,
  });
  await storage.catalogPrices.put(itemId, {
    recordKind: "catalog-price",
    recordId: itemId,
    catalogItemId: itemId,
    regular: { currency: "USD", minor: price },
  });
  if (!managed) {
    await storage.catalogManualAvailability.put(itemId, {
      recordKind: "catalog-manual-availability",
      recordId: itemId,
      catalogItemId: itemId,
      status: "in-stock",
    });
  } else {
    await storage.storeInventoryConfigurations.put("config", {
      recordKind: "store-inventory-configuration",
      recordId: "config",
      configurationKey: "active",
      siteId: "site-test",
      binding: {
        providerRef: "inventory-test",
        poolId: "pool-test",
        defaultFulfillmentLocationId: "location-test",
      },
      configuredAt: now,
      updatedAt: now,
    });
  }
}

export function syntheticCheckoutHost(overrides = {}) {
  const opened = { store: { async read() { return null; }, async compareAndSet() { return false; } } };
  const f = fixture(opened.store, overrides.managed !== false);
  let paymentCreates = 0;
  let paymentLookups = 0;
  let customResolveInventory = overrides.host?.resolveInventory;
  let customResolveAvailabilityProvider = overrides.host?.resolveAvailabilityProvider;
  const resolvePayments = async (ref) => {
    const port = await f.execution.resolvePayments(ref);
    if (!port) return null;
    return {
      ensureSession: async (request) => {
        paymentCreates += 1;
        return port.ensureSession(request);
      },
      lookup: async (request) => {
        paymentLookups += 1;
        return port.lookup(request);
      },
    };
  };
  const resolveInventory = async (...args) => {
    if (customResolveInventory !== undefined) {
      return typeof customResolveInventory === "function"
        ? customResolveInventory(...args)
        : customResolveInventory;
    }
    return f.execution.resolveInventory(...args);
  };
  const resolveAvailabilityProvider = async (...args) => {
    if (customResolveAvailabilityProvider !== undefined) {
      return typeof customResolveAvailabilityProvider === "function"
        ? customResolveAvailabilityProvider(...args)
        : customResolveAvailabilityProvider;
    }
    return f.execution.availability.resolveProvider(...args);
  };
  const host = {
    loadCheckoutContactRequirements: f.execution.loadCheckoutContactRequirements,
    siteUrl: TRUSTED_SITE,
    paymentBindingRef: "stripe-test-binding",
    now: f.execution.now,
    createAttemptId: () => randomUUID(),
    ...overrides.host,
    resolvePayments,
    resolveInventory,
    resolveAvailabilityProvider,
  };
  return {
    fixture: f,
    host,
    setPayment: f.setPayment,
    setStock: f.setStock,
    setNow: f.setNow,
    setResolveInventory(fn) { customResolveInventory = fn; },
    setResolveAvailabilityProvider(fn) { customResolveAvailabilityProvider = fn; },
    counts: () => ({ ...f.counts(), paymentCreates, paymentLookups }),
    holds: f.holds,
    sessions: f.sessions,
  };
}

export function guestContext(storage, input, {
  siteUrl = TRUSTED_SITE,
  runtimeSiteUrl = siteUrl,
  capability,
  method = "POST",
  route = GUEST_CHECKOUT_START_ROUTE,
  origin,
  fetchSite = "same-origin",
  settings = { async getVersioned() { return null; } },
} = {}) {
  const headers = { "content-type": "application/json" };
  if (origin !== null) headers.origin = origin === undefined ? siteUrl : origin;
  if (fetchSite) headers["sec-fetch-site"] = fetchSite;
  if (capability) headers["x-commerce-guest-capability"] = capability;
  const requestInit = {
    method,
    headers,
  };
  if (method !== "GET" && method !== "HEAD") {
    requestInit.body = JSON.stringify(input ?? {});
  }
  return {
    storage,
    settings,
    input,
    request: new Request(`${siteUrl}/_emdash/api/plugins/dinkus-commerce/${route}`, requestInit),
    site: { url: runtimeSiteUrl, name: "Test", locale: "en" },
  };
}

/** Lines in the browser's order, merged like Commerce's cart, to tell an unchanged cart apart. */
function cartKey(lines) {
  const merged = new Map();
  for (const line of lines) merged.set(line.catalogItemId, (merged.get(line.catalogItemId) ?? 0) + line.quantity);
  return JSON.stringify([...merged].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Checkout starts from the cart record (commerce-server-cart-20261113). A test that still hands start
 * its lines saves them to the cart first, the way the store site does, then starts without them.
 */
export async function invokeGuest(route, storage, input, options = {}) {
  const lines = input && typeof input === "object" && !Array.isArray(input) ? input.lines : undefined;
  if (route.cartRoute && lines !== undefined && options.capability) {
    const { lines: _sent, ...rest } = input;
    const cartOptions = { ...options, route: GUEST_CHECKOUT_CART_ROUTE };
    const read = await route.cartRoute.handler(guestContext(storage, {}, cartOptions)).catch(() => null);
    const frozen = read?.checkout?.attemptId && read.checkout.state !== "released-retry";
    const saved = frozen ? read.checkout.lines.map(({ catalogItemId, quantity }) => ({ catalogItemId, quantity })) : read?.cart?.lines ?? [];
    if (!read || !Array.isArray(lines) || !lines.every(line => line && Number.isSafeInteger(line.quantity)) ||
        cartKey(saved) !== cartKey(lines)) {
      await route.cartRoute.handler(guestContext(storage, { lines, version: read?.cart?.version ?? null }, cartOptions));
    }
    return route.handler(guestContext(storage, rest, options));
  }
  return route.handler(guestContext(storage, input, options));
}

export async function prepareGuest(route, storage, options = {}) {
  return invokeGuest(route, storage, {}, { ...options, route: GUEST_CHECKOUT_PREPARE_ROUTE });
}

// Checkout hands each paid order to Orders, which keeps its own copy.
const paidOrders = (storage) => createPaidOrderReceiver(storage[ORDERS_COLLECTION], storage[ORDER_NUMBERS_COLLECTION]);

/**
 * The library's guest checkout routes, given host options the way a host composes them: a site URL and the
 * checkout host's own (the two must agree). The package root no longer mounts them as an EmDash plugin
 * (commerce-remove-native-entry-20261101); the Registry build has its own installed handlers.
 */
export function mountGuestRoutes(options = {}) {
  const topLevelSiteUrl = options.siteUrl;
  const checkoutSiteUrl = options.checkout?.siteUrl;
  const host = Object.freeze({
    ...options.checkout,
    topLevelSiteUrl,
    checkoutSiteUrl,
    siteUrl: checkoutSiteUrl ?? topLevelSiteUrl,
  });
  return {
    routes: {
      [GUEST_CHECKOUT_PREPARE_ROUTE]: createGuestCheckoutPrepareRoute(host),
      [GUEST_CHECKOUT_START_ROUTE]: Object.assign(createGuestCheckoutStartRoute(host, paidOrders),
        { cartRoute: createGuestCheckoutCartRoute(host, paidOrders) }),
      [GUEST_CHECKOUT_CART_ROUTE]: createGuestCheckoutCartRoute(host, paidOrders),
      [GUEST_CHECKOUT_STATUS_ROUTE]: createGuestCheckoutStatusRoute(host, paidOrders),
    },
  };
}

export function injectedPluginRoutes(host) {
  return mountGuestRoutes({ checkout: host });
}

export {
  GUEST_CHECKOUT_PREPARE_ROUTE,
  GUEST_CHECKOUT_START_ROUTE,
  guestCheckoutPrepareRoute,
  guestCheckoutStartRoute,
  guestCheckoutStatusRoute,
};
