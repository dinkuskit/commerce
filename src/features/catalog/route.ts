import { PluginRouteError, type PluginRoute, type StorageCollection } from "emdash";

import { CatalogError } from "./errors.js";
import { CATALOG_MEDIA_COLLECTION } from "./media.js";
import { PRODUCT_PAGES_COLLECTION, setProductPageOnSale, type ProductPages } from "./product-pages.js";
import {
  CATALOG_BACKORDER_POLICIES_COLLECTION, CATALOG_COLLECTION, CATALOG_MANUAL_AVAILABILITY_COLLECTION, CATALOG_PRICES_COLLECTION,
  PRODUCT_FEED_ELIGIBILITY_COLLECTION, type CatalogStorageRecord,
} from "./types.js";

// The native build's own names for a product's rows (the Registry build uses PRODUCT_ROW_COLLECTIONS).
const NATIVE_PRODUCT_ROW_COLLECTIONS = [CATALOG_PRICES_COLLECTION, CATALOG_MANUAL_AVAILABILITY_COLLECTION,
  CATALOG_BACKORDER_POLICIES_COLLECTION, CATALOG_MEDIA_COLLECTION, PRODUCT_FEED_ELIGIBILITY_COLLECTION];

// The native entry's one catalog route beside the Registry build's shared ones. The native-only catalog
// routes (create, list, prices, media, SKU, identifiers, rename, archive, choices, stock) are gone
// (commerce-one-build-registry-20261031): products are managed through the product panels and the
// private catalog route, on both builds.

function routeFail(code: string, message: string, status: number): never {
  throw new PluginRouteError(code, message, status);
}

function rethrowCatalogRouteError(error: unknown): never {
  if (error instanceof CatalogError) {
    routeFail(error.code, error.message, error.status);
  }
  throw error;
}

/** The store's publish check puts a product on sale when its page is published, and back to Draft when it is not. */
export const setProductPageOnSaleRoute: PluginRoute = {
  public: false,
  permission: "content:publish_any",
  handler: async (ctx) => {
    if (ctx.request.method.toUpperCase() !== "POST") routeFail("METHOD_NOT_ALLOWED", "Product changes require POST", 405);
    try {
      return await setProductPageOnSale({ catalog: ctx.storage[CATALOG_COLLECTION] as StorageCollection<CatalogStorageRecord>,
        pages: ctx.storage[PRODUCT_PAGES_COLLECTION] as ProductPages,
        // A permanent delete clears the product's own rows on this build too, as on the Registry build.
        rows: NATIVE_PRODUCT_ROW_COLLECTIONS.map(name => ctx.storage[name] as StorageCollection<unknown>) }, ctx.input);
    } catch (error) {
      rethrowCatalogRouteError(error);
    }
  },
};
