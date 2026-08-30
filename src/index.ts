import { definePlugin, type PluginDescriptor, type ResolvedPlugin } from "emdash";

import {
  CATALOG_UNIQUE_INDEXES,
  COMMERCE_PLUGIN_ID,
  CREATE_CATALOG_ITEM_ROUTE,
  createCatalogItemRoute,
} from "./features/catalog/index.js";
import {
  MANAGED_SKU_REGISTRATION_CLAIMS_COLLECTION,
  MANAGED_SKU_REGISTRATION_CLAIM_UNIQUE_INDEXES,
} from "./features/inventory-provider/index.js";
import {
  CONFIGURE_INVENTORY_ROUTE,
  STORE_INVENTORY_CONFIGURATIONS_COLLECTION,
  STORE_INVENTORY_CONFIGURATION_UNIQUE_INDEXES,
  createConfigureInventoryRoute,
  type ConfigureInventoryExecution,
} from "./features/inventory-setup/index.js";

export * from "./features/inventory-provider/index.js";

export * from "./features/catalog/index.js";

export * from "./features/inventory-setup/index.js";

const COMMERCE_PLUGIN_VERSION = "0.0.0";

export function dinkusCommerce(): PluginDescriptor {
  return {
    id: COMMERCE_PLUGIN_ID,
    version: COMMERCE_PLUGIN_VERSION,
    entrypoint: "@dinkuskit/commerce",
  };
}

export interface CommercePluginOptions {
  inventorySetup?: ConfigureInventoryExecution;
}

export function createPlugin(options: CommercePluginOptions = {}): ResolvedPlugin {
  return definePlugin({
    id: COMMERCE_PLUGIN_ID,
    version: COMMERCE_PLUGIN_VERSION,
    storage: {
      catalogItems: {
        indexes: [],
        uniqueIndexes: [...CATALOG_UNIQUE_INDEXES],
      },
      [MANAGED_SKU_REGISTRATION_CLAIMS_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [...MANAGED_SKU_REGISTRATION_CLAIM_UNIQUE_INDEXES],
      },
      [STORE_INVENTORY_CONFIGURATIONS_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [...STORE_INVENTORY_CONFIGURATION_UNIQUE_INDEXES],
      },
    },
    routes: {
      [CREATE_CATALOG_ITEM_ROUTE]: createCatalogItemRoute,
      [CONFIGURE_INVENTORY_ROUTE]: createConfigureInventoryRoute(
        options.inventorySetup,
      ),
    },
  });
}

export default createPlugin;
