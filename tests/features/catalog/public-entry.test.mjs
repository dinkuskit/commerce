import assert from "node:assert/strict";
import test from "node:test";
import { PluginRouteError } from "emdash";

import * as catalog from "../../../dist/features/catalog/index.js";
import * as commerce from "../../../dist/index.js";

test("the package root and feature entry expose the same catalog contract", () => {
  assert.equal(commerce.CATALOG_FEATURE_ID, "dinkus.catalog");
  assert.equal(catalog.CATALOG_FEATURE_ID, commerce.CATALOG_FEATURE_ID);
  assert.equal(catalog.createCatalogItem, commerce.createCatalogItem);
  assert.equal(catalog.setCatalogItemBackorders, commerce.setCatalogItemBackorders);
  assert.equal(
    catalog.setCatalogItemManualAvailability,
    commerce.setCatalogItemManualAvailability,
  );
  assert.equal(
    catalog.loadCatalogItemManualAvailability,
    commerce.loadCatalogItemManualAvailability,
  );
  assert.equal(catalog.setCatalogItemRegularPrice, commerce.setCatalogItemRegularPrice);
  assert.equal(catalog.setCatalogItemSalePrice, commerce.setCatalogItemSalePrice);
  assert.equal(catalog.resolveCatalogItemPrice, commerce.resolveCatalogItemPrice);
  assert.equal(catalog.CREATE_CATALOG_ITEM_ROUTE, "catalog-items/create");
  assert.equal(catalog.SET_CATALOG_ITEM_BACKORDERS_ROUTE, "catalog-items/set-backorders");
  assert.equal(
    catalog.SET_CATALOG_ITEM_MANUAL_AVAILABILITY_ROUTE,
    "catalog-items/set-manual-availability",
  );
  assert.equal(
    catalog.SET_CATALOG_ITEM_REGULAR_PRICE_ROUTE,
    "catalog-items/set-regular-price",
  );
  assert.equal(catalog.SET_CATALOG_ITEM_SALE_PRICE_ROUTE, "catalog-items/set-sale-price");
  assert.equal(catalog.DEFAULT_CATALOG_MANUAL_AVAILABILITY, "in-stock");
  assert.equal(typeof commerce.dinkusCommerce, "function");
  assert.equal(typeof commerce.createPlugin, "function");
});

test("built public catalog entry keeps default-disabled route objects with handlers", async () => {
  const named = [
    ["createCatalogItemRoute", catalog.createCatalogItemRoute, commerce.createCatalogItemRoute],
    ["listCatalogProductsRoute", catalog.listCatalogProductsRoute, commerce.listCatalogProductsRoute],
    [
      "saveCatalogProductPricesRoute",
      catalog.saveCatalogProductPricesRoute,
      commerce.saveCatalogProductPricesRoute,
    ],
  ];
  for (const [name, featureRoute, rootRoute] of named) {
    assert.equal(typeof featureRoute, "object", `${name} feature export must be a route object`);
    assert.equal(typeof rootRoute, "object", `${name} root export must be a route object`);
    assert.equal(typeof featureRoute.handler, "function", `${name}.handler must be defined`);
    assert.equal(typeof rootRoute.handler, "function", `${name}.handler must be defined`);
    assert.equal(featureRoute.permission, rootRoute.permission);
  }
  assert.equal(typeof catalog.createCatalogItemRouteWithLocalStock, "function");
  assert.equal(typeof catalog.createListCatalogProductsRouteWithLocalStock, "function");
  assert.equal(typeof catalog.createSaveCatalogProductPricesRouteWithLocalStock, "function");

  const records = new Map([
    [
      "item-public",
      {
        recordKind: "catalog-item",
        itemId: "item-public",
        commandId: "catalog:create:public",
        creationIntent: { manageStock: false },
        kind: "simple-product",
        name: "Public Safe",
        sku: "PUBLIC-SAFE",
        skuKey: "PUBLIC-SAFE",
        stockManagement: { mode: "unmanaged" },
        state: "draft",
        createdAt: "2026-09-26T00:00:00.000Z",
      },
    ],
  ]);
  const catalogItems = {
    async get(id) {
      return records.has(id) ? structuredClone(records.get(id)) : null;
    },
    async put(id, data) {
      records.set(id, structuredClone(data));
    },
    async query() {
      return {
        items: [...records.entries()].map(([id, data]) => ({ id, data: structuredClone(data) })),
        hasMore: false,
      };
    },
  };
  const empty = {
    async get() {
      return null;
    },
    async put() {},
    async query() {
      return { items: [], hasMore: false };
    },
  };
  const before = structuredClone(records.get("item-public"));

  await assert.rejects(
    catalog.createCatalogItemRoute.handler({
      storage: { catalogItems },
      input: {
        commandId: "cmd:public-enable",
        name: "Public Enable",
        sku: "PUBLIC-ENABLE",
        manageStock: true,
      },
      request: new Request(
        "http://127.0.0.1/catalog-items/create?enableLocalStockManagement=true",
        { method: "POST" },
      ),
      site: { url: "http://127.0.0.1" },
    }),
    (error) =>
      error instanceof PluginRouteError &&
      error.code === "MANAGE_STOCK_UNAVAILABLE" &&
      error.message === catalog.MANAGE_STOCK_UNAVAILABLE_MESSAGE,
  );
  assert.equal(records.size, 1);
  assert.deepEqual(records.get("item-public"), before);

  const listed = await catalog.listCatalogProductsRoute.handler({
    storage: {
      catalogItems,
      catalogPrices: empty,
      catalogManualAvailability: empty,
      managedSkuClaims: empty,
    },
    input: {},
    request: new Request("http://127.0.0.1/catalog-items/list", { method: "POST" }),
    site: { url: "http://127.0.0.1" },
  });
  assert.deepEqual(listed.manageStockControl, { enabled: false });
  await assert.rejects(
    catalog.saveCatalogProductPricesRoute.handler({
      storage: {
        catalogItems,
        catalogPrices: empty,
        catalogManualAvailability: empty,
        managedSkuClaims: empty,
      },
      input: {
        catalogItemId: "item-public",
        regular: "12",
        sale: "",
        manageStock: true,
      },
      request: new Request("http://127.0.0.1/catalog-items/save-prices", { method: "POST" }),
      site: { url: "http://127.0.0.1" },
    }),
    (error) =>
      error instanceof PluginRouteError &&
      error.message === catalog.MANAGE_STOCK_UNAVAILABLE_MESSAGE,
  );
  assert.deepEqual(records.get("item-public"), before);
});

test("installed public catalog projects only priced listable products", async () => {
  const record = {
    recordKind: "catalog-item",
    itemId: "item-public",
    commandId: "catalog:create:installed",
    creationIntent: { manageStock: false },
    kind: "simple-product",
    name: "Installed Product",
    sku: "INSTALLED-1",
    skuKey: "INSTALLED-1",
    stockManagement: { mode: "unmanaged" },
    state: "draft",
    createdAt: "2026-10-07T00:00:00.000Z",
  };
  const catalogItems = {
    async query() { return { items: [{ id: record.itemId, data: record }], hasMore: false }; },
    async get() { return record; },
  };
  const prices = {
    async get() {
      return {
        recordKind: "catalog-price", recordId: record.itemId,
        catalogItemId: record.itemId, regular: { currency: "USD", minor: "1250" },
      };
    },
  };
  const empty = { async get() { return null; }, async query() { return { items: [], hasMore: false }; } };
  const response = await catalog.readPublicCatalog({
    storage: {
      catalog_items: catalogItems,
      catalog_prices: prices,
      catalog_manual_availability: empty,
      catalog_backorder_policies: empty,
      store_inventory_configurations: empty,
      storefront_availability_settings: empty,
      storefront_out_of_stock_listing: empty,
      catalog_media: empty,
      storefront_placeholder_image: empty,
    },
    request: new Request("http://127.0.0.1/catalog/public", { method: "GET" }),
    site: { url: "http://127.0.0.1" },
  });
  assert.deepEqual(response, {
    products: [{
      id: "item-public",
      name: "Installed Product",
      sku: "INSTALLED-1",
      price: { currency: "USD", minor: "1250" },
      availability: { status: "in-stock", sellable: true, listable: true },
      image: null,
      gallery: [],
    }],
  });
});
