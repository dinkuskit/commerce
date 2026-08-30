import assert from "node:assert/strict";
import test from "node:test";
import { PluginRouteError } from "emdash";

import {
  CONFIGURE_INVENTORY_ROUTE,
  STORE_INVENTORY_CONFIGURATIONS_COLLECTION,
  InventorySetupError,
  configureCatalogItemInventory,
  createPlugin,
  createStoreInventoryConfiguration,
  managedSkuRegistrationClaimUniqueIndexName,
  storeInventoryConfigurationUniqueIndexName,
} from "../../../dist/index.js";

const binding = {
  providerRef: "dinkuskit.inventory",
  poolId: "pool-smoky",
  defaultFulfillmentLocationId: "murphy-nc",
};

function uniqueViolation(indexName) {
  const error = new Error(`UNIQUE constraint failed: index '${indexName}'`);
  error.code = "SQLITE_CONSTRAINT_UNIQUE";
  return error;
}

class MemoryCollection {
  constructor(uniqueIndexes = {}) {
    this.uniqueIndexes = uniqueIndexes;
    this.records = new Map();
    this.puts = [];
    this.queries = [];
  }

  async get(id) {
    const value = this.records.get(id);
    return value === undefined ? null : structuredClone(value);
  }

  async put(id, data) {
    for (const [field, indexName] of Object.entries(this.uniqueIndexes)) {
      const collision = [...this.records.entries()].find(
        ([otherId, record]) => otherId !== id && record[field] === data[field],
      );
      if (collision) throw uniqueViolation(indexName);
    }
    this.records.set(id, structuredClone(data));
    this.puts.push({ id, data: structuredClone(data) });
  }

  async delete(id) {
    return this.records.delete(id);
  }

  async query(options = {}) {
    this.queries.push(structuredClone(options));
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

function configurationStorage() {
  return new MemoryCollection({
    configurationKey: storeInventoryConfigurationUniqueIndexName("configurationKey"),
  });
}

function claimStorage() {
  return new MemoryCollection({
    claimKey: managedSkuRegistrationClaimUniqueIndexName("claimKey"),
    operationId: managedSkuRegistrationClaimUniqueIndexName("operationId"),
  });
}

function managedItem(overrides = {}) {
  return {
    recordKind: "catalog-item",
    itemId: "item-grill",
    commandId: "catalog:create:grill",
    creationIntent: { manageStock: true },
    kind: "simple-product",
    name: "Smoky Grill",
    sku: "SMOKY-GRILL",
    skuKey: "SMOKY-GRILL",
    stockManagement: { mode: "managed", status: "setup-required" },
    state: "draft",
    createdAt: "2026-08-30T00:00:00.000Z",
    ...overrides,
  };
}

function configurationOptions(overrides = {}) {
  return {
    createRecordId: () => "store-inventory-configuration-record",
    createSiteId: () => "site-smokyclub-permanent",
    now: () => new Date("2026-08-30T01:00:00.000Z"),
    ...overrides,
  };
}

async function configuredStore(storage, selectedBinding = binding) {
  return createStoreInventoryConfiguration(
    storage,
    selectedBinding,
    configurationOptions(),
  );
}

function setupExecution(overrides = {}) {
  return {
    createClaimRecordId: () => "managed-sku-claim-record",
    createOperationId: () => "inventory-operation-grill",
    now: () => new Date("2026-08-30T02:00:00.000Z"),
    ...overrides,
  };
}

test("one store configuration atomically mints and preserves one permanent site identity", async () => {
  const storage = configurationStorage();
  let siteIdsCreated = 0;
  const first = await createStoreInventoryConfiguration(storage, binding, {
    ...configurationOptions(),
    createSiteId: () => `site-${++siteIdsCreated}`,
  });
  const replay = await createStoreInventoryConfiguration(storage, binding, {
    ...configurationOptions(),
    createRecordId: () => "must-not-be-used",
    createSiteId: () => `site-${++siteIdsCreated}`,
  });

  assert.equal(first.outcome, "created");
  assert.equal(replay.outcome, "existing");
  assert.equal(siteIdsCreated, 1);
  assert.deepEqual(replay.configuration, first.configuration);
  assert.deepEqual(first.configuration, {
    recordKind: "store-inventory-configuration",
    recordId: "store-inventory-configuration-record",
    configurationKey: "active",
    siteId: "site-1",
    binding,
    configuredAt: "2026-08-30T01:00:00.000Z",
    updatedAt: "2026-08-30T01:00:00.000Z",
  });
});

test("simultaneous first configuration converges on one site identity", async () => {
  const storage = configurationStorage();
  const [left, right] = await Promise.all([
    createStoreInventoryConfiguration(storage, binding, {
      ...configurationOptions(),
      createRecordId: () => "configuration-left",
      createSiteId: () => "site-left",
    }),
    createStoreInventoryConfiguration(storage, binding, {
      ...configurationOptions(),
      createRecordId: () => "configuration-right",
      createSiteId: () => "site-right",
    }),
  ]);

  assert.equal([left, right].filter(({ outcome }) => outcome === "created").length, 1);
  assert.equal([left, right].filter(({ outcome }) => outcome === "existing").length, 1);
  assert.equal(left.configuration.siteId, right.configuration.siteId);
  assert.equal(
    [...storage.records.values()].filter(
      ({ recordKind }) => recordKind === "store-inventory-configuration",
    ).length,
    1,
  );
});

test("location changes retain site identity while provider or pool changes require migration", async () => {
  const storage = configurationStorage();
  const created = await configuredStore(storage);
  const locationUpdate = await createStoreInventoryConfiguration(
    storage,
    { ...binding, defaultFulfillmentLocationId: "asheville-nc" },
    {
      ...configurationOptions(),
      createSiteId: () => "must-not-be-used",
      now: () => new Date("2026-08-30T03:00:00.000Z"),
    },
  );
  const poolChange = await createStoreInventoryConfiguration(
    storage,
    { ...binding, poolId: "pool-beans" },
    configurationOptions(),
  );

  assert.equal(locationUpdate.outcome, "location-updated");
  assert.equal(locationUpdate.configuration.siteId, created.configuration.siteId);
  assert.equal(
    locationUpdate.configuration.binding.defaultFulfillmentLocationId,
    "asheville-nc",
  );
  assert.equal(poolChange.outcome, "migration-required");
  assert.deepEqual(poolChange.configuration, locationUpdate.configuration);
});

test("configuration rejects caller-supplied site identity and malformed binding data", async () => {
  const storage = configurationStorage();
  await assert.rejects(
    createStoreInventoryConfiguration(
      storage,
      { ...binding, siteId: "browser-chosen-site" },
      configurationOptions(),
    ),
    (error) =>
      error instanceof InventorySetupError && error.code === "INVALID_CONFIGURATION",
  );
  assert.equal(storage.records.size, 0);
});

test("missing store setup returns a structured setup action without claims or provider contact", async () => {
  const catalog = new MemoryCollection();
  const configurations = configurationStorage();
  const claims = claimStorage();
  catalog.records.set("item-grill", managedItem());
  let providerResolutions = 0;

  const result = await configureCatalogItemInventory(
    { catalog, configurations, claims },
    { catalogItemId: "item-grill" },
    setupExecution({
      resolveProvider: async () => {
        providerResolutions += 1;
        throw new Error("must not resolve");
      },
    }),
  );

  assert.deepEqual(result, {
    outcome: "inventory-setup-required",
    catalogItemId: "item-grill",
    actionLabel: "Configure Inventory",
  });
  assert.equal(providerResolutions, 0);
  assert.equal(claims.records.size, 0);
  assert.equal(catalog.puts.length, 0);
});

test("incomplete stored setup returns the same setup action without side effects", async () => {
  const catalog = new MemoryCollection();
  const configurations = configurationStorage();
  const claims = claimStorage();
  catalog.records.set("item-grill", managedItem());
  configurations.records.set("incomplete-configuration", {
    recordKind: "store-inventory-configuration",
    recordId: "incomplete-configuration",
    configurationKey: "active",
    binding,
    configuredAt: "2026-08-30T01:00:00.000Z",
    updatedAt: "2026-08-30T01:00:00.000Z",
  });
  let providerResolutions = 0;

  const result = await configureCatalogItemInventory(
    { catalog, configurations, claims },
    { catalogItemId: "item-grill" },
    setupExecution({
      resolveProvider: async () => {
        providerResolutions += 1;
        throw new Error("must not resolve");
      },
    }),
  );

  assert.deepEqual(result, {
    outcome: "inventory-setup-required",
    catalogItemId: "item-grill",
    actionLabel: "Configure Inventory",
  });
  assert.equal(providerResolutions, 0);
  assert.equal(claims.records.size, 0);
  assert.equal(catalog.puts.length, 0);
});

test("the product action accepts only catalogItemId and rejects missing or unmanaged products", async () => {
  const catalog = new MemoryCollection();
  const configurations = configurationStorage();
  const claims = claimStorage();
  await configuredStore(configurations);
  catalog.records.set(
    "item-unmanaged",
    managedItem({
      itemId: "item-unmanaged",
      creationIntent: { manageStock: false },
      stockManagement: { mode: "unmanaged" },
    }),
  );

  for (const input of [
    { catalogItemId: "item-unmanaged", poolId: "browser-pool" },
    { catalogItemId: "item-unmanaged", siteId: "browser-site" },
    { catalogItemId: "item-unmanaged", sku: "BROWSER-SKU" },
  ]) {
    await assert.rejects(
      configureCatalogItemInventory(
        { catalog, configurations, claims },
        input,
        setupExecution(),
      ),
      (error) => error instanceof InventorySetupError && error.code === "INVALID_INPUT",
    );
  }

  await assert.rejects(
    configureCatalogItemInventory(
      { catalog, configurations, claims },
      { catalogItemId: "missing" },
      setupExecution(),
    ),
    (error) => error instanceof InventorySetupError && error.code === "CATALOG_ITEM_NOT_FOUND",
  );
  await assert.rejects(
    configureCatalogItemInventory(
      { catalog, configurations, claims },
      { catalogItemId: "item-unmanaged" },
      setupExecution(),
    ),
    (error) => error instanceof InventorySetupError && error.code === "MANAGE_STOCK_REQUIRED",
  );
  assert.equal(claims.records.size, 0);
});

test("complete setup resolves the provider with the permanent site identity and activates the SKU", async () => {
  const catalog = new MemoryCollection();
  const configurations = configurationStorage();
  const claims = claimStorage();
  catalog.records.set("item-grill", managedItem());
  const configured = await configuredStore(configurations);
  const providerCalls = [];
  const seenConfigurations = [];

  const result = await configureCatalogItemInventory(
    { catalog, configurations, claims },
    { catalogItemId: "item-grill" },
    setupExecution({
      resolveProvider: async (configuration) => {
        seenConfigurations.push(structuredClone(configuration));
        return {
          async registerManagedSku(registration) {
            providerCalls.push(structuredClone(registration));
            return {
              outcome: "registered",
              inventorySku: {
                inventorySkuId: "inventory-sku-grill",
                sku: registration.request.sku,
                displayName: registration.request.displayNameIfNew,
              },
            };
          },
        };
      },
    }),
  );

  assert.equal(result.outcome, "inventory-active");
  assert.equal(result.poolId, "pool-smoky");
  assert.deepEqual(result.item.stockManagement, {
    mode: "managed",
    status: "active",
    inventorySkuId: "inventory-sku-grill",
  });
  assert.equal(seenConfigurations[0].siteId, configured.configuration.siteId);
  assert.deepEqual(providerCalls, [
    {
      operationId: "inventory-operation-grill",
      request: {
        poolId: "pool-smoky",
        sku: "SMOKY-GRILL",
        displayNameIfNew: "Smoky Grill",
      },
    },
  ]);
  assert.deepEqual(
    catalog.records.get("item-grill").stockManagement,
    result.item.stockManagement,
  );
});

test("existing, pending, and active states never start a second registration", async () => {
  const configurations = configurationStorage();
  await configuredStore(configurations);
  for (const [status, stockManagement, expectedOutcome] of [
    [
      "pending",
      {
        mode: "managed",
        status: "setup-pending",
        registration: {
          operationId: "operation-existing",
          request: {
            poolId: "pool-smoky",
            sku: "SMOKY-GRILL",
            displayNameIfNew: "Smoky Grill",
          },
        },
      },
      "registration-pending",
    ],
    [
      "review",
      {
        mode: "managed",
        status: "needs-review",
        candidate: {
          inventorySkuId: "inventory-existing",
          sku: "SMOKY-GRILL",
          displayName: "Existing Grill",
        },
      },
      "existing-sku-review-required",
    ],
    [
      "active",
      {
        mode: "managed",
        status: "active",
        inventorySkuId: "inventory-active",
      },
      "inventory-active",
    ],
  ]) {
    const catalog = new MemoryCollection();
    const claims = claimStorage();
    catalog.records.set("item-grill", managedItem({ stockManagement }));
    let providerResolutions = 0;
    const result = await configureCatalogItemInventory(
      { catalog, configurations, claims },
      { catalogItemId: "item-grill" },
      setupExecution({
        resolveProvider: async () => {
          providerResolutions += 1;
          throw new Error("must not resolve");
        },
      }),
    );

    assert.equal(result.outcome, expectedOutcome, status);
    assert.equal(providerResolutions, 0, status);
    assert.equal(claims.records.size, 0, status);
  }
});

test("a configured product fails before a claim when no runtime provider is installed", async () => {
  const catalog = new MemoryCollection();
  const configurations = configurationStorage();
  const claims = claimStorage();
  catalog.records.set("item-grill", managedItem());
  await configuredStore(configurations);

  await assert.rejects(
    configureCatalogItemInventory(
      { catalog, configurations, claims },
      { catalogItemId: "item-grill" },
      setupExecution(),
    ),
    (error) =>
      error instanceof InventorySetupError && error.code === "PROVIDER_UNAVAILABLE",
  );
  assert.equal(claims.records.size, 0);
  assert.equal(catalog.puts.length, 0);
});

test("the plugin declares the singleton configuration and one private update route", async () => {
  const catalog = new MemoryCollection();
  const configurations = configurationStorage();
  const claims = claimStorage();
  catalog.records.set("item-grill", managedItem());
  await configuredStore(configurations);
  const plugin = createPlugin({
    inventorySetup: setupExecution({
      resolveProvider: async () => ({
        async registerManagedSku(registration) {
          return {
            outcome: "registered",
            inventorySku: {
              inventorySkuId: "inventory-route-grill",
              sku: registration.request.sku,
              displayName: registration.request.displayNameIfNew,
            },
          };
        },
      }),
    }),
  });

  assert.deepEqual(plugin.storage[STORE_INVENTORY_CONFIGURATIONS_COLLECTION], {
    indexes: [],
    uniqueIndexes: ["configurationKey"],
  });
  const route = plugin.routes[CONFIGURE_INVENTORY_ROUTE];
  assert.equal(route.public, undefined);
  assert.equal(route.permission, "content:edit_any");

  const context = {
    input: { catalogItemId: "item-grill" },
    storage: {
      catalogItems: catalog,
      storeInventoryConfigurations: configurations,
      managedSkuClaims: claims,
    },
  };
  await assert.rejects(
    route.handler({
      ...context,
      request: new Request("https://smokyclub.test/configure-inventory", { method: "GET" }),
    }),
    (error) =>
      error instanceof PluginRouteError &&
      error.code === "METHOD_NOT_ALLOWED" &&
      error.status === 405,
  );

  const result = await route.handler({
    ...context,
    request: new Request("https://smokyclub.test/configure-inventory", { method: "POST" }),
  });
  assert.equal(result.outcome, "inventory-active");
});
