import { definePlugin, type PluginDescriptor, type ResolvedPlugin } from "emdash";

import {
  CATALOG_UNIQUE_INDEXES,
  COMMERCE_PLUGIN_ID,
  CREATE_CATALOG_ITEM_ROUTE,
  createCatalogItemRoute,
} from "./features/catalog/index.js";

export * from "./features/catalog/index.js";

const COMMERCE_PLUGIN_VERSION = "0.0.0";

export function dinkusCommerce(): PluginDescriptor {
  return {
    id: COMMERCE_PLUGIN_ID,
    version: COMMERCE_PLUGIN_VERSION,
    entrypoint: "@dinkuskit/commerce",
  };
}

export function createPlugin(): ResolvedPlugin {
  return definePlugin({
    id: COMMERCE_PLUGIN_ID,
    version: COMMERCE_PLUGIN_VERSION,
    storage: {
      catalogItems: {
        indexes: [],
        uniqueIndexes: [...CATALOG_UNIQUE_INDEXES],
      },
    },
    routes: {
      [CREATE_CATALOG_ITEM_ROUTE]: createCatalogItemRoute,
    },
  });
}

export default createPlugin;
