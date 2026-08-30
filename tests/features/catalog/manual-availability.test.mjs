import assert from "node:assert/strict";
import test from "node:test";
import { PluginRouteError } from "emdash";

import {
  CATALOG_MANUAL_AVAILABILITY_COLLECTION,
  DEFAULT_CATALOG_MANUAL_AVAILABILITY,
  SET_CATALOG_ITEM_MANUAL_AVAILABILITY_ROUTE,
  CatalogError,
  createPlugin,
  loadCatalogItemManualAvailability,
  setCatalogItemManualAvailability,
} from "../../../dist/index.js";

class MemoryCollection {
  constructor(records = []) {
    this.records = new Map(
      records.map((record) => [record.recordId ?? record.itemId, structuredClone(record)]),
    );
    this.puts = [];
  }

  async get(id) {
    const record = this.records.get(id);
    return record === undefined ? null : structuredClone(record);
  }

  async put(id, record) {
    this.records.set(id, structuredClone(record));
    this.puts.push({ id, record: structuredClone(record) });
  }
}

function catalogItem(overrides = {}) {
  return {
    recordKind: "catalog-item",
    itemId: "item-grill",
    commandId: "catalog:create:grill",
    creationIntent: { manageStock: false },
    kind: "simple-product",
    name: "Smoky Grill",
    sku: "SMOKY-GRILL",
    skuKey: "SMOKY-GRILL",
    stockManagement: { mode: "unmanaged" },
    state: "draft",
    createdAt: "2026-08-30T00:00:00.000Z",
    ...overrides,
  };
}

test("new and legacy unmanaged products normalize to In stock without a write", async () => {
  const availability = new MemoryCollection();

  const loaded = await loadCatalogItemManualAvailability(
    availability,
    "item-grill",
  );

  assert.equal(DEFAULT_CATALOG_MANUAL_AVAILABILITY, "in-stock");
  assert.deepEqual(loaded, {
    recordKind: "catalog-manual-availability",
    recordId: "item-grill",
    catalogItemId: "item-grill",
    status: "in-stock",
  });
  assert.equal(availability.puts.length, 0);
});

test("an unmanaged product persists one strict manual status idempotently", async () => {
  const catalog = new MemoryCollection([catalogItem()]);
  const availability = new MemoryCollection();

  const first = await setCatalogItemManualAvailability(
    { catalog, availability },
    { catalogItemId: "item-grill", status: "out-of-stock" },
  );
  const retry = await setCatalogItemManualAvailability(
    { catalog, availability },
    { catalogItemId: "item-grill", status: "out-of-stock" },
  );
  const backorder = await setCatalogItemManualAvailability(
    { catalog, availability },
    { catalogItemId: "item-grill", status: "available-on-backorder" },
  );

  assert.equal(first.changed, true);
  assert.equal(retry.changed, false);
  assert.equal(backorder.changed, true);
  assert.equal(backorder.availability.status, "available-on-backorder");
  assert.equal(availability.puts.length, 2);
  assert.equal(catalog.puts.length, 0);
});

test("manual availability cannot be changed while Manage Stock is enabled", async () => {
  const catalog = new MemoryCollection([
    catalogItem({
      creationIntent: { manageStock: true },
      stockManagement: {
        mode: "managed",
        status: "active",
        inventorySkuId: "inventory-sku-grill",
      },
    }),
  ]);
  const availability = new MemoryCollection([
    {
      recordKind: "catalog-manual-availability",
      recordId: "item-grill",
      catalogItemId: "item-grill",
      status: "out-of-stock",
    },
  ]);

  await assert.rejects(
    setCatalogItemManualAvailability(
      { catalog, availability },
      { catalogItemId: "item-grill", status: "in-stock" },
    ),
    (error) =>
      error instanceof CatalogError && error.code === "MANAGE_STOCK_ENABLED",
  );
  assert.equal(availability.puts.length, 0);
  assert.equal(availability.records.get("item-grill").status, "out-of-stock");
});

test("manual availability rejects malformed input and untrustworthy storage", async () => {
  const catalog = new MemoryCollection([catalogItem()]);
  const availability = new MemoryCollection();

  for (const input of [
    null,
    { catalogItemId: "item-grill" },
    { catalogItemId: "", status: "in-stock" },
    { catalogItemId: "item-grill", status: "low-stock" },
    { catalogItemId: "item-grill", status: "in-stock", quantity: 5 },
  ]) {
    await assert.rejects(
      setCatalogItemManualAvailability({ catalog, availability }, input),
      (error) => error instanceof CatalogError && error.code === "INVALID_INPUT",
    );
  }

  await assert.rejects(
    setCatalogItemManualAvailability(
      { catalog: new MemoryCollection(), availability },
      { catalogItemId: "missing", status: "in-stock" },
    ),
    (error) =>
      error instanceof CatalogError && error.code === "CATALOG_ITEM_NOT_FOUND",
  );

  const malformed = new MemoryCollection([
    {
      recordKind: "catalog-manual-availability",
      recordId: "item-grill",
      catalogItemId: "different-item",
      status: "out-of-stock",
    },
  ]);
  await assert.rejects(
    loadCatalogItemManualAvailability(malformed, "item-grill"),
    (error) => error instanceof CatalogError && error.code === "STORAGE_UNAVAILABLE",
  );

  assert.equal(availability.puts.length, 0);
  assert.equal(catalog.puts.length, 0);
});

test("the plugin exposes one private permissioned manual-availability action", async () => {
  const plugin = createPlugin();
  const route = plugin.routes[SET_CATALOG_ITEM_MANUAL_AVAILABILITY_ROUTE];
  const catalog = new MemoryCollection([catalogItem()]);
  const availability = new MemoryCollection();
  const storage = {
    catalogItems: catalog,
    [CATALOG_MANUAL_AVAILABILITY_COLLECTION]: availability,
  };

  assert.deepEqual(plugin.storage[CATALOG_MANUAL_AVAILABILITY_COLLECTION], {
    indexes: [],
    uniqueIndexes: [],
  });
  assert.equal(route.public, undefined);
  assert.equal(route.permission, "content:edit_any");
  await assert.rejects(
    route.handler({
      input: { catalogItemId: "item-grill", status: "out-of-stock" },
      storage,
      request: new Request("https://example.test/set-manual-availability", {
        method: "GET",
      }),
    }),
    (error) => error instanceof PluginRouteError && error.status === 405,
  );

  const result = await route.handler({
    input: { catalogItemId: "item-grill", status: "out-of-stock" },
    storage,
    request: new Request("https://example.test/set-manual-availability", {
      method: "POST",
    }),
  });

  assert.equal(result.availability.status, "out-of-stock");
  assert.equal(availability.records.get("item-grill").status, "out-of-stock");

  catalog.records.set(
    "item-grill",
    catalogItem({
      stockManagement: { mode: "managed", status: "setup-required" },
    }),
  );
  await assert.rejects(
    route.handler({
      input: { catalogItemId: "item-grill", status: "in-stock" },
      storage,
      request: new Request("https://example.test/set-manual-availability", {
        method: "POST",
      }),
    }),
    (error) =>
      error instanceof PluginRouteError &&
      error.code === "MANAGE_STOCK_ENABLED" &&
      error.status === 409,
  );
});
