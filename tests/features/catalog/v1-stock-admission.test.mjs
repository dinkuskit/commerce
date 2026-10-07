import assert from "node:assert/strict";
import test from "node:test";
import { PluginRouteError } from "emdash";

import { commerceAdmin } from "../../../dist/admin/index.js";
import {
  CatalogError,
  CREATE_CATALOG_ITEM_ROUTE,
  LIST_CATALOG_PRODUCTS_ROUTE,
  SAVE_CATALOG_PRODUCT_PRICES_ROUTE,
  MANAGE_STOCK_LOCKED_MESSAGE,
  MANAGE_STOCK_UNAVAILABLE_MESSAGE,
  isLocalStockManagementEnabled,
  readLocalStockAdmission,
  catalogUniqueIndexName,
  createManagedSkuRegistrationClaimKey,
  createPlugin,
  resolveStorefrontAvailability,
  saveCatalogProductPrices,
} from "../../../dist/index.js";

function uniqueViolation(field) {
  const error = new Error(
    `UNIQUE constraint failed: index '${catalogUniqueIndexName(field)}'`,
  );
  error.code = "SQLITE_CONSTRAINT_UNIQUE";
  return error;
}

class MemoryCatalogStorage {
  constructor(activeUniqueFields = ["commandId", "skuKey"]) {
    this.activeUniqueFields = new Set(activeUniqueFields);
    this.records = new Map();
  }

  async put(id, data) {
    for (const field of this.activeUniqueFields) {
      const collision = [...this.records.entries()].find(
        ([otherId, record]) => otherId !== id && record[field] === data[field],
      );
      if (collision) throw uniqueViolation(field);
    }
    this.records.set(id, structuredClone(data));
  }

  async delete(id) {
    return this.records.delete(id);
  }

  async query({ where, limit } = {}) {
    const items = [...this.records.entries()]
      .filter(([, data]) =>
        !where || Object.entries(where).every(([key, value]) => data[key] === value),
      )
      .map(([id, data]) => ({ id, data: structuredClone(data) }));
    return { items: items.slice(0, limit ?? items.length), hasMore: false };
  }
}

class MemoryCollection {
  constructor(records = []) {
    this.records = new Map(
      records.map((record) => [record.recordId ?? record.itemId, structuredClone(record)]),
    );
    this.revisions = new Map(
      [...this.records.keys()].map((id) => [id, crypto.randomUUID()]),
    );
    this.puts = [];
    this.deletes = [];
  }

  async get(id) {
    const record = this.records.get(id);
    return record === undefined ? null : structuredClone(record);
  }

  async getVersioned(id) {
    const record = this.records.get(id);
    if (record === undefined) return null;
    return { value: structuredClone(record), revision: this.revisions.get(id) };
  }

  async put(id, record) {
    this.records.set(id, structuredClone(record));
    this.revisions.set(id, crypto.randomUUID());
    this.puts.push(id);
  }

  async compareAndSet(id, expectedRevision, record) {
    if (expectedRevision === null) {
      if (this.records.has(id)) return { applied: false };
      this.records.set(id, structuredClone(record));
      this.revisions.set(id, crypto.randomUUID());
      this.puts.push(id);
      return { applied: true };
    }
    if (this.revisions.get(id) !== expectedRevision) return { applied: false };
    this.records.set(id, structuredClone(record));
    this.revisions.set(id, crypto.randomUUID());
    this.puts.push(id);
    return { applied: true };
  }

  async compareAndDelete(id, expectedRevision) {
    if (this.revisions.get(id) !== expectedRevision) return { applied: false };
    this.deletes.push(id);
    this.records.delete(id);
    this.revisions.delete(id);
    return { applied: true };
  }

  async query({ where, limit } = {}) {
    let items = [...this.records.entries()].map(([id, data]) => ({
      id,
      data: structuredClone(data),
    }));
    if (where && typeof where === "object") {
      items = items.filter(({ data }) =>
        Object.entries(where).every(([key, value]) => data[key] === value),
      );
    }
    return { items: typeof limit === "number" ? items.slice(0, limit) : items, hasMore: false };
  }
}

function item(overrides = {}) {
  return {
    recordKind: "catalog-item",
    itemId: "item-bag",
    commandId: "catalog:create:bag",
    creationIntent: { manageStock: false },
    kind: "simple-product",
    name: "Bag",
    sku: "BAG-1",
    skuKey: "BAG-1",
    stockManagement: { mode: "unmanaged" },
    state: "draft",
    createdAt: "2026-09-26T00:00:00.000Z",
    ...overrides,
  };
}

function managedItem() {
  return item({
    creationIntent: { manageStock: true },
    stockManagement: { mode: "managed", status: "setup-required" },
  });
}

function claimRecord() {
  return {
    recordKind: "managed-sku-registration-claim",
    recordId: "claim-1",
    claimKey: createManagedSkuRegistrationClaimKey({ catalogItemId: "item-bag" }),
    catalogItemId: "item-bag",
    operationId: "op-1",
    request: { poolId: "pool-1", sku: "BAG-1", displayNameIfNew: "Bag" },
    createdAt: "2026-09-26T00:00:00.000Z",
  };
}

function bindingRecord() {
  return {
    recordKind: "store-inventory-configuration",
    recordId: "active",
    configurationKey: "active",
    siteId: "site-1",
    binding: {
      providerRef: "inventory:legacy",
      poolId: "pool-1",
      defaultFulfillmentLocationId: "loc-1",
    },
    configuredAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
  };
}

function stores(records = [item()]) {
  return {
    catalog: new MemoryCollection(records),
    prices: new MemoryCollection(),
    availability: new MemoryCollection(),
    claims: new MemoryCollection(),
    configurations: new MemoryCollection(),
  };
}

function nativeContext(store, extras = {}) {
  return {
    storage: {
      catalogItems: store.catalog,
      catalogPrices: store.prices,
      catalogManualAvailability: store.availability,
      managedSkuClaims: store.claims,
      storeInventoryConfigurations: store.configurations,
    },
    ...extras,
  };
}

function loopbackRequest(path = "/catalog") {
  return new Request("http://127.0.0.1" + path, { method: "POST" });
}

function productionRequest(path = "/catalog") {
  return new Request("https://shop.example.com" + path, { method: "POST" });
}

function sandboxContext(store) {
  return {
    storage: {
      catalog_items: store.catalog,
      catalog_prices: store.prices,
      catalog_manual_availability: store.availability,
      managed_sku_claims: store.claims,
      storefront_out_of_stock_listing: new MemoryCollection(),
      catalog_media: new MemoryCollection(),
      storefront_placeholder_image: new MemoryCollection(),
    },
  };
}

function snapshot(store) {
  return {
    catalog: structuredClone([...store.catalog.records.values()]),
    prices: structuredClone([...store.prices.records.values()]),
    availability: structuredClone([...store.availability.records.values()]),
    claims: structuredClone([...store.claims.records.values()]),
    configurations: structuredClone([...store.configurations.records.values()]),
    catalogPuts: store.catalog.puts.length,
    pricePuts: store.prices.puts.length,
    claimDeletes: store.claims.deletes.length,
  };
}

function flatten(blocks, texts = []) {
  for (const block of blocks ?? []) {
    if (typeof block?.text === "string") texts.push(block.text);
    if (typeof block?.label === "string") texts.push(block.label);
    if (typeof block?.title === "string") texts.push(block.title);
    if (Array.isArray(block?.fields)) flatten(block.fields, texts);
    if (Array.isArray(block?.elements)) flatten(block.elements, texts);
    if (Array.isArray(block?.blocks)) flatten(block.blocks, texts);
  }
  return texts;
}

function hasWorkingManageStock(blocks) {
  return (blocks ?? []).some((block) => {
    if (block?.type === "form") {
      return (block.fields ?? []).some(
        (field) => field.action_id === "manageStock" && (field.type === "toggle" || field.type === "checkbox"),
      );
    }
    return false;
  });
}

test("local-dev admission requires the host option and loopback site/request context", () => {
  assert.equal(
    isLocalStockManagementEnabled({
      hostEnableLocalStockManagement: true,
      requestUrl: "http://127.0.0.1:4321/save",
      siteUrl: "http://localhost:4321",
    }),
    true,
  );
  assert.equal(
    isLocalStockManagementEnabled({
      hostEnableLocalStockManagement: false,
      requestUrl: "http://127.0.0.1:4321/save",
      siteUrl: "http://localhost:4321",
    }),
    false,
  );
  assert.equal(
    isLocalStockManagementEnabled({
      hostEnableLocalStockManagement: true,
      requestUrl: "https://shop.example.com/save",
      siteUrl: "http://127.0.0.1",
    }),
    false,
  );
  assert.equal(
    isLocalStockManagementEnabled({
      hostEnableLocalStockManagement: true,
      requestUrl: "http://127.0.0.1/save",
      siteUrl: "https://shop.example.com",
    }),
    false,
  );
  assert.equal(
    isLocalStockManagementEnabled({
      hostEnableLocalStockManagement: "true",
      requestUrl: "http://127.0.0.1/save",
    }),
    false,
  );
  assert.equal(
    isLocalStockManagementEnabled({
      hostEnableLocalStockManagement: true,
      requestUrl: "http://127.0.0.1/save",
    }),
    false,
  );
  assert.equal(
    isLocalStockManagementEnabled({
      hostEnableLocalStockManagement: true,
      requestUrl: "http://127.0.0.1/save",
      siteUrl: "",
    }),
    false,
  );
  assert.equal(
    isLocalStockManagementEnabled({
      hostEnableLocalStockManagement: true,
      requestUrl: "http://127.0.0.1/save",
      siteUrl: "   ",
    }),
    false,
  );
  assert.equal(
    isLocalStockManagementEnabled({
      hostEnableLocalStockManagement: true,
      requestUrl: "http://127.0.0.1/save",
      siteUrl: "ftp://127.0.0.1",
    }),
    false,
  );
  assert.equal(
    isLocalStockManagementEnabled({
      hostEnableLocalStockManagement: true,
      requestUrl: "http://127.0.0.1/save",
      siteUrl: "not-a-url",
    }),
    false,
  );
  assert.equal(
    isLocalStockManagementEnabled({
      hostEnableLocalStockManagement: true,
      requestUrl: "javascript:127.0.0.1",
      siteUrl: "http://127.0.0.1",
    }),
    false,
  );
});

test("local constructor site URL cannot mask a known public or malformed runtime site", () => {
  const maskedPublic = readLocalStockAdmission(
    { enableLocalStockManagement: true, siteUrl: "http://127.0.0.1:4321" },
    {
      request: { url: "http://127.0.0.1:4321/api" },
      site: { url: "https://store.example" },
    },
  );
  assert.equal(maskedPublic.constructorSiteUrl, "http://127.0.0.1:4321");
  assert.equal(maskedPublic.runtimeSiteUrl, "https://store.example");
  assert.equal(isLocalStockManagementEnabled(maskedPublic), false);

  const productionConstructor = readLocalStockAdmission(
    { enableLocalStockManagement: true, siteUrl: "https://shop.example.com" },
    {
      request: { url: "http://127.0.0.1:4321/api" },
      site: { url: "http://127.0.0.1:4321" },
    },
  );
  assert.equal(isLocalStockManagementEnabled(productionConstructor), false);

  const malformedRuntime = readLocalStockAdmission(
    { enableLocalStockManagement: true, siteUrl: "http://127.0.0.1:4321" },
    {
      request: { url: "http://127.0.0.1:4321/api" },
      site: { url: "not-a-url" },
    },
  );
  assert.equal(isLocalStockManagementEnabled(malformedRuntime), false);

  const blankRuntimeUsesConstructor = readLocalStockAdmission(
    { enableLocalStockManagement: true, siteUrl: "http://127.0.0.1:4321" },
    {
      request: { url: "http://127.0.0.1:4321/api" },
      site: { url: "" },
    },
  );
  assert.equal(blankRuntimeUsesConstructor.constructorSiteUrl, "http://127.0.0.1:4321");
  assert.equal(blankRuntimeUsesConstructor.runtimeSiteUrl, undefined);
  assert.equal(isLocalStockManagementEnabled(blankRuntimeUsesConstructor), true);

  const missingBoth = readLocalStockAdmission(
    { enableLocalStockManagement: true },
    { request: { url: "http://127.0.0.1:4321/api" } },
  );
  assert.equal(isLocalStockManagementEnabled(missingBoth), false);
});

test("native create refuses manageStock true and leaves storage empty", async () => {
  const store = stores([]);
  const plugin = createPlugin();
  await assert.rejects(
    plugin.routes[CREATE_CATALOG_ITEM_ROUTE].handler({
      ...nativeContext(store),
      input: { commandId: "cmd:evil", name: "Evil", sku: "EVIL", manageStock: true },
      request: new Request("https://example.test/create", { method: "POST" }),
    }),
    (error) =>
      error instanceof PluginRouteError &&
      error.status === 409 &&
      error.message === MANAGE_STOCK_UNAVAILABLE_MESSAGE,
  );
  assert.equal(store.catalog.records.size, 0);
});

test("native create without manageStock stays unmanaged and usable", async () => {
  const catalog = new MemoryCatalogStorage();
  const plugin = createPlugin();
  const created = await plugin.routes[CREATE_CATALOG_ITEM_ROUTE].handler({
    storage: { catalogItems: catalog },
    input: { commandId: "cmd:fresh", name: "Fresh", sku: "FRESH" },
    request: new Request("https://example.test/create", { method: "POST" }),
  });
  assert.equal(created.item.stockManagement.mode, "unmanaged");
  assert.deepEqual(created.item.creationIntent, { manageStock: false });
});

test("native save refuses enable without price, status, claim, or binding writes", async () => {
  const store = stores();
  store.configurations = new MemoryCollection([bindingRecord()]);
  await saveCatalogProductPrices(store, {
    catalogItemId: "item-bag",
    regular: "12",
    sale: "10",
    stockStatus: "in-stock",
  });
  const before = snapshot(store);
  const plugin = createPlugin();
  await assert.rejects(
    plugin.routes[SAVE_CATALOG_PRODUCT_PRICES_ROUTE].handler({
      ...nativeContext(store),
      input: { catalogItemId: "item-bag", regular: "99", sale: "80", manageStock: true },
      request: new Request("https://example.test/save", { method: "POST" }),
    }),
    (error) =>
      error instanceof PluginRouteError &&
      error.message === MANAGE_STOCK_UNAVAILABLE_MESSAGE,
  );
  assert.deepEqual(snapshot(store), before);
  assert.deepEqual(store.catalog.records.get("item-bag").stockManagement, { mode: "unmanaged" });
});

test("omitted manageStock on a managed price save preserves claims, binding, and fail-closed sellability", async () => {
  const store = stores([managedItem()]);
  store.claims = new MemoryCollection([claimRecord()]);
  store.configurations = new MemoryCollection([bindingRecord()]);
  const claimBefore = structuredClone(store.claims.records.get("claim-1"));
  const bindingBefore = structuredClone(store.configurations.records.get("active"));
  const catalogBefore = structuredClone(store.catalog.records.get("item-bag"));
  const plugin = createPlugin();
  const saved = await plugin.routes[SAVE_CATALOG_PRODUCT_PRICES_ROUTE].handler({
    ...nativeContext(store),
    input: { catalogItemId: "item-bag", regular: "20", sale: "15" },
    request: new Request("https://example.test/save", { method: "POST" }),
  });
  assert.equal(saved.saved, true);
  assert.equal(saved.manageStock, true);
  assert.deepEqual(store.catalog.records.get("item-bag"), catalogBefore);
  assert.deepEqual(store.claims.records.get("claim-1"), claimBefore);
  assert.deepEqual(store.configurations.records.get("active"), bindingBefore);
  const availability = await resolveStorefrontAvailability(
    {
      catalog: store.catalog,
      prices: store.prices,
      manualAvailability: store.availability,
      configurations: store.configurations,
      settings: new MemoryCollection(),
      backorderPolicies: new MemoryCollection(),
      listing: new MemoryCollection(),
    },
    { catalogItemId: "item-bag" },
    { resolveProvider: async () => { throw new Error("Inventory must not be contacted"); } },
  );
  assert.equal(availability.sellable, false);
  assert.equal(availability.status, "availability-unavailable");
});

test("explicit managed-to-unmanaged through the v1 save route is refused", async () => {
  const store = stores([managedItem()]);
  store.claims = new MemoryCollection([claimRecord()]);
  const before = snapshot(store);
  const plugin = createPlugin();
  await assert.rejects(
    plugin.routes[SAVE_CATALOG_PRODUCT_PRICES_ROUTE].handler({
      ...nativeContext(store),
      input: { catalogItemId: "item-bag", regular: "12", sale: "", manageStock: false },
      request: new Request("https://example.test/save", { method: "POST" }),
    }),
    (error) =>
      error instanceof PluginRouteError &&
      error.message === MANAGE_STOCK_LOCKED_MESSAGE,
  );
  assert.deepEqual(snapshot(store), before);
});

test("no-op persisted manageStock is omitted and unmanaged pricing still saves", async () => {
  const store = stores();
  const plugin = createPlugin();
  const saved = await plugin.routes[SAVE_CATALOG_PRODUCT_PRICES_ROUTE].handler({
    ...nativeContext(store),
    input: {
      catalogItemId: "item-bag",
      regular: "8",
      sale: "",
      manageStock: false,
      stockStatus: "out-of-stock",
    },
    request: new Request("https://example.test/save", { method: "POST" }),
  });
  assert.equal(saved.saved, true);
  assert.equal(saved.manageStock, false);
  assert.equal(saved.stockStatus, "out-of-stock");
  assert.deepEqual(store.catalog.records.get("item-bag").stockManagement, { mode: "unmanaged" });
});

test("kernel create and save still accept manageStock true as the future contract", async () => {
  const store = stores();
  const enabled = await saveCatalogProductPrices(store, {
    catalogItemId: "item-bag",
    regular: "12",
    sale: "",
    manageStock: true,
  });
  assert.equal(enabled.saved, true);
  assert.deepEqual(store.catalog.records.get("item-bag").stockManagement, {
    mode: "managed",
    status: "setup-required",
  });
});

test("Block Kit product form shows Coming soon and no working Manage stock control", async () => {
  const store = stores();
  const opened = await commerceAdmin(
    { input: { type: "block_action", action_id: "open", value: "item-bag" } },
    sandboxContext(store),
  );
  const texts = flatten(opened.blocks);
  assert.ok(texts.some((text) => text.includes("Manage stock")));
  assert.ok(texts.some((text) => text.includes("Coming soon")));
  assert.equal(hasWorkingManageStock(opened.blocks), false);
  assert.ok(opened.blocks.some((block) =>
    block.type === "form" && block.fields.some((field) => field.action_id === "stockStatus")));
});

test("Block Kit create refuses manageStock true without writing a product", async () => {
  const store = stores([]);
  const refused = await commerceAdmin(
    {
      input: {
        type: "form_submit",
        action_id: "create:cmd-evil",
        values: { name: "Evil", sku: "EVIL", manageStock: true },
      },
    },
    sandboxContext(store),
  );
  assert.equal(refused.toast.type, "error");
  assert.equal(refused.toast.message, MANAGE_STOCK_UNAVAILABLE_MESSAGE);
  assert.equal(store.catalog.records.size, 0);
});

test("Block Kit save refuses enable and omitted tracking preserves a managed product", async () => {
  const unmanaged = stores();
  await saveCatalogProductPrices(unmanaged, {
    catalogItemId: "item-bag",
    regular: "12",
    sale: "10",
  });
  const before = snapshot(unmanaged);
  const refused = await commerceAdmin(
    {
      input: {
        type: "form_submit",
        action_id: "save:item-bag",
        values: { regular: "99", sale: "80", manageStock: true },
      },
    },
    sandboxContext(unmanaged),
  );
  assert.equal(refused.toast.type, "error");
  assert.equal(refused.toast.message, MANAGE_STOCK_UNAVAILABLE_MESSAGE);
  assert.deepEqual(snapshot(unmanaged), before);

  const managed = stores([managedItem()]);
  managed.claims = new MemoryCollection([claimRecord()]);
  const claimBefore = structuredClone(managed.claims.records.get("claim-1"));
  const catalogBefore = structuredClone(managed.catalog.records.get("item-bag"));
  const saved = await commerceAdmin(
    {
      input: {
        type: "form_submit",
        action_id: "save:item-bag",
        values: { regular: "20", sale: "15" },
      },
    },
    sandboxContext(managed),
  );
  assert.equal(saved.toast.type, "success");
  assert.deepEqual(managed.catalog.records.get("item-bag"), catalogBefore);
  assert.deepEqual(managed.claims.records.get("claim-1"), claimBefore);
  assert.ok(
    flatten(saved.blocks).some((text) => text.includes("This product stays managed")),
  );
});

test("CatalogError still distinguishes admission from kernel INVALID_INPUT", () => {
  const error = new CatalogError("MANAGE_STOCK_UNAVAILABLE", MANAGE_STOCK_UNAVAILABLE_MESSAGE);
  assert.equal(error.status, 409);
});

test("invalid manageStock is refused as INVALID_INPUT before a stock write", async () => {
  const store = stores();
  const before = snapshot(store);
  const plugin = createPlugin();
  await assert.rejects(
    plugin.routes[SAVE_CATALOG_PRODUCT_PRICES_ROUTE].handler({
      ...nativeContext(store),
      input: { catalogItemId: "item-bag", regular: "12", sale: "", manageStock: "true" },
      request: loopbackRequest("/save"),
    }),
    (error) =>
      error instanceof PluginRouteError &&
      error.status === 400 &&
      /manageStock must be a boolean/.test(error.message),
  );
  assert.deepEqual(snapshot(store), before);
});

test("list reports a disabled Manage stock control by default even on loopback", async () => {
  const store = stores();
  const plugin = createPlugin();
  const listed = await plugin.routes[LIST_CATALOG_PRODUCTS_ROUTE].handler({
    ...nativeContext(store),
    input: {},
    request: loopbackRequest("/list"),
  });
  assert.deepEqual(listed.manageStockControl, { enabled: false });
  assert.equal(listed.products[0].manageStock, false);
});

test("query-string and missing trusted site context cannot enable admission", async () => {
  const store = stores();
  const before = snapshot(store);
  const plugin = createPlugin({ enableLocalStockManagement: true });
  const queryRequest = new Request(
    "http://127.0.0.1/save?enableLocalStockManagement=true&manageStockControl=enabled",
    { method: "POST" },
  );
  await assert.rejects(
    plugin.routes[SAVE_CATALOG_PRODUCT_PRICES_ROUTE].handler({
      ...nativeContext(store),
      input: { catalogItemId: "item-bag", regular: "12", sale: "", manageStock: true },
      request: queryRequest,
    }),
    (error) =>
      error instanceof PluginRouteError &&
      error.message === MANAGE_STOCK_UNAVAILABLE_MESSAGE,
  );
  await assert.rejects(
    plugin.routes[SAVE_CATALOG_PRODUCT_PRICES_ROUTE].handler({
      ...nativeContext(store, { site: { url: "" } }),
      input: { catalogItemId: "item-bag", regular: "12", sale: "", manageStock: true },
      request: loopbackRequest("/save"),
    }),
    (error) =>
      error instanceof PluginRouteError &&
      error.message === MANAGE_STOCK_UNAVAILABLE_MESSAGE,
  );
  await assert.rejects(
    plugin.routes[SAVE_CATALOG_PRODUCT_PRICES_ROUTE].handler({
      ...nativeContext(store, { site: { url: "ftp://127.0.0.1" } }),
      input: { catalogItemId: "item-bag", regular: "12", sale: "", manageStock: true },
      request: loopbackRequest("/save"),
    }),
    (error) =>
      error instanceof PluginRouteError &&
      error.message === MANAGE_STOCK_UNAVAILABLE_MESSAGE,
  );
  const listed = await plugin.routes[LIST_CATALOG_PRODUCTS_ROUTE].handler({
    ...nativeContext(store),
    input: {},
    request: loopbackRequest("/list"),
  });
  assert.deepEqual(listed.manageStockControl, { enabled: false });
  assert.deepEqual(snapshot(store), before);
});

test("forged request-body local-dev override cannot enable admission", async () => {
  const store = stores();
  const before = snapshot(store);
  const plugin = createPlugin();
  await assert.rejects(
    plugin.routes[SAVE_CATALOG_PRODUCT_PRICES_ROUTE].handler({
      ...nativeContext(store),
      input: {
        catalogItemId: "item-bag",
        regular: "12",
        sale: "",
        manageStock: true,
        enableLocalStockManagement: true,
        manageStockControl: { enabled: true },
      },
      request: new Request(
        "http://127.0.0.1/save?enableLocalStockManagement=true",
        { method: "POST" },
      ),
    }),
    (error) =>
      error instanceof PluginRouteError &&
      error.message === MANAGE_STOCK_UNAVAILABLE_MESSAGE,
  );
  assert.deepEqual(snapshot(store), before);
});

test("host local-dev flag on a production site URL fails closed", async () => {
  const store = stores();
  const before = snapshot(store);
  const plugin = createPlugin({ enableLocalStockManagement: true });
  await assert.rejects(
    plugin.routes[SAVE_CATALOG_PRODUCT_PRICES_ROUTE].handler({
      ...nativeContext(store, { site: { url: "https://shop.example.com" } }),
      input: { catalogItemId: "item-bag", regular: "12", sale: "", manageStock: true },
      request: loopbackRequest("/save"),
    }),
    (error) =>
      error instanceof PluginRouteError &&
      error.message === MANAGE_STOCK_UNAVAILABLE_MESSAGE,
  );
  await assert.rejects(
    plugin.routes[CREATE_CATALOG_ITEM_ROUTE].handler({
      ...nativeContext(store, { site: { url: "https://shop.example.com" } }),
      input: { commandId: "cmd:remote", name: "Remote", sku: "REMOTE", manageStock: true },
      request: productionRequest("/create"),
    }),
    (error) =>
      error instanceof PluginRouteError &&
      error.message === MANAGE_STOCK_UNAVAILABLE_MESSAGE,
  );
  const listed = await plugin.routes[LIST_CATALOG_PRODUCTS_ROUTE].handler({
    ...nativeContext(store, { site: { url: "https://shop.example.com" } }),
    input: {},
    request: loopbackRequest("/list"),
  });
  assert.deepEqual(listed.manageStockControl, { enabled: false });
  assert.deepEqual(snapshot(store), before);
});

test("host-configured loopback site URL admits without plugin ctx.site", async () => {
  const store = stores();
  const plugin = createPlugin({
    enableLocalStockManagement: true,
    siteUrl: "http://127.0.0.1:4321",
  });
  const listed = await plugin.routes[LIST_CATALOG_PRODUCTS_ROUTE].handler({
    ...nativeContext(store),
    input: {},
    request: loopbackRequest("/list"),
  });
  assert.deepEqual(listed.manageStockControl, { enabled: true });
});

test("constructor and runtime site URL conflicts deny handlers, list capability, and leave data unchanged", async () => {
  const conflicts = [
    {
      options: { enableLocalStockManagement: true, siteUrl: "http://127.0.0.1:4321" },
      extras: { site: { url: "https://store.example" } },
    },
    {
      options: { enableLocalStockManagement: true, siteUrl: "https://shop.example.com" },
      extras: { site: { url: "http://127.0.0.1:4321" } },
    },
    {
      options: { enableLocalStockManagement: true, siteUrl: "http://127.0.0.1:4321" },
      extras: { site: { url: "ftp://127.0.0.1" } },
    },
  ];

  for (const conflict of conflicts) {
    const store = stores();
    const before = snapshot(store);
    const plugin = createPlugin(conflict.options);
    const ctx = nativeContext(store, conflict.extras);

    await assert.rejects(
      plugin.routes[SAVE_CATALOG_PRODUCT_PRICES_ROUTE].handler({
        ...ctx,
        input: { catalogItemId: "item-bag", regular: "99", sale: "80", manageStock: true },
        request: loopbackRequest("/save"),
      }),
      (error) =>
        error instanceof PluginRouteError &&
        error.message === MANAGE_STOCK_UNAVAILABLE_MESSAGE,
    );
    assert.deepEqual(snapshot(store), before);

    const createStore = stores([]);
    const createBefore = snapshot(createStore);
    await assert.rejects(
      plugin.routes[CREATE_CATALOG_ITEM_ROUTE].handler({
        ...nativeContext(createStore, conflict.extras),
        input: { commandId: "cmd:conflict", name: "Conflict", sku: "CONFLICT", manageStock: true },
        request: loopbackRequest("/create"),
      }),
      (error) =>
        error instanceof PluginRouteError &&
        error.message === MANAGE_STOCK_UNAVAILABLE_MESSAGE,
    );
    assert.deepEqual(snapshot(createStore), createBefore);
    assert.equal(createStore.catalog.records.size, 0);

    const listed = await plugin.routes[LIST_CATALOG_PRODUCTS_ROUTE].handler({
      ...ctx,
      input: {},
      request: loopbackRequest("/list"),
    });
    assert.deepEqual(listed.manageStockControl, { enabled: false });
    assert.equal(listed.products[0].manageStock, false);

    const saved = await plugin.routes[SAVE_CATALOG_PRODUCT_PRICES_ROUTE].handler({
      ...ctx,
      input: { catalogItemId: "item-bag", regular: "8", sale: "", manageStock: false },
      request: loopbackRequest("/save"),
    });
    assert.equal(saved.saved, true);
    assert.equal(saved.manageStock, false);
    assert.deepEqual(store.catalog.records.get("item-bag").stockManagement, { mode: "unmanaged" });
    assert.equal(store.catalog.records.get("item-bag").name, "Bag");
  }
});

test("forged request-body site URL cannot replace missing trusted site context", async () => {
  const store = stores();
  const before = snapshot(store);
  const plugin = createPlugin({ enableLocalStockManagement: true });
  await assert.rejects(
    plugin.routes[SAVE_CATALOG_PRODUCT_PRICES_ROUTE].handler({
      ...nativeContext(store),
      input: {
        catalogItemId: "item-bag",
        regular: "12",
        sale: "",
        manageStock: true,
        siteUrl: "http://127.0.0.1",
      },
      request: loopbackRequest("/save"),
    }),
    (error) =>
      error instanceof PluginRouteError &&
      error.message === MANAGE_STOCK_UNAVAILABLE_MESSAGE,
  );
  assert.deepEqual(snapshot(store), before);
});

test("explicit local-dev setting on loopback admits future kernel stock transitions", async () => {
  const store = stores();
  await store.availability.put("item-bag", {
    recordKind: "catalog-manual-availability",
    recordId: "item-bag",
    catalogItemId: "item-bag",
    status: "out-of-stock",
  });
  const plugin = createPlugin({ enableLocalStockManagement: true });
  const ctx = nativeContext(store, { site: { url: "http://127.0.0.1:4321" } });
  const listed = await plugin.routes[LIST_CATALOG_PRODUCTS_ROUTE].handler({
    ...ctx,
    input: {},
    request: loopbackRequest("/list"),
  });
  assert.deepEqual(listed.manageStockControl, { enabled: true });

  const created = await plugin.routes[CREATE_CATALOG_ITEM_ROUTE].handler({
    storage: { catalogItems: new MemoryCatalogStorage() },
    input: { commandId: "cmd:dev-default", name: "Dev default", sku: "DEV-DEFAULT" },
    request: loopbackRequest("/create"),
    site: { url: "http://localhost:4321" },
  });
  assert.equal(created.item.stockManagement.mode, "unmanaged");
  assert.deepEqual(created.item.creationIntent, { manageStock: false });

  const enabled = await plugin.routes[SAVE_CATALOG_PRODUCT_PRICES_ROUTE].handler({
    ...ctx,
    input: { catalogItemId: "item-bag", regular: "12", sale: "", manageStock: true },
    request: loopbackRequest("/save"),
  });
  assert.equal(enabled.saved, true);
  assert.equal(enabled.manageStock, true);
  assert.deepEqual(store.catalog.records.get("item-bag").stockManagement, {
    mode: "managed",
    status: "setup-required",
  });

  const restored = await plugin.routes[SAVE_CATALOG_PRODUCT_PRICES_ROUTE].handler({
    ...ctx,
    input: { catalogItemId: "item-bag", regular: "12", sale: "", manageStock: false },
    request: loopbackRequest("/save"),
  });
  assert.equal(restored.saved, true);
  assert.equal(restored.manageStock, false);
  assert.equal(restored.stockStatus, "out-of-stock");
  assert.deepEqual(store.catalog.records.get("item-bag").stockManagement, {
    mode: "unmanaged",
  });
  assert.equal(store.availability.records.get("item-bag").status, "out-of-stock");
});

test("explicit local-dev disable keeps the v1 refuse path", async () => {
  const store = stores();
  const before = snapshot(store);
  const plugin = createPlugin({ enableLocalStockManagement: false });
  await assert.rejects(
    plugin.routes[SAVE_CATALOG_PRODUCT_PRICES_ROUTE].handler({
      ...nativeContext(store, { site: { url: "http://127.0.0.1" } }),
      input: { catalogItemId: "item-bag", regular: "12", sale: "", manageStock: true },
      request: loopbackRequest("/save"),
    }),
    (error) =>
      error instanceof PluginRouteError &&
      error.message === MANAGE_STOCK_UNAVAILABLE_MESSAGE,
  );
  assert.deepEqual(snapshot(store), before);
});

test("Block Kit recovery after a storage read failure does not pretend managed is unmanaged", async () => {
  const store = stores([managedItem()]);
  store.claims = new MemoryCollection([claimRecord()]);
  const before = snapshot(store);
  store.catalog.get = async () => {
    throw new Error("catalog read failed");
  };
  const recovered = await commerceAdmin(
    {
      input: {
        type: "form_submit",
        action_id: "save:item-bag",
        values: { regular: "20", sale: "15" },
      },
    },
    sandboxContext(store),
  );
  assert.equal(recovered.toast.type, "error");
  const texts = flatten(recovered.blocks);
  assert.ok(texts.some((text) => text.includes("Coming soon")));
  assert.ok(texts.some((text) => text.includes("until stored tracking can be proven")));
  assert.equal(hasWorkingManageStock(recovered.blocks), false);
  const form = recovered.blocks.find((block) => block.type === "form");
  assert.ok(form);
  assert.equal(
    form.fields.some((field) => field.action_id === "stockStatus"),
    false,
  );
  assert.deepEqual(snapshot(store), before);
});
