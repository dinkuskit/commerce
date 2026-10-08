export * from "./kernel/index.js";
export { configureCatalogItemInventory } from "./configure-inventory.js";
export {
  createStoreInventoryConfiguration,
  storeInventoryConfigurationUniqueIndexName,
} from "./store-configuration.js";
export type { StoreInventoryConfigurationUniqueField } from "./store-configuration.js";
export type {
  ConfigureCatalogItemInventoryResult,
  ConfigureInventoryCatalogStorage,
  ConfigureInventoryClaimStorage,
  ConfigureInventoryExecution,
} from "./types.js";
export {
  CONFIGURE_INVENTORY_ROUTE,
  createConfigureInventoryRoute,
} from "./route.js";
