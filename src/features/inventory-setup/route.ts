import {
  PluginRouteError,
  type PluginRoute,
  type StorageCollection,
} from "emdash";

import type { CatalogStorageRecord } from "../catalog/index.js";
import {
  ManagedSkuRegistrationError,
  type ManagedSkuRegistrationClaimRecord,
} from "../inventory-provider/index.js";
import { configureCatalogItemInventory } from "./configure-inventory.js";
import { InventorySetupError } from "./errors.js";
import type {
  ConfigureInventoryExecution,
  StoreInventoryConfigurationStorageRecord,
} from "./types.js";

export const CONFIGURE_INVENTORY_ROUTE = "catalog-items/configure-inventory";

function routeError(error: ManagedSkuRegistrationError): PluginRouteError {
  const status =
    error.code === "INVALID_REGISTRATION"
      ? 400
      : error.code === "INVALID_TRANSITION"
        ? 409
        : 503;
  return new PluginRouteError(error.code, error.message, status);
}

export function createConfigureInventoryRoute(
  execution: ConfigureInventoryExecution = {},
): PluginRoute {
  return {
    permission: "content:edit_any",
    handler: async (ctx) => {
      if (ctx.request.method.toUpperCase() !== "POST") {
        throw new PluginRouteError(
          "METHOD_NOT_ALLOWED",
          "Configure Inventory requires POST",
          405,
        );
      }
      try {
        return await configureCatalogItemInventory(
          {
            catalog: ctx.storage.catalogItems as StorageCollection<CatalogStorageRecord>,
            configurations: ctx.storage
              .storeInventoryConfigurations as StorageCollection<StoreInventoryConfigurationStorageRecord>,
            claims: ctx.storage
              .managedSkuClaims as StorageCollection<ManagedSkuRegistrationClaimRecord>,
          },
          ctx.input,
          execution,
        );
      } catch (error) {
        if (error instanceof InventorySetupError) {
          throw new PluginRouteError(error.code, error.message, error.status);
        }
        if (error instanceof ManagedSkuRegistrationError) throw routeError(error);
        throw error;
      }
    },
  };
}
