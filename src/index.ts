import { definePlugin, type PluginDescriptor, type ResolvedPlugin } from "emdash";

import {
  CATALOG_BACKORDER_POLICIES_COLLECTION,
  CATALOG_MANUAL_AVAILABILITY_COLLECTION,
  CATALOG_PRICES_COLLECTION,
  CATALOG_UNIQUE_INDEXES,
  CLEAR_CATALOG_ITEM_REGULAR_PRICE_ROUTE,
  CLEAR_CATALOG_ITEM_SALE_PRICE_ROUTE,
  COMMERCE_PLUGIN_ID,
  CREATE_CATALOG_ITEM_ROUTE,
  LIST_CATALOG_PRODUCTS_ROUTE,
  SAVE_CATALOG_PRODUCT_PRICES_ROUTE,
  SET_CATALOG_ITEM_BACKORDERS_ROUTE,
  SET_CATALOG_ITEM_MANUAL_AVAILABILITY_ROUTE,
  SET_CATALOG_ITEM_REGULAR_PRICE_ROUTE,
  SET_CATALOG_ITEM_SALE_PRICE_ROUTE,
  clearCatalogItemRegularPriceRoute,
  clearCatalogItemSalePriceRoute,
  createCatalogItemRoute,
  listCatalogProductsRoute,
  saveCatalogProductPricesRoute,
  setCatalogItemBackordersRoute,
  setCatalogItemManualAvailabilityRoute,
  setCatalogItemRegularPriceRoute,
  setCatalogItemSalePriceRoute,
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
import {
  SET_STOREFRONT_AVAILABILITY_POLICY_ROUTE,
  STOREFRONT_AVAILABILITY_SETTINGS_COLLECTION,
  setStorefrontAvailabilityPolicyRoute,
} from "./features/storefront-availability/index.js";

export * from "./features/inventory-provider/index.js";

export * from "./features/catalog/index.js";

export * from "./features/inventory-setup/index.js";

export * from "./features/storefront-availability/index.js";

const COMMERCE_PLUGIN_VERSION = "0.0.0";

const COMMERCE_ADMIN_ENTRY = "@dinkuskit/commerce/admin";
const COMMERCE_PRODUCTS_PAGE = {
  path: "/products",
  label: "Products",
  icon: "storefront",
} as const;

export function dinkusCommerce(): PluginDescriptor {
  return {
    id: COMMERCE_PLUGIN_ID,
    version: COMMERCE_PLUGIN_VERSION,
    format: "native",
    entrypoint: "@dinkuskit/commerce",
    adminEntry: COMMERCE_ADMIN_ENTRY,
    adminPages: [COMMERCE_PRODUCTS_PAGE],
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
      [CATALOG_BACKORDER_POLICIES_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [],
      },
      [CATALOG_MANUAL_AVAILABILITY_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [],
      },
      [CATALOG_PRICES_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [],
      },
      [MANAGED_SKU_REGISTRATION_CLAIMS_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [...MANAGED_SKU_REGISTRATION_CLAIM_UNIQUE_INDEXES],
      },
      [STORE_INVENTORY_CONFIGURATIONS_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [...STORE_INVENTORY_CONFIGURATION_UNIQUE_INDEXES],
      },
      [STOREFRONT_AVAILABILITY_SETTINGS_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [],
      },
    },
    admin: {
      entry: COMMERCE_ADMIN_ENTRY,
      pages: [COMMERCE_PRODUCTS_PAGE],
    },
    routes: {
      [CREATE_CATALOG_ITEM_ROUTE]: createCatalogItemRoute,
      [SET_CATALOG_ITEM_BACKORDERS_ROUTE]: setCatalogItemBackordersRoute,
      [SET_CATALOG_ITEM_MANUAL_AVAILABILITY_ROUTE]:
        setCatalogItemManualAvailabilityRoute,
      [SET_CATALOG_ITEM_REGULAR_PRICE_ROUTE]: setCatalogItemRegularPriceRoute,
      [SET_CATALOG_ITEM_SALE_PRICE_ROUTE]: setCatalogItemSalePriceRoute,
      [CLEAR_CATALOG_ITEM_SALE_PRICE_ROUTE]: clearCatalogItemSalePriceRoute,
      [CLEAR_CATALOG_ITEM_REGULAR_PRICE_ROUTE]:
        clearCatalogItemRegularPriceRoute,
      [LIST_CATALOG_PRODUCTS_ROUTE]: listCatalogProductsRoute,
      [SAVE_CATALOG_PRODUCT_PRICES_ROUTE]: saveCatalogProductPricesRoute,
      [CONFIGURE_INVENTORY_ROUTE]: createConfigureInventoryRoute(
        options.inventorySetup,
      ),
      [SET_STOREFRONT_AVAILABILITY_POLICY_ROUTE]:
        setStorefrontAvailabilityPolicyRoute,
    },
  });
}

export default createPlugin;
