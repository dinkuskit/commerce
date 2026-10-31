import { PluginRouteError, type PluginRoute, type StorageCollection } from "emdash";

import { CatalogError } from "./errors.js";
import { PRODUCT_PAGES_COLLECTION, setProductPageOnSale, type ProductPages } from "./product-pages.js";
import type { CatalogStorageRecord } from "./types.js";

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
      return await setProductPageOnSale({ catalog: ctx.storage.catalogItems as StorageCollection<CatalogStorageRecord>,
        pages: ctx.storage[PRODUCT_PAGES_COLLECTION] as ProductPages }, ctx.input);
    } catch (error) {
      rethrowCatalogRouteError(error);
    }
  },
};
