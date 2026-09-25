import assert from "node:assert/strict";
import test from "node:test";
import { PluginRouteError } from "emdash";

import {
  CATALOG_PRICES_COLLECTION,
  CLEAR_CATALOG_ITEM_REGULAR_PRICE_ROUTE,
  CLEAR_CATALOG_ITEM_SALE_PRICE_ROUTE,
  CatalogError,
  SET_CATALOG_ITEM_REGULAR_PRICE_ROUTE,
  SET_CATALOG_ITEM_SALE_PRICE_ROUTE,
  clearCatalogItemRegularPrice,
  clearCatalogItemSalePrice,
  createPlugin,
  resolveCatalogItemPrice,
  setCatalogItemRegularPrice,
  setCatalogItemSalePrice,
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
    this.puts.push({ id, record: structuredClone(record) });
  }

  async delete(id) {
    this.deletes.push(id);
    return this.records.delete(id);
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

function usd(minor) {
  return { currency: "USD", minor };
}

function storage(item = catalogItem(), prices = []) {
  return {
    catalog: new MemoryCollection([item]),
    prices: new MemoryCollection(prices),
  };
}

test("missing Regular is not listable and is never treated as zero", async () => {
  const prices = new MemoryCollection();
  const resolved = await resolveCatalogItemPrice(prices, "item-grill");

  assert.deepEqual(resolved, { catalogItemId: "item-grill", listable: false });
  assert.equal("customerPays" in resolved, false);
  assert.equal("regular" in resolved, false);
});

test("Regular persists as Money and zero is a free listable product", async () => {
  const stores = storage();
  const twelve = await setCatalogItemRegularPrice(stores, {
    catalogItemId: "item-grill",
    amount: usd("1200"),
  });
  const retry = await setCatalogItemRegularPrice(stores, {
    catalogItemId: "item-grill",
    amount: usd("1200"),
  });
  const free = await setCatalogItemRegularPrice(stores, {
    catalogItemId: "item-grill",
    amount: usd("0"),
  });

  assert.equal(twelve.changed, true);
  assert.equal(retry.changed, false);
  assert.equal(free.changed, true);
  assert.deepEqual(await resolveCatalogItemPrice(stores.prices, "item-grill"), {
    catalogItemId: "item-grill",
    listable: true,
    regular: usd("0"),
    customerPays: usd("0"),
  });
  assert.equal(stores.catalog.puts.length, 0);
  assert.equal(stores.prices.puts.length, 2);
});

test("Sale requires Regular, must be strictly lower, and can be cleared alone", async () => {
  const stores = storage();

  await assert.rejects(
    setCatalogItemSalePrice(stores, { catalogItemId: "item-grill", amount: usd("1000") }),
    (error) => error instanceof CatalogError && error.code === "SALE_REQUIRES_REGULAR",
  );

  await setCatalogItemRegularPrice(stores, {
    catalogItemId: "item-grill",
    amount: usd("1200"),
  });
  const sale = await setCatalogItemSalePrice(stores, {
    catalogItemId: "item-grill",
    amount: usd("1000"),
  });
  const saleRetry = await setCatalogItemSalePrice(stores, {
    catalogItemId: "item-grill",
    amount: usd("1000"),
  });

  await assert.rejects(
    setCatalogItemSalePrice(stores, { catalogItemId: "item-grill", amount: usd("1200") }),
    (error) =>
      error instanceof CatalogError && error.code === "SALE_NOT_LOWER_THAN_REGULAR",
  );
  await assert.rejects(
    setCatalogItemSalePrice(stores, { catalogItemId: "item-grill", amount: usd("1500") }),
    (error) =>
      error instanceof CatalogError && error.code === "SALE_NOT_LOWER_THAN_REGULAR",
  );

  assert.equal(sale.changed, true);
  assert.equal(saleRetry.changed, false);
  assert.deepEqual(await resolveCatalogItemPrice(stores.prices, "item-grill"), {
    catalogItemId: "item-grill",
    listable: true,
    regular: usd("1200"),
    sale: usd("1000"),
    customerPays: usd("1000"),
  });

  const clearedSale = await clearCatalogItemSalePrice(stores, {
    catalogItemId: "item-grill",
  });
  assert.equal(clearedSale.changed, true);
  assert.deepEqual(await resolveCatalogItemPrice(stores.prices, "item-grill"), {
    catalogItemId: "item-grill",
    listable: true,
    regular: usd("1200"),
    customerPays: usd("1200"),
  });
});

test("Regular cannot be cleared while Sale exists, then unpricing hides the product", async () => {
  const stores = storage();
  await setCatalogItemRegularPrice(stores, {
    catalogItemId: "item-grill",
    amount: usd("1200"),
  });
  await setCatalogItemSalePrice(stores, {
    catalogItemId: "item-grill",
    amount: usd("1000"),
  });

  await assert.rejects(
    clearCatalogItemRegularPrice(stores, { catalogItemId: "item-grill" }),
    (error) => error instanceof CatalogError && error.code === "REGULAR_HAS_SALE",
  );
  assert.equal(stores.prices.deletes.length, 0);

  await clearCatalogItemSalePrice(stores, { catalogItemId: "item-grill" });
  const cleared = await clearCatalogItemRegularPrice(stores, {
    catalogItemId: "item-grill",
  });
  const alreadyGone = await clearCatalogItemRegularPrice(stores, {
    catalogItemId: "item-grill",
  });

  assert.equal(cleared.changed, true);
  assert.equal(cleared.price, null);
  assert.equal(alreadyGone.changed, false);
  assert.deepEqual(await resolveCatalogItemPrice(stores.prices, "item-grill"), {
    catalogItemId: "item-grill",
    listable: false,
  });
  assert.equal(stores.prices.deletes.length, 1);
});

test("Sale cannot exist on a free Regular and lowering Regular below Sale is refused", async () => {
  const stores = storage();
  await setCatalogItemRegularPrice(stores, {
    catalogItemId: "item-grill",
    amount: usd("0"),
  });
  await assert.rejects(
    setCatalogItemSalePrice(stores, { catalogItemId: "item-grill", amount: usd("0") }),
    (error) =>
      error instanceof CatalogError && error.code === "SALE_NOT_LOWER_THAN_REGULAR",
  );

  await setCatalogItemRegularPrice(stores, {
    catalogItemId: "item-grill",
    amount: usd("1200"),
  });
  await setCatalogItemSalePrice(stores, {
    catalogItemId: "item-grill",
    amount: usd("1000"),
  });
  await assert.rejects(
    setCatalogItemRegularPrice(stores, {
      catalogItemId: "item-grill",
      amount: usd("900"),
    }),
    (error) =>
      error instanceof CatalogError && error.code === "SALE_NOT_LOWER_THAN_REGULAR",
  );
});

test("price writes reject malformed Money and unknown catalog items", async () => {
  const stores = storage();
  for (const amount of [
    { currency: "USD", minor: 1200 },
    { currency: "usd", minor: "1200" },
    { currency: "EUR", minor: "1200" },
    { currency: "USD", minor: "12.00" },
    { currency: "USD", minor: "01200" },
    { currency: "USD", minor: "-1" },
    { currency: "USD" },
  ]) {
    await assert.rejects(
      setCatalogItemRegularPrice(stores, { catalogItemId: "item-grill", amount }),
      (error) => error instanceof CatalogError && error.code === "INVALID_INPUT",
    );
  }
  await assert.rejects(
    setCatalogItemRegularPrice(storage(catalogItem({ itemId: "other" })), {
      catalogItemId: "item-grill",
      amount: usd("1200"),
    }),
    (error) => error instanceof CatalogError && error.code === "CATALOG_ITEM_NOT_FOUND",
  );
  assert.equal(stores.prices.puts.length, 0);
});

test("price routes are private POST actions that do not rewrite the catalog row", async () => {
  const plugin = createPlugin();
  const catalog = new MemoryCollection([catalogItem()]);
  const prices = new MemoryCollection();
  const context = {
    storage: { catalogItems: catalog, catalogPrices: prices },
  };

  assert.equal(plugin.storage[CATALOG_PRICES_COLLECTION].uniqueIndexes.length, 0);
  for (const [path, route] of [
    [SET_CATALOG_ITEM_REGULAR_PRICE_ROUTE, plugin.routes[SET_CATALOG_ITEM_REGULAR_PRICE_ROUTE]],
    [SET_CATALOG_ITEM_SALE_PRICE_ROUTE, plugin.routes[SET_CATALOG_ITEM_SALE_PRICE_ROUTE]],
    [CLEAR_CATALOG_ITEM_SALE_PRICE_ROUTE, plugin.routes[CLEAR_CATALOG_ITEM_SALE_PRICE_ROUTE]],
    [
      CLEAR_CATALOG_ITEM_REGULAR_PRICE_ROUTE,
      plugin.routes[CLEAR_CATALOG_ITEM_REGULAR_PRICE_ROUTE],
    ],
  ]) {
    assert.equal(route.public, undefined);
    assert.equal(route.permission, "content:edit_any");
    await assert.rejects(
      route.handler({
        ...context,
        input: { catalogItemId: "item-grill", amount: usd("1200") },
        request: new Request(`https://example.test/${path}`, { method: "GET" }),
      }),
      (error) => error instanceof PluginRouteError && error.status === 405,
    );
  }

  await plugin.routes[SET_CATALOG_ITEM_REGULAR_PRICE_ROUTE].handler({
    ...context,
    input: { catalogItemId: "item-grill", amount: usd("1200") },
    request: new Request("https://example.test/set-regular-price", { method: "POST" }),
  });
  await plugin.routes[SET_CATALOG_ITEM_SALE_PRICE_ROUTE].handler({
    ...context,
    input: { catalogItemId: "item-grill", amount: usd("1000") },
    request: new Request("https://example.test/set-sale-price", { method: "POST" }),
  });
  await plugin.routes[CLEAR_CATALOG_ITEM_SALE_PRICE_ROUTE].handler({
    ...context,
    input: { catalogItemId: "item-grill" },
    request: new Request("https://example.test/clear-sale-price", { method: "POST" }),
  });
  await plugin.routes[CLEAR_CATALOG_ITEM_REGULAR_PRICE_ROUTE].handler({
    ...context,
    input: { catalogItemId: "item-grill" },
    request: new Request("https://example.test/clear-regular-price", { method: "POST" }),
  });

  assert.equal(catalog.puts.length, 0);
  assert.equal(prices.records.has("item-grill"), false);
});
