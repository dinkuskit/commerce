import assert from "node:assert/strict";
import test from "node:test";

import * as commerce from "../../../dist/index.js";
import * as inventorySetup from "../../../dist/features/inventory-setup/index.js";

test("the package root and feature entry expose the same inventory-setup contract", () => {
  for (const name of [
    "CONFIGURE_INVENTORY_ROUTE",
    "INVENTORY_SETUP_FEATURE_ID",
    "InventorySetupError",
    "STORE_INVENTORY_CONFIGURATIONS_COLLECTION",
    "STORE_INVENTORY_CONFIGURATION_UNIQUE_INDEXES",
    "configureCatalogItemInventory",
    "createConfigureInventoryRoute",
    "createStoreInventoryConfiguration",
    "loadStoreInventoryConfiguration",
    "storeInventoryConfigurationUniqueIndexName",
  ]) {
    assert.equal(inventorySetup[name], commerce[name], name);
  }
});
