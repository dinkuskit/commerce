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
  setCatalogItemBackorders,
  setStorefrontAvailabilityPolicy,
} from "../../../dist/index.js";

class MemoryCollection {
  constructor(records = []) {
    this.records = new Map(records.map((record) => [record.recordId ?? record.itemId, structuredClone(record)]));
    this.puts = [];
    this.queries = [];
  }

  async get(id) {
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

test("the authenticated plugin actions expose only the two bounded setting mutations", async () => {
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
