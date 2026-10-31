import assert from "node:assert/strict";
import test from "node:test";
import { PluginRouteError } from "emdash";

import { productPanel } from "../../../dist/admin/index.js";

// Product editing lives in the Dinkus Commerce panel on each Content > Products page.
const commerceAdmin = (route, ctx) => productPanel({ ...route, ui: { surface: 'content-editor-panel', locale: 'en', direction: 'ltr', extensionId: 'product', entry: { collection: 'products', id: 'page-1', locale: null, version: 1 } } }, ctx);
import {
  CatalogError,
  MANAGE_STOCK_LOCKED_MESSAGE,
  MANAGE_STOCK_UNAVAILABLE_MESSAGE,
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

  async getMany(ids) {
    const found = new Map();
    for (const id of ids) {
      const record = await this.get(id);
      if (record !== null) found.set(id, record);
    }
    return found;
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
      product_pages: new MemoryCollection(),
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
  assert.deepEqual(Object.fromEntries(Object.entries(managed.catalog.records.get("item-bag")).filter(([key]) => key !== "catalogData")), catalogBefore);
  assert.deepEqual(managed.claims.records.get("claim-1"), claimBefore);
  assert.ok(
    flatten(saved.blocks).some((text) => text.includes("This product stays managed")),
  );
});

test("Block Kit refused save leaves feed eligibility unchanged and keeps the clerk's feed toggles", async () => {
  const store = stores();
  const feeds = new MemoryCollection();
  const ctx = sandboxContext(store);
  ctx.storage.product_feed_eligibility = feeds;
  const refused = await commerceAdmin(
    {
      input: {
        type: "form_submit",
        action_id: "save:item-bag",
        values: { regular: "99", sale: "80", manageStock: true, "feed:google-merchant": true, "feed:meta-catalog": true },
      },
    },
    ctx,
  );
  assert.equal(refused.toast.type, "error");
  assert.equal(feeds.records.size, 0);
  const fields = refused.blocks.flatMap((block) => block?.type === "form" ? block.fields ?? [] : []);
  const toggles = fields.filter((field) => String(field.action_id).startsWith("feed:"));
  assert.deepEqual(toggles.map((field) => [field.action_id, field.initial_value]), [
    ["feed:google-merchant", true],
    ["feed:meta-catalog", true],
  ]);

  const invalid = await commerceAdmin(
    {
      input: {
        type: "form_submit",
        action_id: "save:item-bag",
        values: { regular: "not money", sale: "", "feed:google-merchant": false, "feed:meta-catalog": true },
      },
    },
    ctx,
  );
  assert.equal(invalid.toast.type, "error");
  assert.equal(feeds.records.size, 0);
  const invalidToggles = invalid.blocks.flatMap((block) => block?.type === "form" ? block.fields ?? [] : [])
    .filter((field) => String(field.action_id).startsWith("feed:"));
  assert.deepEqual(invalidToggles.map((field) => [field.action_id, field.initial_value]), [
    ["feed:google-merchant", false],
    ["feed:meta-catalog", true],
  ]);

  const saved = await commerceAdmin(
    {
      input: {
        type: "form_submit",
        action_id: "save:item-bag",
        values: { regular: "12", sale: "10", "feed:google-merchant": true, "feed:meta-catalog": false },
      },
    },
    ctx,
  );
  assert.equal(saved.toast.type, "success");
  assert.deepEqual((await store.catalog.get("item-bag")).catalogData.feedChannels, ["google-merchant"]);
});

test("CatalogError still distinguishes admission from kernel INVALID_INPUT", () => {
  const error = new CatalogError("MANAGE_STOCK_UNAVAILABLE", MANAGE_STOCK_UNAVAILABLE_MESSAGE);
  assert.equal(error.status, 409);
});

test("Block Kit recovery after a storage read failure does not pretend managed is unmanaged", async () => {
  const store = stores([managedItem()]);
  store.claims = new MemoryCollection([claimRecord()]);
  const before = snapshot(store);
  store.catalog.get = store.catalog.getVersioned = async () => {
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
  assert.ok(texts.some((text) => text.includes("Stock status hidden")));
  assert.equal(hasWorkingManageStock(recovered.blocks), false);
  const form = recovered.blocks.find((block) => block.type === "form");
  assert.ok(form);
  assert.equal(
    form.fields.some((field) => field.action_id === "stockStatus"),
    false,
  );
  assert.deepEqual(snapshot(store), before);
});
