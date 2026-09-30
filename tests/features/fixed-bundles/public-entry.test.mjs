import assert from "node:assert/strict";
import test from "node:test";

import * as commerce from "../../../dist/index.js";
import * as fixedBundles from "../../../dist/features/fixed-bundles/index.js";

test("the package root and feature entry expose the same fixed-bundles contract", () => {
  for (const name of [
    "FIXED_BUNDLES_FEATURE_ID",
    "FixedBundleError",
    "projectFixedBundleFulfillment",
  ]) {
    assert.equal(fixedBundles[name], commerce[name], name);
  }
  assert.equal(fixedBundles.FIXED_BUNDLES_FEATURE_ID, "dinkus.fixed-bundles");
  assert.equal(typeof fixedBundles.projectFixedBundleFulfillment, "function");
  assert.equal(typeof commerce.startCheckout, "function");
  assert.notEqual(Object.hasOwn(fixedBundles, "startCheckout"), true);
  assert.notEqual(Object.hasOwn(fixedBundles, "resolveCatalogItemPrice"), true);
  assert.notEqual(Object.hasOwn(fixedBundles, "reserve"), true);
});
