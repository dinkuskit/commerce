import assert from "node:assert/strict";
import test from "node:test";

import * as catalog from "../../../dist/features/catalog/index.js";
import * as commerce from "../../../dist/index.js";

test("the package root and feature entry expose the same catalog contract", () => {
  assert.equal(commerce.CATALOG_FEATURE_ID, "dinkus.catalog");
  assert.equal(catalog.CATALOG_FEATURE_ID, commerce.CATALOG_FEATURE_ID);
  assert.equal(catalog.createCatalogItem, commerce.createCatalogItem);
  assert.equal(catalog.setCatalogItemBackorders, commerce.setCatalogItemBackorders);
  assert.equal(catalog.CREATE_CATALOG_ITEM_ROUTE, "catalog-items/create");
  assert.equal(catalog.SET_CATALOG_ITEM_BACKORDERS_ROUTE, "catalog-items/set-backorders");
  assert.equal(typeof commerce.dinkusCommerce, "function");
  assert.equal(typeof commerce.createPlugin, "function");
});
