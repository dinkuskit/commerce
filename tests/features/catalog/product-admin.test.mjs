import assert from "node:assert/strict";
import test from "node:test";
import { PluginRouteError } from "emdash";

import {
  CatalogError,
  LIST_CATALOG_PRODUCTS_ROUTE,
  SAVE_CATALOG_PRODUCT_PRICES_ROUTE,
  catalogProductCreateInput,
  createManagedSkuRegistrationClaimKey,
  createPlugin,
  listCatalogProducts,
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

function storage(records = [item()]) {
  return {
    catalog: new MemoryCollection(records),
    prices: new MemoryCollection(),
    availability: new MemoryCollection(),
    claims: new MemoryCollection(),
  };
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
      name: "Bag",
      sku: "BAG-1",
      regular: "12.00",
      sale: "10.00",
      manageStock: false,
      stockStatus: "in-stock",
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
  assert.deepEqual(await resolveCatalogItemPrice(stores.prices, "item-bag"), {
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
  assert.deepEqual(await resolveCatalogItemPrice(stores.prices, "item-bag"), {
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
  const writesBefore = stores.prices.puts.length;
  const saved = await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "11",
    sale: "10",
  });
  assert.equal(stores.prices.puts.length, writesBefore + 1);
  assert.equal(stores.prices.deletes.length, 0);
  assert.deepEqual(saved, savedForm({ regular: "11.00", sale: "10.00" }));
  assert.deepEqual(await resolveCatalogItemPrice(stores.prices, "item-bag"), {
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
  stores.prices.put = async () => {
    throw new Error("disk full");
  };
  await assert.rejects(
    saveCatalogProductPrices(stores, {
      catalogItemId: "item-bag",
      regular: "11",
      sale: "10",
    }),
    (error) => error instanceof CatalogError && error.code === "STORAGE_UNAVAILABLE",
  );
  assert.deepEqual(await resolveCatalogItemPrice(stores.prices, "item-bag"), {
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
  assert.deepEqual(await resolveCatalogItemPrice(stores.prices, "item-bag"), {
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
  assert.equal(plugin.admin.pages[0].path, "/products");
  assert.equal(plugin.admin.pages[1].path, "/store");
  assert.equal(plugin.routes[LIST_CATALOG_PRODUCTS_ROUTE].permission, "content:edit_any");
  assert.equal(plugin.routes[SAVE_CATALOG_PRODUCT_PRICES_ROUTE].permission, "content:edit_any");
  const context = {
    storage: {
      catalogItems: stores.catalog,
      catalogPrices: stores.prices,
      catalogManualAvailability: stores.availability,
    },
  };
  await assert.rejects(
    plugin.routes[SAVE_CATALOG_PRODUCT_PRICES_ROUTE].handler({
      ...context,
      input: { catalogItemId: "item-apple", regular: "3", sale: "" },
      request: new Request("https://example.test/save-prices", { method: "GET" }),
    }),
    (error) => error instanceof PluginRouteError && error.status === 405,
  );
  const saved = await plugin.routes[SAVE_CATALOG_PRODUCT_PRICES_ROUTE].handler({
    ...context,
    input: { catalogItemId: "item-apple", regular: "3", sale: "" },
    request: new Request("https://example.test/save-prices", { method: "POST" }),
  });
  assert.equal(saved.regular, "3.00");
  const fromRoute = await plugin.routes[LIST_CATALOG_PRODUCTS_ROUTE].handler({
    ...context,
    input: {},
    request: new Request("https://example.test/list", { method: "GET" }),
  });
  assert.equal(fromRoute.products[0].regular, "3.00");
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

test("a failed stock write after a price change restores the stored Regular and Sale", async () => {
  const stores = storage();
  await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "12",
    sale: "10",
    stockStatus: "in-stock",
  });
  stores.availability.put = async () => {
    throw new Error("disk full");
  };
  await assert.rejects(
    saveCatalogProductPrices(stores, {
      catalogItemId: "item-bag",
      regular: "20",
      sale: "8",
      stockStatus: "out-of-stock",
    }),
    (error) => error instanceof CatalogError && error.code === "STORAGE_UNAVAILABLE",
  );
  assert.deepEqual(await resolveCatalogItemPrice(stores.prices, "item-bag"), {
    catalogItemId: "item-bag",
    listable: true,
    regular: { currency: "USD", minor: "1200" },
    sale: { currency: "USD", minor: "1000" },
    customerPays: { currency: "USD", minor: "1000" },
  });
  assert.equal((await listCatalogProducts(stores)).products[0].stockStatus, "in-stock");
});

test("a failed stock write does not restore over a later clerk price save", async () => {
  const stores = storage();
  await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "12",
    sale: "10",
    stockStatus: "in-stock",
  });
  const originalPut = stores.availability.put.bind(stores.availability);
  stores.availability.put = async (id, record) => {
    stores.availability.put = originalPut;
    await saveCatalogProductPrices(stores, {
      catalogItemId: "item-bag",
      regular: "15",
      sale: "9",
      stockStatus: "in-stock",
    });
    throw new Error("disk full");
  };
  await assert.rejects(
    saveCatalogProductPrices(stores, {
      catalogItemId: "item-bag",
      regular: "20",
      sale: "8",
      stockStatus: "out-of-stock",
    }),
    (error) => error instanceof CatalogError && error.code === "STORAGE_UNAVAILABLE",
  );
  assert.deepEqual(await resolveCatalogItemPrice(stores.prices, "item-bag"), {
    catalogItemId: "item-bag",
    listable: true,
    regular: { currency: "USD", minor: "1500" },
    sale: { currency: "USD", minor: "900" },
    customerPays: { currency: "USD", minor: "900" },
  });
  assert.equal((await listCatalogProducts(stores)).products[0].stockStatus, "in-stock");
});

test("a failed stock write does not restore after a later save between verify and restore", async () => {
  const stores = storage();
  await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "12",
    sale: "10",
    stockStatus: "in-stock",
  });
  stores.availability.put = async () => {
    throw new Error("disk full");
  };
  const originalGetVersioned = stores.prices.getVersioned.bind(stores.prices);
  stores.prices.getVersioned = async (id) => {
    const latest = await originalGetVersioned(id);
    stores.prices.getVersioned = originalGetVersioned;
    await saveCatalogProductPrices(stores, {
      catalogItemId: "item-bag",
      regular: "15",
      sale: "9",
      stockStatus: "in-stock",
    });
    return latest;
  };
  await assert.rejects(
    saveCatalogProductPrices(stores, {
      catalogItemId: "item-bag",
      regular: "20",
      sale: "8",
      stockStatus: "out-of-stock",
    }),
    (error) => error instanceof CatalogError && error.code === "STORAGE_UNAVAILABLE",
  );
  assert.deepEqual(await resolveCatalogItemPrice(stores.prices, "item-bag"), {
    catalogItemId: "item-bag",
    listable: true,
    regular: { currency: "USD", minor: "1500" },
    sale: { currency: "USD", minor: "900" },
    customerPays: { currency: "USD", minor: "900" },
  });
  assert.equal((await listCatalogProducts(stores)).products[0].stockStatus, "in-stock");
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
  stores.claims = new MemoryCollection([
    {
      recordKind: "managed-sku-registration-claim",
      recordId: "claim-1",
      claimKey,
      catalogItemId: "item-bag",
      operationId: "op-1",
      request: { poolId: "pool-1", sku: "BAG-1", displayNameIfNew: "Bag" },
      createdAt: "2026-09-26T00:00:00.000Z",
    },
  ]);
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
