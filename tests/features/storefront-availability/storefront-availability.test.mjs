import assert from "node:assert/strict";
import test from "node:test";
import { PluginRouteError } from "emdash";

import {
  CatalogError,
  StorefrontAvailabilityError,
  SET_CATALOG_ITEM_BACKORDERS_ROUTE,
  SET_STOREFRONT_AVAILABILITY_POLICY_ROUTE,
  STOREFRONT_AVAILABILITY_RESULT_SCHEMA,
  createPlugin,
  resolveManagedStorefrontAvailability,
  resolveStorefrontAvailability,
  setManageStock,
  setCatalogItemBackorders,
  setStorefrontAvailabilityPolicy,
} from "../../../dist/index.js";

class MemoryCollection {
  constructor(records = []) {
    this.records = new Map(records.map((record) => [record.recordId ?? record.itemId, structuredClone(record)]));
    this.puts = [];
    this.gets = [];
    this.queries = [];
  }

  async get(id) {
    this.gets.push(id);
    const record = this.records.get(id);
    return record === undefined ? null : structuredClone(record);
  }

  async put(id, record) {
    this.records.set(id, structuredClone(record));
    this.puts.push({ id, record: structuredClone(record) });
  }

  async query(options = {}) {
    this.queries.push(structuredClone(options));
    const records = [...this.records.entries()].filter(([, record]) =>
      Object.entries(options.where ?? {}).every(([field, value]) => record[field] === value),
    );
    const limit = options.limit ?? 50;
    return {
      items: records.slice(0, limit).map(([id, data]) => ({ id, data: structuredClone(data) })),
      hasMore: records.length > limit,
    };
  }
}

function catalogItem(overrides = {}) {
  return {
    recordKind: "catalog-item",
    itemId: "item-grill",
    commandId: "catalog:create:grill",
    creationIntent: { manageStock: true },
    kind: "simple-product",
    name: "Smoky Grill",
    sku: "SMOKY-GRILL",
    skuKey: "SMOKY-GRILL",
    stockManagement: {
      mode: "managed",
      status: "active",
      inventorySkuId: "inventory-sku-grill",
    },
    state: "draft",
    createdAt: "2026-08-30T00:00:00.000Z",
    ...overrides,
  };
}

function storeConfiguration(overrides = {}) {
  return {
    recordKind: "store-inventory-configuration",
    recordId: "store-configuration",
    configurationKey: "active",
    siteId: "site-smokyclub",
    binding: {
      providerRef: "dinkuskit.inventory",
      poolId: "pool-smoky",
      defaultFulfillmentLocationId: "murphy-nc",
    },
    configuredAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    ...overrides,
  };
}

function backorderPolicy(allowBackorders = false) {
  return {
    recordKind: "catalog-backorder-policy",
    recordId: "item-grill",
    catalogItemId: "item-grill",
    allowBackorders,
  };
}

function availabilitySettings(policy = { mode: "status" }) {
  return {
    recordKind: "storefront-availability-settings",
    recordId: "active",
    policy,
    updatedAt: "2026-08-30T00:00:00.000Z",
  };
}

function manualAvailabilityRecord(status) {
  return {
    recordKind: "catalog-manual-availability",
    recordId: "item-grill",
    catalogItemId: "item-grill",
    status,
  };
}

function foundStock(value, input, unit = "each") {
  const zero = { value: "0", unit };
  return {
    schema: "dinkuskit.inventory.sku-stock-read-result/v1",
    outcome: "found",
    poolId: input.poolId,
    skuId: input.skuId,
    scope: input.scope,
    stock: {
      onHand: { value, unit },
      reserved: zero,
      outgoingTransferCommitted: zero,
      available: { value, unit },
      expected: zero,
      inTransit: zero,
    },
    locations: [
      {
        locationId: input.scope.locationId,
        name: "Murphy, NC",
        stock: {
          onHand: { value, unit },
          reserved: zero,
          outgoingTransferCommitted: zero,
          available: { value, unit },
          expected: zero,
          inTransit: zero,
        },
      },
    ],
  };
}

async function resolve({
  item = catalogItem(),
  configuration = storeConfiguration(),
  policy,
  allowBackorders,
  read,
}) {
  const catalog = new MemoryCollection([item]);
  const configurations = new MemoryCollection([configuration]);
  const settings = new MemoryCollection(
    policy === undefined ? [] : [availabilitySettings(policy)],
  );
  const backorderPolicies = new MemoryCollection(
    allowBackorders === undefined ? [] : [backorderPolicy(allowBackorders)],
  );
  const reads = [];
  const result = await resolveManagedStorefrontAvailability(
    { backorderPolicies, catalog, configurations, settings },
    { catalogItemId: item.itemId },
    {
      resolveProvider: async () => ({
        readSkuStock: async (input) => {
          reads.push(structuredClone(input));
          return read(input);
        },
      }),
    },
  );
  return { result, reads };
}

test("status-only availability uses Inventory available at the default fulfillment location", async () => {
  const { result, reads } = await resolve({ read: (input) => foundStock("8", input) });

  assert.deepEqual(reads, [
    {
      poolId: "pool-smoky",
      skuId: "inventory-sku-grill",
      scope: { kind: "location", locationId: "murphy-nc" },
    },
  ]);
  assert.deepEqual(result, {
    schema: STOREFRONT_AVAILABILITY_RESULT_SCHEMA,
    catalogItemId: "item-grill",
    status: "in-stock",
    sellable: true,
  });
});

test("exact and threshold policies expose quantity only when the policy permits it", async () => {
  const exact = await resolve({
    policy: { mode: "exact" },
    read: (input) => foundStock("8", input),
  });
  const low = await resolve({
    policy: { mode: "threshold", threshold: 5 },
    read: (input) => foundStock("5", input),
  });
  const above = await resolve({
    policy: { mode: "threshold", threshold: 5 },
    read: (input) => foundStock("5.5", input),
  });

  assert.deepEqual(exact.result, {
    schema: STOREFRONT_AVAILABILITY_RESULT_SCHEMA,
    catalogItemId: "item-grill",
    status: "in-stock",
    sellable: true,
    displayQuantity: { value: "8", unit: "each" },
  });
  assert.deepEqual(low.result, {
    schema: STOREFRONT_AVAILABILITY_RESULT_SCHEMA,
    catalogItemId: "item-grill",
    status: "low-stock",
    sellable: true,
    displayQuantity: { value: "5", unit: "each" },
  });
  assert.deepEqual(above.result, {
    schema: STOREFRONT_AVAILABILITY_RESULT_SCHEMA,
    catalogItemId: "item-grill",
    status: "in-stock",
    sellable: true,
  });
});

test("zero stock is out of stock unless the product deliberately allows backorders", async () => {
  const unavailable = await resolve({ read: (input) => foundStock("0", input) });
  const backorder = await resolve({
    allowBackorders: true,
    read: (input) => foundStock("0", input),
  });

  assert.equal(unavailable.result.status, "out-of-stock");
  assert.equal(unavailable.result.sellable, false);
  assert.equal(backorder.result.status, "available-on-backorder");
  assert.equal(backorder.result.sellable, true);
  assert.equal("displayQuantity" in backorder.result, false);
});

test("non-active managed setup fails closed without contacting Inventory", async () => {
  let providerResolved = false;
  const catalog = new MemoryCollection([
    catalogItem({ stockManagement: { mode: "managed", status: "setup-pending" } }),
  ]);
  const configurations = new MemoryCollection([storeConfiguration()]);
  const settings = new MemoryCollection();
  const backorderPolicies = new MemoryCollection();

  const result = await resolveManagedStorefrontAvailability(
    { backorderPolicies, catalog, configurations, settings },
    { catalogItemId: "item-grill" },
    {
      resolveProvider: async () => {
        providerResolved = true;
        throw new Error("must not resolve provider");
      },
    },
  );

  assert.equal(providerResolved, false);
  assert.deepEqual(result, {
    schema: STOREFRONT_AVAILABILITY_RESULT_SCHEMA,
    catalogItemId: "item-grill",
    status: "availability-unavailable",
    sellable: false,
  });
});

test("provider failure, not-found, and malformed stock all fail closed even for backorders", async () => {
  const cases = [
    async () => {
      throw new Error("provider is down");
    },
    async (input) => ({
      schema: "dinkuskit.inventory.sku-stock-read-result/v1",
      outcome: "not_found",
      poolId: input.poolId,
      skuId: input.skuId,
      scope: input.scope,
    }),
    async (input) => foundStock("not-a-quantity", input),
    async (input) => ({ ...foundStock("3", input), poolId: "wrong-pool" }),
    async (input) => ({
      ...foundStock("3", input),
      scope: { kind: "location", locationId: "wrong-location" },
    }),
    async (input) => ({ ...foundStock("3", input), locations: [] }),
    async (input) => {
      const result = foundStock("3", input);
      result.locations[0].stock.available = { value: "2", unit: "each" };
      return result;
    },
    async (input) => {
      const result = foundStock("3", input);
      result.stock.expected = { value: "invalid", unit: "each" };
      return result;
    },
  ];

  for (const read of cases) {
    const { result } = await resolve({
      allowBackorders: true,
      read,
    });
    assert.equal(result.status, "availability-unavailable");
    assert.equal(result.sellable, false);
    assert.equal("displayQuantity" in result, false);
  }
});

test("unmanaged products map all three manual states without contacting Inventory", async () => {
  const cases = [
    ["in-stock", true],
    ["out-of-stock", false],
    ["available-on-backorder", true],
  ];

  for (const [status, sellable] of cases) {
    const catalog = new MemoryCollection([
      catalogItem({
        creationIntent: { manageStock: false },
        stockManagement: { mode: "unmanaged" },
      }),
    ]);
    const manualAvailability = new MemoryCollection([
      manualAvailabilityRecord(status),
    ]);
    const configurations = new MemoryCollection([storeConfiguration()]);
    const settings = new MemoryCollection([
      availabilitySettings({ mode: "exact" }),
    ]);
    const backorderPolicies = new MemoryCollection([backorderPolicy(true)]);
    let providerResolved = false;

    const result = await resolveStorefrontAvailability(
      {
        backorderPolicies,
        catalog,
        configurations,
        manualAvailability,
        settings,
      },
      { catalogItemId: "item-grill" },
      {
        resolveProvider: async () => {
          providerResolved = true;
          throw new Error("must not resolve Inventory for unmanaged products");
        },
      },
    );

    assert.deepEqual(result, {
      schema: STOREFRONT_AVAILABILITY_RESULT_SCHEMA,
      catalogItemId: "item-grill",
      status,
      sellable,
    });
    assert.equal(providerResolved, false);
    assert.deepEqual(configurations.gets, []);
    assert.deepEqual(settings.gets, []);
    assert.deepEqual(backorderPolicies.gets, []);
    assert.deepEqual(manualAvailability.gets, ["item-grill"]);
    assert.equal("displayQuantity" in result, false);
  }
});

test("missing unmanaged state defaults to In stock and ignores exact or threshold display policy", async () => {
  for (const policy of [
    { mode: "exact" },
    { mode: "threshold", threshold: 5 },
  ]) {
    const catalog = new MemoryCollection([
      catalogItem({
        creationIntent: { manageStock: false },
        stockManagement: { mode: "unmanaged" },
      }),
    ]);
    const manualAvailability = new MemoryCollection();
    const settings = new MemoryCollection([availabilitySettings(policy)]);
    const result = await resolveStorefrontAvailability(
      {
        backorderPolicies: new MemoryCollection([backorderPolicy(true)]),
        catalog,
        configurations: new MemoryCollection([storeConfiguration()]),
        manualAvailability,
        settings,
      },
      { catalogItemId: "item-grill" },
    );

    assert.deepEqual(result, {
      schema: STOREFRONT_AVAILABILITY_RESULT_SCHEMA,
      catalogItemId: "item-grill",
      status: "in-stock",
      sellable: true,
    });
    assert.deepEqual(settings.gets, []);
    assert.equal(manualAvailability.puts.length, 0);
  }
});

test("a dormant manual state returns after Manage Stock is disabled", async () => {
  const active = {
    mode: "managed",
    status: "active",
    inventorySkuId: "inventory-sku-grill",
  };
  const catalog = new MemoryCollection([
    catalogItem({ stockManagement: { mode: "unmanaged" } }),
  ]);
  const manualAvailability = new MemoryCollection([
    manualAvailabilityRecord("out-of-stock"),
  ]);
  const storage = {
    backorderPolicies: new MemoryCollection(),
    catalog,
    configurations: new MemoryCollection([storeConfiguration()]),
    manualAvailability,
    settings: new MemoryCollection(),
  };
  let inventoryReads = 0;
  const execution = {
    resolveProvider: async () => ({
      readSkuStock: async (input) => {
        inventoryReads += 1;
        return foundStock("7", input);
      },
    }),
  };

  const before = await resolveStorefrontAvailability(
    storage,
    { catalogItemId: "item-grill" },
    execution,
  );
  catalog.records.set("item-grill", catalogItem({ stockManagement: active }));
  const managed = await resolveStorefrontAvailability(
    storage,
    { catalogItemId: "item-grill" },
    execution,
  );
  catalog.records.set(
    "item-grill",
    catalogItem({ stockManagement: setManageStock(active, false) }),
  );
  const restored = await resolveStorefrontAvailability(
    storage,
    { catalogItemId: "item-grill" },
    execution,
  );

  assert.equal(before.status, "out-of-stock");
  assert.equal(managed.status, "in-stock");
  assert.equal(restored.status, "out-of-stock");
  assert.equal(inventoryReads, 1);
  assert.equal(manualAvailability.records.get("item-grill").status, "out-of-stock");
  assert.equal(manualAvailability.puts.length, 0);
});

test("manual storage failure fails closed for unmanaged products but is never read for managed products", async () => {
  const catalog = new MemoryCollection([
    catalogItem({ stockManagement: { mode: "unmanaged" } }),
  ]);
  const manualAvailability = new MemoryCollection();
  manualAvailability.get = async () => {
    throw new Error("manual storage unavailable");
  };
  const storage = {
    backorderPolicies: new MemoryCollection(),
    catalog,
    configurations: new MemoryCollection([storeConfiguration()]),
    manualAvailability,
    settings: new MemoryCollection(),
  };
  const execution = {
    resolveProvider: async () => ({
      readSkuStock: async (input) => foundStock("2", input),
    }),
  };

  const unmanaged = await resolveStorefrontAvailability(
    storage,
    { catalogItemId: "item-grill" },
    execution,
  );
  catalog.records.set(
    "item-grill",
    catalogItem({
      stockManagement: {
        mode: "managed",
        status: "active",
        inventorySkuId: "inventory-sku-grill",
      },
    }),
  );
  const managed = await resolveStorefrontAvailability(
    storage,
    { catalogItemId: "item-grill" },
    execution,
  );

  assert.deepEqual(unmanaged, {
    schema: STOREFRONT_AVAILABILITY_RESULT_SCHEMA,
    catalogItemId: "item-grill",
    status: "availability-unavailable",
    sellable: false,
  });
  assert.equal(managed.status, "in-stock");
  assert.equal(managed.sellable, true);
});

test("non-active managed setup never falls back to dormant manual availability", async () => {
  const manualAvailability = new MemoryCollection([
    manualAvailabilityRecord("available-on-backorder"),
  ]);
  let providerResolved = false;

  const result = await resolveStorefrontAvailability(
    {
      backorderPolicies: new MemoryCollection([backorderPolicy(true)]),
      catalog: new MemoryCollection([
        catalogItem({
          stockManagement: { mode: "managed", status: "setup-required" },
        }),
      ]),
      configurations: new MemoryCollection([storeConfiguration()]),
      manualAvailability,
      settings: new MemoryCollection(),
    },
    { catalogItemId: "item-grill" },
    {
      resolveProvider: async () => {
        providerResolved = true;
        throw new Error("must not resolve provider");
      },
    },
  );

  assert.deepEqual(result, {
    schema: STOREFRONT_AVAILABILITY_RESULT_SCHEMA,
    catalogItemId: "item-grill",
    status: "availability-unavailable",
    sellable: false,
  });
  assert.equal(providerResolved, false);
  assert.deepEqual(manualAvailability.gets, []);
});

test("the managed-only compatibility resolver still rejects unmanaged products", async () => {
  const catalog = new MemoryCollection([
    catalogItem({ stockManagement: { mode: "unmanaged" } }),
  ]);

  await assert.rejects(
    resolveManagedStorefrontAvailability(
      {
        backorderPolicies: new MemoryCollection(),
        catalog,
        configurations: new MemoryCollection(),
        settings: new MemoryCollection(),
      },
      { catalogItemId: "item-grill" },
      { resolveProvider: async () => null },
    ),
    (error) =>
      error instanceof StorefrontAvailabilityError &&
      error.code === "MANAGE_STOCK_REQUIRED",
  );
});

test("admin actions persist strict store display and product backorder settings", async () => {
  const catalog = new MemoryCollection([catalogItem()]);
  const configurations = new MemoryCollection([storeConfiguration()]);
  const settings = new MemoryCollection();
  const backorderPolicies = new MemoryCollection();

  const policy = await setStorefrontAvailabilityPolicy(
    settings,
    { mode: "threshold", threshold: 5 },
    { now: () => new Date("2026-08-30T03:00:00.000Z") },
  );
  const backorders = await setCatalogItemBackorders(
    { catalog, policies: backorderPolicies },
    { catalogItemId: "item-grill", allowBackorders: true },
  );

  assert.deepEqual(policy.settings.policy, {
    mode: "threshold",
    threshold: 5,
  });
  assert.equal(policy.settings.updatedAt, "2026-08-30T03:00:00.000Z");
  assert.equal(backorders.policy.allowBackorders, true);
  assert.equal(settings.puts.length, 1);
  assert.equal(backorderPolicies.puts.length, 1);
  assert.equal(configurations.puts.length, 0);
  assert.equal(catalog.puts.length, 0);
});

test("legacy persisted records normalize to safe status-only and no-backorder defaults", async () => {
  const legacyItem = catalogItem();
  const legacyConfiguration = storeConfiguration();

  const { result } = await resolve({
    item: legacyItem,
    configuration: legacyConfiguration,
    read: (input) => foundStock("4", input),
  });
  const catalog = new MemoryCollection([legacyItem]);
  const backorderPolicies = new MemoryCollection();
  const updated = await setCatalogItemBackorders(
    { catalog, policies: backorderPolicies },
    { catalogItemId: "item-grill", allowBackorders: false },
  );

  assert.deepEqual(result, {
    schema: STOREFRONT_AVAILABILITY_RESULT_SCHEMA,
    catalogItemId: "item-grill",
    status: "in-stock",
    sellable: true,
  });
  assert.equal(updated.changed, false);
  assert.equal(updated.policy.allowBackorders, false);
  assert.equal(backorderPolicies.puts.length, 0);
});

test("admin settings reject malformed values and caller-controlled fields", async () => {
  const catalog = new MemoryCollection([catalogItem()]);
  const settings = new MemoryCollection();
  const backorderPolicies = new MemoryCollection();
  for (const policy of [
    { mode: "threshold", threshold: 0 },
    { mode: "threshold", threshold: 1.5 },
    { mode: "threshold", threshold: "5" },
    { mode: "status", threshold: 5 },
    { mode: "hidden" },
  ]) {
    await assert.rejects(
      setStorefrontAvailabilityPolicy(settings, policy),
      (error) =>
        error instanceof StorefrontAvailabilityError && error.code === "INVALID_INPUT",
    );
  }
  for (const input of [
    { catalogItemId: "item-grill", allowBackorders: null },
    { catalogItemId: "item-grill", allowBackorders: true, sku: "OTHER" },
    { catalogItemId: "", allowBackorders: true },
  ]) {
    await assert.rejects(
      setCatalogItemBackorders({ catalog, policies: backorderPolicies }, input),
      (error) => error instanceof CatalogError && error.code === "INVALID_INPUT",
    );
  }
  assert.equal(settings.puts.length, 0);
  assert.equal(backorderPolicies.puts.length, 0);
  assert.equal(catalog.puts.length, 0);
});

test("the existing authenticated display and managed-backorder actions remain bounded", async () => {
  const plugin = createPlugin();
  const catalog = new MemoryCollection([catalogItem()]);
  const settings = new MemoryCollection();
  const backorderPolicies = new MemoryCollection();
  const backordersRoute = plugin.routes[SET_CATALOG_ITEM_BACKORDERS_ROUTE];
  const policyRoute = plugin.routes[SET_STOREFRONT_AVAILABILITY_POLICY_ROUTE];

  assert.equal(backordersRoute.public, undefined);
  assert.equal(backordersRoute.permission, "content:edit_any");
  assert.equal(policyRoute.public, undefined);
  assert.equal(policyRoute.permission, "content:edit_any");
  await assert.rejects(
    backordersRoute.handler({
      input: { catalogItemId: "item-grill", allowBackorders: true },
      storage: { catalogItems: catalog, catalogBackorderPolicies: backorderPolicies },
      request: new Request("https://example.test/set-backorders", { method: "GET" }),
    }),
    (error) => error instanceof PluginRouteError && error.status === 405,
  );
  await backordersRoute.handler({
    input: { catalogItemId: "item-grill", allowBackorders: true },
    storage: { catalogItems: catalog, catalogBackorderPolicies: backorderPolicies },
    request: new Request("https://example.test/set-backorders", { method: "POST" }),
  });
  await policyRoute.handler({
    input: { mode: "exact" },
    storage: { storefrontAvailabilitySettings: settings },
    request: new Request("https://example.test/storefront-availability", {
      method: "POST",
    }),
  });

  assert.equal(backorderPolicies.records.get("item-grill").allowBackorders, true);
  assert.deepEqual(settings.records.get("active").policy, { mode: "exact" });
  assert.equal(catalog.puts.length, 0);
});
