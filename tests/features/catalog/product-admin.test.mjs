import assert from "node:assert/strict";
import test from "node:test";
import { PluginRouteError } from "emdash";

import {
  CatalogError,
  catalogProductCreateInput,
  createManagedSkuRegistrationClaimKey,
  createPlugin,
  listCatalogProducts,
  releaseManagedSkuRegistrationClaims,
  resolveCatalogItemPrice,
  saveCatalogProductPrices,
} from "../../../dist/index.js";

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
    return {
      value: structuredClone(record),
      revision: this.revisions.get(id),
    };
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
      const revision = crypto.randomUUID();
      this.revisions.set(id, revision);
      this.puts.push(id);
      return { applied: true, revision };
    }
    if (this.revisions.get(id) !== expectedRevision) return { applied: false };
    this.records.set(id, structuredClone(record));
    const revision = crypto.randomUUID();
    this.revisions.set(id, revision);
    this.puts.push(id);
    return { applied: true, revision };
  }

  async compareAndDelete(id, expectedRevision) {
    if (this.revisions.get(id) !== expectedRevision) return { applied: false };
    this.deletes.push(id);
    this.records.delete(id);
    this.revisions.delete(id);
    return { applied: true };
  }

  async delete(id) {
    this.deletes.push(id);
    this.revisions.delete(id);
    return this.records.delete(id);
  }

  async query({ cursor, where, limit } = {}) {
    let items = [...this.records.entries()].map(([id, data]) => ({
      id,
      data: structuredClone(data),
    }));
    if (where && typeof where === "object") {
      items = items.filter(({ data }) =>
        Object.entries(where).every(([key, value]) => data[key] === value),
      );
    }
    if (typeof limit === "number") {
      return { items: items.slice(0, limit), hasMore: items.length > limit };
    }
    if (cursor === "page-2") {
      return { items: items.slice(1), hasMore: false };
    }
    if (items.length > 1) {
      return { items: items.slice(0, 1), cursor: "page-2", hasMore: true };
    }
    return { items, hasMore: false };
  }
}

function item(overrides) {
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

function bindClaimRelease(stores, claims) {
  stores.claims = claims;
  stores.releaseRegistrationClaims = async (catalogItemId) => {
    await releaseManagedSkuRegistrationClaims(claims, { catalogItemId });
  };
  return stores;
}

function storage(records = [item()]) {
  return bindClaimRelease({
    catalog: new MemoryCollection(records),
    prices: new MemoryCollection(),
    availability: new MemoryCollection(),
  }, new MemoryCollection());
}

function savedForm(overrides = {}) {
  return {
    saved: true,
    regular: "12.00",
    sale: "10.00",
    manageStock: false,
    stockStatus: "in-stock",
    message: null,
    ...overrides,
  };
}

test("adding a product asks only for name and SKU", () => {
  assert.deepEqual(catalogProductCreateInput("Bag", "bag-1", "cmd-1"), {
    commandId: "cmd-1",
    name: "Bag",
    sku: "bag-1",
  });
});

test("a clerk can save Regular and Sale and see a refusal leave the price unchanged", async () => {
  const stores = storage();
  const saved = await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "12",
    sale: "$10",
  });
  assert.deepEqual(saved, savedForm());

  const listed = await listCatalogProducts(stores);
  assert.deepEqual(listed.products, [
    {
      catalogItemId: "item-bag",
      revision: "catalog:" + (await stores.catalog.getVersioned("item-bag")).revision,
      name: "Bag",
      sku: "BAG-1",
      regular: "12.00",
      sale: "10.00",
      manageStock: false,
      stockStatus: "in-stock",
      fulfillment: "physical",
    },
  ]);

  const pricePuts = stores.prices.puts.length;
  const refused = await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "12.999",
    sale: "abc",
  });
  assert.equal(refused.saved, false);
  assert.equal(refused.regular, "12.999");
  assert.match(refused.message, /Regular: Enter a dollar amount/);
  assert.match(refused.message, /Sale: Enter a dollar amount/);
  assert.equal(stores.prices.puts.length, pricePuts);
  assert.deepEqual(await resolveCatalogItemPrice(stores.prices, "item-bag", stores.catalog), {
    catalogItemId: "item-bag",
    listable: true,
    regular: { currency: "USD", minor: "1200" },
    sale: { currency: "USD", minor: "1000" },
    customerPays: { currency: "USD", minor: "1000" },
  });
});

test("one decimal and a dollar sign save as cents, and a bad sale does not change the stored price", async () => {
  const stores = storage();
  const priced = await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "12.5",
    sale: "$12",
  });
  assert.deepEqual(priced, savedForm({ regular: "12.50", sale: "12.00" }));

  const pricePuts = stores.prices.puts.length;
  const blocked = await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "$12",
    sale: "12.5",
  });
  assert.equal(blocked.saved, false);
  assert.equal(blocked.message, "Sale must be lower than Regular.");
  assert.equal(blocked.regular, "$12");
  assert.equal(stores.prices.puts.length, pricePuts);

  const cleared = await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "",
    sale: "9",
  });
  assert.equal(cleared.saved, false);
  assert.equal(cleared.message, "End the sale before clearing Regular.");
  assert.deepEqual(await resolveCatalogItemPrice(stores.prices, "item-bag", stores.catalog), {
    catalogItemId: "item-bag",
    listable: true,
    regular: { currency: "USD", minor: "1250" },
    sale: { currency: "USD", minor: "1200" },
    customerPays: { currency: "USD", minor: "1200" },
  });
});

test("lowering Regular below the current Sale stores the new lower Sale in one write", async () => {
  const stores = storage();
  await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "20",
    sale: "12",
  });
  const writesBefore = stores.catalog.puts.length;
  const saved = await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "11",
    sale: "10",
  });
  assert.equal(stores.catalog.puts.length, writesBefore + 1);
  assert.equal(stores.prices.deletes.length, 0);
  assert.deepEqual(saved, savedForm({ regular: "11.00", sale: "10.00" }));
  assert.deepEqual(await resolveCatalogItemPrice(stores.prices, "item-bag", stores.catalog), {
    catalogItemId: "item-bag",
    listable: true,
    regular: { currency: "USD", minor: "1100" },
    sale: { currency: "USD", minor: "1000" },
    customerPays: { currency: "USD", minor: "1000" },
  });
});

test("a failed price write leaves the stored Regular and Sale unchanged", async () => {
  const stores = storage();
  await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "20",
    sale: "12",
  });
  stores.catalog.compareAndSet = async () => {
    throw new Error("disk full");
  };
  await assert.rejects(
    saveCatalogProductPrices(stores, {
      catalogItemId: "item-bag",
      regular: "11",
      sale: "10",
    }),
    (error) => error instanceof CatalogError && error.code === "SAVE_OUTCOME_UNKNOWN",
  );
  assert.deepEqual(await resolveCatalogItemPrice(stores.prices, "item-bag", stores.catalog), {
    catalogItemId: "item-bag",
    listable: true,
    regular: { currency: "USD", minor: "2000" },
    sale: { currency: "USD", minor: "1200" },
    customerPays: { currency: "USD", minor: "1200" },
  });
});

test("blanking both fields ends the sale and unprices the product", async () => {
  const stores = storage();
  await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "0",
    sale: "",
  });
  const free = await listCatalogProducts(stores);
  assert.equal(free.products[0].regular, "0.00");
  assert.equal(free.products[0].sale, null);

  await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "8.00",
    sale: "4",
  });
  const cleared = await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "",
    sale: "",
  });
  assert.deepEqual(cleared, savedForm({ regular: "", sale: "" }));
  assert.deepEqual(await resolveCatalogItemPrice(stores.prices, "item-bag", stores.catalog), {
    catalogItemId: "item-bag",
    listable: false,
  });
});

test("the product list is by name and the admin routes stay private", async () => {
  const zebra = item({
    itemId: "item-zebra",
    commandId: "catalog:create:zebra",
    name: "Zebra",
    sku: "ZEBRA",
    skuKey: "ZEBRA",
  });
  const apple = item({
    itemId: "item-apple",
    commandId: "catalog:create:apple",
    name: "Apple",
    sku: "APPLE",
    skuKey: "APPLE",
  });
  const stores = storage([zebra, apple]);
  const listed = await listCatalogProducts(stores);
  assert.deepEqual(
    listed.products.map((product) => product.name),
    ["Apple", "Zebra"],
  );

  const plugin = createPlugin();
  assert.deepEqual(plugin.admin.pages.map((page) => page.path), ["/orders", "/settings"]);
  assert.equal(plugin.admin.entry, undefined);
  assert.equal(plugin.routes["product-panel"].permission, "content:edit_any");
  assert.equal(plugin.routes["product-media-panel"].permission, "content:edit_any");
  // Prices are saved through the product panel and the private catalog route on both builds; the native
  // list and save-prices routes are gone (commerce-one-build-registry-20261031).
  assert.equal(plugin.routes["catalog-items/list"], undefined);
  assert.equal(plugin.routes["catalog-items/save-prices"], undefined);
  assert.equal(plugin.routes.catalog.permission, "content:edit_any");
});

test("one Save writes Out of stock and a refused status leaves the stored status unchanged", async () => {
  const stores = storage();
  const saved = await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "12",
    sale: "",
    stockStatus: "out-of-stock",
  });
  assert.deepEqual(
    saved,
    savedForm({ sale: "", stockStatus: "out-of-stock" }),
  );
  const listed = await listCatalogProducts(stores);
  assert.equal(listed.products[0].stockStatus, "out-of-stock");

  const availabilityPuts = stores.availability.puts.length;
  const refused = await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "12",
    sale: "",
    stockStatus: "sold-out",
  });
  assert.equal(refused.saved, false);
  assert.match(refused.message, /In stock, Out of stock, or On backorder/);
  assert.equal(stores.availability.puts.length, availabilityPuts);
  assert.equal((await listCatalogProducts(stores)).products[0].stockStatus, "out-of-stock");
});

test("price and stock commit together or neither changes", async () => {
  const stores = storage();
  await saveCatalogProductPrices(stores, { catalogItemId: "item-bag", regular: "12", sale: "10", stockStatus: "in-stock" });
  stores.catalog.compareAndSet = async () => ({ applied: false });
  await assert.rejects(saveCatalogProductPrices(stores, { catalogItemId: "item-bag", regular: "20", sale: "8", stockStatus: "out-of-stock" }), error => error.code === "COMMAND_CONFLICT");
  assert.equal((await resolveCatalogItemPrice(stores.prices, "item-bag", stores.catalog)).regular.minor, "1200");
  assert.equal((await listCatalogProducts(stores)).products[0].stockStatus, "in-stock");
});

test("an atomic conflict preserves a later clerk's entire save", async () => {
  const stores = storage();
  await saveCatalogProductPrices(stores, { catalogItemId: "item-bag", regular: "12", sale: "10", stockStatus: "in-stock" });
  const original = stores.catalog.compareAndSet.bind(stores.catalog);
  stores.catalog.compareAndSet = async (...args) => {
    stores.catalog.compareAndSet = original;
    await saveCatalogProductPrices(stores, { catalogItemId: "item-bag", regular: "15", sale: "9", stockStatus: "out-of-stock" });
    return original(...args);
  };
  await assert.rejects(saveCatalogProductPrices(stores, { catalogItemId: "item-bag", regular: "20", sale: "8", stockStatus: "in-stock" }), error => error.code === "COMMAND_CONFLICT");
  assert.equal((await resolveCatalogItemPrice(stores.prices, "item-bag", stores.catalog)).regular.minor, "1500");
  assert.equal((await listCatalogProducts(stores)).products[0].stockStatus, "out-of-stock");
});

test("an unknown write outcome cannot roll back a subsequent save", async () => {
  const stores = storage();
  const original = stores.catalog.compareAndSet.bind(stores.catalog);
  stores.catalog.compareAndSet = async (...args) => {
    await original(...args);
    stores.catalog.compareAndSet = original;
    await saveCatalogProductPrices(stores, { catalogItemId: "item-bag", regular: "15", sale: "9", stockStatus: "out-of-stock" });
    throw new Error("lost acknowledgement");
  };
  await assert.rejects(saveCatalogProductPrices(stores, { catalogItemId: "item-bag", regular: "20", sale: "8", stockStatus: "in-stock" }), error => error.code === "SAVE_OUTCOME_UNKNOWN");
  assert.equal((await resolveCatalogItemPrice(stores.prices, "item-bag", stores.catalog)).regular.minor, "1500");
  assert.equal((await listCatalogProducts(stores)).products[0].stockStatus, "out-of-stock");
});

test("stock status is hidden and refused while Manage Stock is on", async () => {
  const stores = storage([
    item({
      stockManagement: {
        mode: "managed",
        status: "setup-required",
      },
      creationIntent: { manageStock: true },
    }),
  ]);
  const listed = await listCatalogProducts(stores);
  assert.equal(listed.products[0].manageStock, true);
  assert.equal(listed.products[0].stockStatus, null);

  const refused = await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "12",
    sale: "",
    stockStatus: "out-of-stock",
  });
  assert.equal(refused.saved, false);
  assert.equal(refused.message, "Stock status is hidden while Manage Stock is on.");
  assert.equal(stores.availability.puts.length, 0);
});

test("the same Save can check Manage stock without rewriting price", async () => {
  const stores = storage();
  await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "12",
    sale: "10",
    stockStatus: "in-stock",
  });
  const pricePuts = stores.prices.puts.length;
  const saved = await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "12.00",
    sale: "10.00",
    manageStock: true,
  });
  assert.deepEqual(saved, savedForm({ manageStock: true, stockStatus: null }));
  const listed = await listCatalogProducts(stores);
  assert.equal(listed.products[0].manageStock, true);
  assert.equal(listed.products[0].stockStatus, null);
  assert.equal(listed.products[0].regular, "12.00");
  assert.equal(listed.products[0].sale, "10.00");
  assert.equal(stores.prices.puts.length, pricePuts);
  assert.deepEqual(stores.catalog.records.get("item-bag").stockManagement, {
    mode: "managed",
    status: "setup-required",
  });
});

test("unchecking Manage stock restores dormant status and drops the setup claim", async () => {
  const claimKey = createManagedSkuRegistrationClaimKey({ catalogItemId: "item-bag" });
  const stores = storage([
    item({
      stockManagement: { mode: "managed", status: "setup-required" },
      creationIntent: { manageStock: true },
    }),
  ]);
  stores.availability = new MemoryCollection([
    {
      recordKind: "catalog-manual-availability",
      recordId: "item-bag",
      catalogItemId: "item-bag",
      status: "out-of-stock",
    },
  ]);
  bindClaimRelease(stores, new MemoryCollection([
    {
      recordKind: "managed-sku-registration-claim",
      recordId: "claim-1",
      claimKey,
      catalogItemId: "item-bag",
      operationId: "op-1",
      request: { poolId: "pool-1", sku: "BAG-1", displayNameIfNew: "Bag" },
      createdAt: "2026-09-26T00:00:00.000Z",
    },
  ]));
  const saved = await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "",
    sale: "",
    manageStock: false,
  });
  assert.equal(saved.saved, true);
  assert.equal(saved.manageStock, false);
  assert.equal(saved.stockStatus, "out-of-stock");
  assert.equal((await listCatalogProducts(stores)).products[0].manageStock, false);
  assert.equal((await listCatalogProducts(stores)).products[0].stockStatus, "out-of-stock");
  assert.equal(stores.claims.records.size, 0);
  assert.deepEqual(stores.catalog.records.get("item-bag").stockManagement, {
    mode: "unmanaged",
  });
});

test("unchecking Manage stock honors an explicit status over dormant availability", async () => {
  const stores = storage([
    item({ stockManagement: { mode: "managed", status: "setup-required" }, creationIntent: { manageStock: true } }),
  ]);
  stores.availability = new MemoryCollection([
    { recordKind: "catalog-manual-availability", recordId: "item-bag", catalogItemId: "item-bag", status: "in-stock" },
  ]);
  const saved = await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag", regular: "20", sale: "15", manageStock: false, stockStatus: "out-of-stock",
  });
  assert.equal(saved.saved, true);
  assert.equal(saved.stockStatus, "out-of-stock");
  assert.equal(saved.manageStock, false);
  assert.equal((await listCatalogProducts(stores)).products[0].stockStatus, "out-of-stock");
  assert.deepEqual(stores.catalog.records.get("item-bag").stockManagement, { mode: "unmanaged" });
  assert.equal((await listCatalogProducts(stores)).products[0].stockStatus, "out-of-stock");
});

test("unchecking Manage stock is refused while Inventory setup is pending", async () => {
  const stores = storage([
    item({
      stockManagement: {
        mode: "managed",
        status: "setup-pending",
        registration: {
          operationId: "op-pending",
          request: {
            poolId: "pool-1",
            sku: "BAG-1",
            displayNameIfNew: "Bag",
          },
        },
      },
      creationIntent: { manageStock: true },
    }),
  ]);
  const refused = await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "",
    sale: "",
    manageStock: false,
  });
  assert.equal(refused.saved, false);
  assert.equal(refused.manageStock, true);
  assert.equal(
    refused.message,
    "Inventory setup is still running. Try Save again in a moment.",
  );
  assert.equal(stores.catalog.records.get("item-bag").stockManagement.status, "setup-pending");
  assert.equal(stores.claims.records.size, 0);
});

test("a refused disable does not drop a claim that became pending after the save started", async () => {
  const pending = {
    mode: "managed",
    status: "setup-pending",
    registration: {
      operationId: "op-pending",
      request: { poolId: "pool-1", sku: "BAG-1", displayNameIfNew: "Bag" },
    },
  };
  const stores = storage([
    item({
      stockManagement: { mode: "managed", status: "setup-required" },
      creationIntent: { manageStock: true },
    }),
  ]);
  const claimKey = createManagedSkuRegistrationClaimKey({ catalogItemId: "item-bag" });
  const originalGetVersioned = stores.catalog.getVersioned.bind(stores.catalog);
  stores.catalog.getVersioned = async (id) => {
    const current = stores.catalog.records.get(id);
    stores.catalog.records.set(id, { ...current, stockManagement: pending });
    stores.catalog.revisions.set(id, crypto.randomUUID());
    stores.claims.records.set("claim-1", {
      recordKind: "managed-sku-registration-claim",
      recordId: "claim-1",
      claimKey,
      catalogItemId: "item-bag",
      operationId: "op-pending",
      request: pending.registration.request,
      createdAt: "2026-09-26T00:00:00.000Z",
    });
    stores.catalog.getVersioned = originalGetVersioned;
    return originalGetVersioned(id);
  };
  const refused = await saveCatalogProductPrices(stores, { catalogItemId: "item-bag", regular: "", sale: "", manageStock: false });
  assert.equal(refused.saved, false);
  assert.match(refused.message, /setup is still running/);
  assert.equal(stores.claims.records.size, 1);
  assert.equal(stores.catalog.records.get("item-bag").stockManagement.status, "setup-pending");
});

test("a failed claim release after disable is cleaned up on the next unmanaged save", async () => {
  const stores = storage([
    item({
      stockManagement: { mode: "managed", status: "setup-required" },
      creationIntent: { manageStock: true },
    }),
  ]);
  const claimKey = createManagedSkuRegistrationClaimKey({ catalogItemId: "item-bag" });
  stores.claims.records.set("claim-1", {
    recordKind: "managed-sku-registration-claim",
    recordId: "claim-1",
    claimKey,
    catalogItemId: "item-bag",
    operationId: "op-stale",
    request: { poolId: "pool-1", sku: "BAG-1", displayNameIfNew: "Bag" },
    createdAt: "2026-09-26T00:00:00.000Z",
  });
  const originalDelete = stores.claims.compareAndDelete.bind(stores.claims);
  let failOnce = true;
  stores.claims.compareAndDelete = async (id, revision) => {
    if (failOnce) {
      failOnce = false;
      throw new Error("claim store down");
    }
    return originalDelete(id, revision);
  };
  const savedWithCleanup = await saveCatalogProductPrices(stores, { catalogItemId: "item-bag", regular: "", sale: "", manageStock: false });
  assert.equal(savedWithCleanup.saved, true);
  assert.match(savedWithCleanup.message, /cleanup is pending/);
  assert.deepEqual(stores.catalog.records.get("item-bag").stockManagement, {
    mode: "unmanaged",
  });
  assert.equal(stores.claims.records.size, 1);
  const retried = await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "",
    sale: "",
    manageStock: false,
  });
  assert.equal(retried.saved, true);
  assert.equal(stores.claims.records.size, 0);
  const enabled = await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "",
    sale: "",
    manageStock: true,
  });
  assert.equal(enabled.saved, true);
  assert.equal(stores.catalog.records.get("item-bag").stockManagement.status, "setup-required");
  assert.equal(stores.claims.records.size, 0);
});

test("a stale enable does not overwrite a concurrent pending registration", async () => {
  const pending = {
    mode: "managed",
    status: "setup-pending",
    registration: {
      operationId: "op-pending",
      request: { poolId: "pool-1", sku: "BAG-1", displayNameIfNew: "Bag" },
    },
  };
  const stores = storage([item()]);
  const claimKey = createManagedSkuRegistrationClaimKey({ catalogItemId: "item-bag" });
  stores.claims.records.set("claim-1", {
    recordKind: "managed-sku-registration-claim",
    recordId: "claim-1",
    claimKey,
    catalogItemId: "item-bag",
    operationId: "op-pending",
    request: pending.registration.request,
    createdAt: "2026-09-26T00:00:00.000Z",
  });
  const originalGetVersioned = stores.catalog.getVersioned.bind(stores.catalog);
  stores.catalog.getVersioned = async (id) => {
    const current = stores.catalog.records.get(id);
    stores.catalog.records.set(id, { ...current, stockManagement: pending });
    stores.catalog.revisions.set(id, crypto.randomUUID());
    stores.catalog.getVersioned = originalGetVersioned;
    return originalGetVersioned(id);
  };
  const saved = await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "",
    sale: "",
    manageStock: true,
  });
  assert.equal(saved.saved, true);
  assert.equal(stores.catalog.records.get("item-bag").stockManagement.status, "setup-pending");
  assert.equal(stores.claims.records.size, 1);
});
