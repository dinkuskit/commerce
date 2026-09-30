import { randomUUID } from "node:crypto";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { PluginStorageRepository } from "emdash";

import {
  CHECKOUT_COLLECTION,
  CHECKOUT_GUEST_CAPABILITY_COLLECTION,
  COMMERCE_PLUGIN_ID,
  createPlugin,
  guestCheckoutStartRoute,
  guestCheckoutStatusRoute,
} from "../../../dist/index.js";
import { initializeCatalogDatabase } from "../../integration/sqlite-fixture.mjs";
import { fixture } from "./fixture.mjs";

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
      [CHECKOUT_COLLECTION]: collection(CHECKOUT_COLLECTION),
      [CHECKOUT_GUEST_CAPABILITY_COLLECTION]: collection(CHECKOUT_GUEST_CAPABILITY_COLLECTION),
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
  return {
    fixture: f,
    host: {
      paymentBindingRef: "stripe-test-binding",
      resolvePayments: f.execution.resolvePayments,
      resolveInventory: f.execution.resolveInventory,
      resolveAvailabilityProvider: f.execution.availability.resolveProvider,
      now: f.execution.now,
      createAttemptId: () => randomUUID(),
      ...overrides.host,
    },
    setPayment: f.setPayment,
    setStock: f.setStock,
    setNow: f.setNow,
    counts: f.counts,
    holds: f.holds,
    sessions: f.sessions,
  };
}

export function guestContext(storage, input, { siteUrl = "http://store-a.test", capability, method = "POST" } = {}) {
  const headers = { "content-type": "application/json" };
  if (capability) headers["x-commerce-guest-capability"] = capability;
  return {
    storage,
    input,
    request: new Request(`http://127.0.0.1/_emdash/api/plugins/dinkus-commerce/checkout/guest/start`, {
      method,
      headers,
      body: JSON.stringify(input ?? {}),
    }),
    site: { url: siteUrl, name: "Test", locale: "en" },
  };
}

export async function invokeGuest(route, storage, input, options = {}) {
  return route.handler(guestContext(storage, input, options));
}

export function defaultPluginRoutes() {
  const plugin = createPlugin();
  return plugin;
}

export function injectedPluginRoutes(host) {
  return createPlugin({ checkout: host });
}

export { guestCheckoutStartRoute, guestCheckoutStatusRoute };
