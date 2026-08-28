import assert from "node:assert/strict";
import test from "node:test";

import * as commerce from "../../../dist/index.js";
import * as inventoryProvider from "../../../dist/features/inventory-provider/index.js";

test("the package root and feature entry expose the same inventory-provider contract", () => {
  assert.equal(inventoryProvider.INVENTORY_PROVIDER_FEATURE_ID, "dinkus.inventory-provider");
  assert.equal(
    inventoryProvider.INVENTORY_PROVIDER_FEATURE_ID,
    commerce.INVENTORY_PROVIDER_FEATURE_ID,
  );
  assert.equal(inventoryProvider.setManageStock, commerce.setManageStock);
  assert.equal(
    inventoryProvider.normalizeInventoryProviderBinding,
    commerce.normalizeInventoryProviderBinding,
  );
});
