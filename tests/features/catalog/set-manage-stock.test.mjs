import assert from "node:assert/strict";
import test from "node:test";
import { PluginRouteError } from "emdash";

import {
  CATALOG_BACKORDER_POLICIES_COLLECTION,
  CATALOG_MANUAL_AVAILABILITY_COLLECTION,
  MANAGED_SKU_REGISTRATION_CLAIMS_COLLECTION,
  SET_CATALOG_ITEM_MANAGE_STOCK_ROUTE,
  CatalogError,
  createManagedSkuRegistrationClaimKey,
  createPlugin,
  currentManageStockRevision,
  managedSkuRegistrationClaimUniqueIndexName,
  setCatalogItemBackorders,
  setCatalogItemManageStock,
  setCatalogItemManualAvailability,
} from "../../../dist/index.js";

function uniqueViolation(indexName) {
  const error = new Error(`UNIQUE constraint failed: index '${indexName}'`);
  error.code = "SQLITE_CONSTRAINT_UNIQUE";
  return error;
}

class MemoryCollection {
  constructor(records = [], uniqueIndexes = {}) {
    this.uniqueIndexes = uniqueIndexes;
    this.records = new Map(
      records.map((record) => [record.recordId ?? record.itemId, structuredClone(record)]),
    );
    this.puts = [];
    this.deletes = [];
  }

  async get(id) {
    const record = this.records.get(id);
    return record === undefined ? null : structuredClone(record);
  }

  async put(id, record) {
    for (const [field, indexName] of Object.entries(this.uniqueIndexes)) {
      const collision = [...this.records.entries()].find(
        ([otherId, stored]) => otherId !== id && stored[field] === record[field],
      );
      if (collision) throw uniqueViolation(indexName);
    }
    this.records.set(id, structuredClone(record));
    this.puts.push({ id, record: structuredClone(record) });
  }

  async delete(id) {
    this.deletes.push(id);
    return this.records.delete(id);
  }

  async query(options = {}) {
    const entries = [...this.records.entries()].filter(([, record]) =>
      Object.entries(options.where ?? {}).every(([field, value]) => record[field] === value),
    );
    const limit = options.limit ?? 50;
    return {
      items: entries.slice(0, limit).map(([id, data]) => ({
        id,
        data: structuredClone(data),
      })),
      hasMore: entries.length > limit,
    };
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

function claimStorage(records = []) {
  const storage = new MemoryCollection([], {
    claimKey: managedSkuRegistrationClaimUniqueIndexName("claimKey"),
    operationId: managedSkuRegistrationClaimUniqueIndexName("operationId"),
  });
  for (const record of records) {
    storage.records.set(record.recordId, structuredClone(record));
  }
  return storage;
}

function registrationClaim(overrides = {}) {
  const catalogItemId = overrides.catalogItemId ?? "item-grill";
  return {
    recordKind: "managed-sku-registration-claim",
    recordId: "claim-record-grill",
    claimKey: createManagedSkuRegistrationClaimKey({ catalogItemId }),
    catalogItemId,
    operationId: "operation-grill",
    request: {
      poolId: "pool-smoky",
      sku: "SMOKY-GRILL",
      displayNameIfNew: "Smoky Grill",
    },
    createdAt: "2026-08-30T02:00:00.000Z",
    ...overrides,
  };
}

test("enabling Manage Stock persists setup-required and increments revision", async () => {
  const catalog = new MemoryCollection([catalogItem()]);
  const claims = claimStorage();
  const policies = new MemoryCollection();
  const availability = new MemoryCollection();

  const first = await setCatalogItemManageStock(
    { catalog, claims },
    { catalogItemId: "item-grill", manageStock: true },
  );
  const retry = await setCatalogItemManageStock(
    { catalog, claims },
    { catalogItemId: "item-grill", manageStock: true },
  );

  assert.equal(first.changed, true);
  assert.deepEqual(first.item.stockManagement, {
    mode: "managed",
    status: "setup-required",
  });
  assert.equal(first.item.manageStockRevision, 1);
  assert.deepEqual(first.item.creationIntent, { manageStock: false });
  assert.equal("quantity" in first.item.stockManagement, false);
  assert.equal(retry.changed, false);
  assert.deepEqual(retry.item.stockManagement, first.item.stockManagement);
  assert.equal(retry.item.manageStockRevision, 1);
  assert.equal(catalog.puts.length, 1);
  assert.equal(claims.records.size, 0);
  assert.equal(policies.puts.length, 0);
  assert.equal(availability.puts.length, 0);
});

test("disabling Manage Stock is Commerce-only and restores dormant manual availability authority", async () => {
  const catalog = new MemoryCollection([
    catalogItem({
      creationIntent: { manageStock: true },
      manageStockRevision: 1,
      stockManagement: {
        mode: "managed",
        status: "active",
        inventorySkuId: "inventory-sku-grill",
      },
    }),
  ]);
  const claims = claimStorage([registrationClaim()]);
  const policies = new MemoryCollection();
  const availability = new MemoryCollection();

  await setCatalogItemBackorders(
    { catalog, policies },
    { catalogItemId: "item-grill", allowBackorders: true },
  );
  await setCatalogItemManualAvailability(
    {
      catalog: {
        async get() {
          return catalogItem({ stockManagement: { mode: "unmanaged" } });
        },
      },
      availability,
    },
    { catalogItemId: "item-grill", status: "out-of-stock" },
  );

  const disabled = await setCatalogItemManageStock(
    { catalog, claims },
    { catalogItemId: "item-grill", manageStock: false },
  );

  assert.equal(disabled.changed, true);
  assert.deepEqual(disabled.item.stockManagement, { mode: "unmanaged" });
  assert.equal(disabled.item.manageStockRevision, 1);
  assert.deepEqual(disabled.item.creationIntent, { manageStock: true });
  assert.equal(claims.records.size, 0);
  assert.equal(policies.records.get("item-grill").allowBackorders, true);
  assert.equal(availability.records.get("item-grill").status, "out-of-stock");
  assert.equal(
    catalog.puts.filter((entry) => entry.record.recordKind === "catalog-item").length,
    1,
  );
});

test("re-enabling starts a new revision so leftover claims cannot block fresh setup", async () => {
  const catalog = new MemoryCollection([
    catalogItem({
      manageStockRevision: 1,
      stockManagement: {
        mode: "managed",
        status: "setup-pending",
        registration: {
          operationId: "operation-grill",
          request: {
            poolId: "pool-smoky",
            sku: "SMOKY-GRILL",
            displayNameIfNew: "Smoky Grill",
          },
        },
      },
    }),
  ]);
  const claims = claimStorage([
    registrationClaim(),
    registrationClaim({
      recordId: "claim-record-after-rejection",
      claimKey: createManagedSkuRegistrationClaimKey({
        catalogItemId: "item-grill",
        rejectedOperationId: "operation-grill",
      }),
      operationId: "operation-grill-retry",
    }),
  ]);

  const disabled = await setCatalogItemManageStock(
    { catalog, claims },
    { catalogItemId: "item-grill", manageStock: false },
  );
  const reenabled = await setCatalogItemManageStock(
    { catalog, claims },
    { catalogItemId: "item-grill", manageStock: true },
  );

  assert.deepEqual(disabled.item.stockManagement, { mode: "unmanaged" });
  assert.equal(disabled.item.manageStockRevision, 1);
  assert.deepEqual(reenabled.item.stockManagement, {
    mode: "managed",
    status: "setup-required",
  });
  assert.equal(reenabled.item.manageStockRevision, 2);
  assert.equal(currentManageStockRevision(reenabled.item), 2);
  assert.equal(claims.records.size, 0);
});

test("idempotent disable still releases leftover claims", async () => {
  const catalog = new MemoryCollection([catalogItem()]);
  const claims = claimStorage([registrationClaim()]);

  const result = await setCatalogItemManageStock(
    { catalog, claims },
    { catalogItemId: "item-grill", manageStock: false },
  );

  assert.equal(result.changed, false);
  assert.equal(catalog.puts.length, 0);
  assert.equal(claims.records.size, 0);
});

test("Manage Stock input is strict and isolated from other collections", async () => {
  const catalog = new MemoryCollection([catalogItem()]);
  const claims = claimStorage();

  for (const input of [
    { catalogItemId: "item-grill", manageStock: true, sku: "BROWSER-SKU" },
    { catalogItemId: "item-grill" },
    { manageStock: true },
    { catalogItemId: "item-grill", manageStock: "true" },
  ]) {
    await assert.rejects(
      setCatalogItemManageStock({ catalog, claims }, input),
      (error) => error instanceof CatalogError && error.code === "INVALID_INPUT",
    );
  }
  await assert.rejects(
    setCatalogItemManageStock({ catalog, claims }, { catalogItemId: "missing", manageStock: true }),
    (error) => error instanceof CatalogError && error.code === "CATALOG_ITEM_NOT_FOUND",
  );
  assert.equal(catalog.puts.length, 0);
});

test("the plugin exposes one private permissioned Manage Stock action", async () => {
  const plugin = createPlugin();
  const route = plugin.routes[SET_CATALOG_ITEM_MANAGE_STOCK_ROUTE];
  const catalog = new MemoryCollection([catalogItem()]);
  const claims = claimStorage();
  const storage = {
    catalogItems: catalog,
    [MANAGED_SKU_REGISTRATION_CLAIMS_COLLECTION]: claims,
    [CATALOG_BACKORDER_POLICIES_COLLECTION]: new MemoryCollection(),
    [CATALOG_MANUAL_AVAILABILITY_COLLECTION]: new MemoryCollection(),
  };

  assert.equal(SET_CATALOG_ITEM_MANAGE_STOCK_ROUTE, "catalog-items/set-manage-stock");
  assert.equal(route.public, undefined);
  assert.equal(route.permission, "content:edit_any");
  await assert.rejects(
    route.handler({
      input: { catalogItemId: "item-grill", manageStock: true },
      storage,
      request: new Request("https://example.test/set-manage-stock", { method: "GET" }),
    }),
    (error) => error instanceof PluginRouteError && error.status === 405,
  );

  const enabled = await route.handler({
    input: { catalogItemId: "item-grill", manageStock: true },
    storage,
    request: new Request("https://example.test/set-manage-stock", { method: "POST" }),
  });
  assert.equal(enabled.item.stockManagement.mode, "managed");
  assert.equal(enabled.item.manageStockRevision, 1);

  const disabled = await route.handler({
    input: { catalogItemId: "item-grill", manageStock: false },
    storage,
    request: new Request("https://example.test/set-manage-stock", { method: "POST" }),
  });
  assert.deepEqual(disabled.item.stockManagement, { mode: "unmanaged" });
  assert.equal(disabled.item.manageStockRevision, 1);
});
