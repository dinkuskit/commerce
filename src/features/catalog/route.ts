import { PluginRouteError, type PluginRoute, type StorageCollection } from "emdash";

import { createCatalogItem } from "./create-catalog-item.js";
import { CatalogError } from "./errors.js";
import { setCatalogItemManualAvailability } from "./manual-availability.js";
import { setCatalogItemBackorders } from "./set-backorders.js";
import type {
  CatalogBackorderPolicyRecord,
  CatalogManualAvailabilityRecord,
  CatalogStorageRecord,
} from "./types.js";

export const CREATE_CATALOG_ITEM_ROUTE = "catalog-items/create";
export const SET_CATALOG_ITEM_BACKORDERS_ROUTE = "catalog-items/set-backorders";
export const SET_CATALOG_ITEM_MANUAL_AVAILABILITY_ROUTE =
  "catalog-items/set-manual-availability";

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

export const setCatalogItemBackordersRoute: PluginRoute = {
  permission: "content:edit_any",
  handler: async (ctx) => {
    if (ctx.request.method.toUpperCase() !== "POST") {
      throw new PluginRouteError(
        "METHOD_NOT_ALLOWED",
        "backorder setting requires POST",
        405,
      );
    }
    try {
      return await setCatalogItemBackorders(
        {
          catalog: ctx.storage.catalogItems as StorageCollection<CatalogStorageRecord>,
          policies: ctx.storage
            .catalogBackorderPolicies as StorageCollection<CatalogBackorderPolicyRecord>,
        },
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

export const setCatalogItemManualAvailabilityRoute: PluginRoute = {
  permission: "content:edit_any",
  handler: async (ctx) => {
    if (ctx.request.method.toUpperCase() !== "POST") {
      throw new PluginRouteError(
        "METHOD_NOT_ALLOWED",
        "manual availability setting requires POST",
        405,
      );
    }
    try {
      return await setCatalogItemManualAvailability(
        {
          catalog: ctx.storage.catalogItems as StorageCollection<CatalogStorageRecord>,
          availability: ctx.storage
            .catalogManualAvailability as StorageCollection<CatalogManualAvailabilityRecord>,
        },
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
