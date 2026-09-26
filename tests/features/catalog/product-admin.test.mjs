import assert from "node:assert/strict";
import test from "node:test";
import { PluginRouteError } from "emdash";

import {
  LIST_CATALOG_PRODUCTS_ROUTE,
  SAVE_CATALOG_PRODUCT_PRICES_ROUTE,
  catalogProductCreateInput,
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
    this.puts = [];
    this.deletes = [];
  }

  async get(id) {
    const record = this.records.get(id);
    return record === undefined ? null : structuredClone(record);
  }

  async put(id, record) {
    this.records.set(id, structuredClone(record));
    this.puts.push(id);
  }

  async delete(id) {
    this.deletes.push(id);
    return this.records.delete(id);
  }

  async query({ cursor } = {}) {
    const items = [...this.records.entries()].map(([id, data]) => ({
      id,
      data: structuredClone(data),
    }));
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
  assert.deepEqual(saved, { saved: true, regular: "12.00", sale: "10.00", message: null });

  const listed = await listCatalogProducts(stores);
  assert.deepEqual(listed.products, [
    {
      catalogItemId: "item-bag",
      name: "Bag",
      sku: "BAG-1",
      regular: "12.00",
      sale: "10.00",
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
  assert.deepEqual(priced, { saved: true, regular: "12.50", sale: "12.00", message: null });

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

test("lowering Regular below the current Sale stores the new lower Sale", async () => {
  const stores = storage();
  await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "20",
    sale: "12",
  });
  const saved = await saveCatalogProductPrices(stores, {
    catalogItemId: "item-bag",
    regular: "11",
    sale: "10",
  });
  assert.deepEqual(saved, { saved: true, regular: "11.00", sale: "10.00", message: null });
  assert.deepEqual(await resolveCatalogItemPrice(stores.prices, "item-bag"), {
    catalogItemId: "item-bag",
    listable: true,
    regular: { currency: "USD", minor: "1100" },
    sale: { currency: "USD", minor: "1000" },
    customerPays: { currency: "USD", minor: "1000" },
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
  assert.deepEqual(cleared, { saved: true, regular: "", sale: "", message: null });
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
  assert.equal(plugin.routes[LIST_CATALOG_PRODUCTS_ROUTE].permission, "content:edit_any");
  assert.equal(plugin.routes[SAVE_CATALOG_PRODUCT_PRICES_ROUTE].permission, "content:edit_any");
  const context = {
    storage: { catalogItems: stores.catalog, catalogPrices: stores.prices },
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
