import assert from "node:assert/strict";
import test from "node:test";
import React from "react";

import * as admin from "@dinkuskit/commerce/admin";
import * as commerce from "@dinkuskit/commerce";

test("built ./admin export exposes the native React admin pages contract", () => {
  assert.ok(admin, "admin module should exist");
  assert.ok(admin.pages, "admin.pages object should be exported");
  assert.equal(typeof admin.pages, "object");

  // Check /products page
  assert.ok(admin.pages["/products"], "pages['/products'] should exist");
  assert.equal(typeof admin.pages["/products"], "function");
  assert.equal(admin.pages["/products"].name, "ProductsPage");

  // Check /store page
  assert.ok(admin.pages["/store"], "pages['/store'] should exist");
  assert.equal(typeof admin.pages["/store"], "function");
  assert.equal(admin.pages["/store"].name, "StorePage");

  // Verify elements can be created with React
  const productsElement = React.createElement(admin.pages["/products"]);
  assert.ok(React.isValidElement(productsElement));
  assert.equal(productsElement.type, admin.pages["/products"]);

  const storeElement = React.createElement(admin.pages["/store"]);
  assert.ok(React.isValidElement(storeElement));
  assert.equal(storeElement.type, admin.pages["/store"]);
});

test("built package root descriptor and plugin declare compatible native admin entries", () => {
  const descriptor = commerce.dinkusCommerce();
  assert.equal(descriptor.id, commerce.COMMERCE_PLUGIN_ID);
  assert.equal(descriptor.format, "native");
  assert.equal(descriptor.entrypoint, "@dinkuskit/commerce");
  assert.equal(descriptor.adminEntry, "@dinkuskit/commerce/admin");
  assert.deepEqual(descriptor.adminPages, [
    { path: "/products", label: "Products", icon: "storefront" },
    { path: "/store", label: "Store", icon: "storefront" },
  ]);

  const plugin = commerce.createPlugin();
  assert.equal(plugin.id, commerce.COMMERCE_PLUGIN_ID);
  assert.ok(plugin.admin, "plugin should have admin configuration");
  assert.equal(plugin.admin.entry, "@dinkuskit/commerce/admin");
  assert.deepEqual(plugin.admin.pages, [
    { path: "/products", label: "Products", icon: "storefront" },
    { path: "/store", label: "Store", icon: "storefront" },
  ]);
});
