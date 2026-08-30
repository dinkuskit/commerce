import assert from "node:assert/strict";
import test from "node:test";

import * as commerce from "../../../dist/index.js";
import * as storefrontAvailability from "../../../dist/features/storefront-availability/index.js";

test("the package root and feature entry expose the same storefront availability contract", () => {
  for (const name of [
    "INVENTORY_SKU_STOCK_READ_RESULT_SCHEMA",
    "STOREFRONT_AVAILABILITY_FEATURE_ID",
    "STOREFRONT_AVAILABILITY_RESULT_SCHEMA",
    "STOREFRONT_AVAILABILITY_SETTINGS_COLLECTION",
    "SET_STOREFRONT_AVAILABILITY_POLICY_ROUTE",
    "StorefrontAvailabilityError",
    "loadStorefrontAvailabilityPolicy",
    "normalizeStorefrontAvailabilityPolicy",
    "resolveManagedStorefrontAvailability",
    "setStorefrontAvailabilityPolicy",
  ]) {
    assert.equal(storefrontAvailability[name], commerce[name], name);
  }
});
