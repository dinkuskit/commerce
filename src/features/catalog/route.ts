import { PluginRouteError, type PluginRoute, type StorageCollection } from "emdash";

import { createCatalogItem } from "./create-catalog-item.js";
import { CatalogError } from "./errors.js";
import type { CatalogStorageRecord } from "./types.js";

export const CREATE_CATALOG_ITEM_ROUTE = "catalog-items/create";

export const createCatalogItemRoute: PluginRoute = {
  permission: "content:create",
  handler: async (ctx) => {
    if (ctx.request.method.toUpperCase() !== "POST") {
      throw new PluginRouteError(
        "METHOD_NOT_ALLOWED",
        "catalog item creation requires POST",
        405,
      );
    }

    try {
      return await createCatalogItem(
        ctx.storage.catalogItems as StorageCollection<CatalogStorageRecord>,
        ctx.input,
      );
    } catch (error) {
      if (error instanceof CatalogError) {
        throw new PluginRouteError(error.code, error.message, error.status);
      }
      throw error;
    }
  },
};
