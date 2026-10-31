import assert from "node:assert/strict";
import test from "node:test";
import { PluginRouteError } from "emdash";

import * as catalog from "../../../dist/features/catalog/index.js";
import * as catalogStorefront from "../../../dist/features/catalog/storefront/index.js";
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
  // The native-only catalog-items/* routes are gone (commerce-one-build-registry-20261031); the store's
  // publish check is the one catalog route both builds share beside the catalog API and the public reads.
  assert.equal(catalog.PRODUCT_PAGE_ON_SALE_ROUTE, "catalog-items/set-on-sale");
  assert.equal(catalog.CREATE_CATALOG_ITEM_ROUTE, undefined);
  assert.equal(catalog.LIST_CATALOG_PRODUCTS_ROUTE, undefined);
  assert.equal(catalog.createCatalogItemRoute, undefined);
  assert.equal(commerce.saveCatalogProductPricesRoute, undefined);
  assert.equal(catalog.DEFAULT_CATALOG_MANUAL_AVAILABILITY, "in-stock");
  assert.equal(typeof commerce.dinkusCommerce, "function");
  assert.equal(typeof commerce.createPlugin, "function");
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
    async get(id) { return id === record.itemId ? record : null; },
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
  const installedContext = {
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
  };
  const response = await catalog.readPublicCatalog(installedContext);
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

  const native = commerce.createPlugin();
  const publicRoute = native.routes[catalogStorefront.PUBLIC_CATALOG_ROUTE];
  const itemRoute = native.routes[catalogStorefront.PUBLIC_CATALOG_ITEM_ROUTE];
  assert.equal(publicRoute.public, true);
  assert.deepEqual(publicRoute.methods, ["GET"]);
  assert.deepEqual(publicRoute.request, { body: "none" });
  assert.equal(publicRoute.cacheControl, "no-store");
  assert.equal(itemRoute.public, true);
  assert.deepEqual(itemRoute.methods, ["GET"]);
  assert.deepEqual(itemRoute.request, { body: "none" });
  assert.equal(itemRoute.cacheControl, "no-store");

  const nativeCatalog = await publicRoute.handler(installedContext);
  assert.deepEqual(nativeCatalog, response);
  const nativeItem = await itemRoute.handler({
    ...installedContext,
    request: new Request(
      "http://127.0.0.1/catalog/public/item?itemId=item-public",
      { method: "GET" },
    ),
  });
  assert.deepEqual(nativeItem, response.products[0]);
  const nativeUnknownItem = await itemRoute.handler({
    ...installedContext,
    request: new Request(
      "http://127.0.0.1/catalog/public/item?itemId=missing",
      { method: "GET" },
    ),
  });
  assert.equal(nativeUnknownItem, null);

  // By page: the page's last sale names the product, and the product names that page back.
  const pages = { async get(id) { return id === "p:page-public" ? { entryId: "page-public", catalogItemId: "item-public" } : null; } };
  const byPage = (query) => itemRoute.handler({
    ...installedContext,
    storage: { ...installedContext.storage, product_pages: pages },
    request: new Request(`http://127.0.0.1/catalog/public/item?${query}`, { method: "GET" }),
  });
  assert.equal(await byPage("pageId=page-public"), null, "a product that names no page is no page's");
  record.pageId = "page-public";
  assert.deepEqual(await byPage("pageId=page-public"), { ...response.products[0], page: "page-public" });
  assert.equal((await catalog.readPublicCatalog(installedContext)).products[0].page, "page-public");
  assert.equal(await byPage("pageId=page-other"), null);
  for (const query of ["pageId=page-public&itemId=item-public", "pageId=a&pageId=b", "itemId=a&itemId=b", ""]) {
    await assert.rejects(byPage(query), /Invalid catalog item query/);
  }
});
