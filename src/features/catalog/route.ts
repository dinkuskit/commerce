import { PluginRouteError, type PluginRoute, type StorageCollection } from "emdash";

import { catalogRoot } from "./product-state.js";
import { createCatalogItem } from "./create-catalog-item.js";
import { CatalogError } from "./errors.js";
import { setCatalogItemManualAvailability } from "./manual-availability.js";
import {
  clearCatalogItemRegularPrice,
  clearCatalogItemSalePrice,
  setCatalogItemRegularPrice,
  setCatalogItemSalePrice,
} from "./price.js";
import { bulkSaveCatalogProductPrices, listCatalogProducts, saveCatalogProductPrices } from "./product-admin.js";
import {
  isLocalStockManagementEnabled,
  manageStockControlFromAdmission,
  readLocalStockAdmission,
  type LocalStockHostOptions,
} from "./local-stock-development.js";
import {
  admitV1CatalogCreateInput,
  admitV1CatalogPriceSaveInput,
  isManagedCatalogRecord,
} from "./v1-stock-admission.js";
import { setCatalogItemBackorders } from "./set-backorders.js";
import { saveCatalogItemMedia, type CatalogMediaStorage } from "./media.js";
import { setCatalogItemSku } from "./set-sku.js";
import { renameCatalogProduct, setCatalogProductArchived } from "./product-edit.js";
import { PRODUCT_PAGES_COLLECTION, setProductPageOnSale, type ProductPages } from "./product-pages.js";
import { setCatalogItemIdentifiers } from "./set-identifiers.js";
import { addCatalogVariantOption, updateCatalogVariantLabels } from "./variants.js";
import {
  CLEAR_CATALOG_ITEM_REGULAR_PRICE_ROUTE,
  CLEAR_CATALOG_ITEM_SALE_PRICE_ROUTE,
  CREATE_CATALOG_ITEM_ROUTE,
  LIST_CATALOG_PRODUCTS_ROUTE,
  SAVE_CATALOG_ITEM_MEDIA_ROUTE,
  SET_CATALOG_ITEM_SKU_ROUTE,
  SET_CATALOG_ITEM_IDENTIFIERS_ROUTE,
  ADD_CATALOG_VARIANT_OPTION_ROUTE,
  UPDATE_CATALOG_VARIANT_LABELS_ROUTE,
  BULK_SAVE_CATALOG_PRODUCT_PRICES_ROUTE,
  SAVE_CATALOG_PRODUCT_PRICES_ROUTE,
  SET_CATALOG_ITEM_BACKORDERS_ROUTE,
  SET_CATALOG_ITEM_MANUAL_AVAILABILITY_ROUTE,
  SET_CATALOG_ITEM_REGULAR_PRICE_ROUTE,
  SET_CATALOG_ITEM_SALE_PRICE_ROUTE,
} from "./route-ids.js";
import {
  releaseManagedSkuRegistrationClaims,
  type ManagedSkuRegistrationClaimRecord,
} from "../inventory-provider/index.js";
import type {
  CatalogBackorderPolicyRecord,
  CatalogManualAvailabilityRecord,
  CatalogPriceRecord,
  CatalogStorageRecord,
} from "./types.js";

function routeFail(code: string, message: string, status: number): never {
  throw new PluginRouteError(code, message, status);
}

function rethrowCatalogRouteError(error: unknown): never {
  if (error instanceof CatalogError) {
    routeFail(error.code, error.message, error.status);
  }
  throw error;
}

export {
  CLEAR_CATALOG_ITEM_REGULAR_PRICE_ROUTE,
  CLEAR_CATALOG_ITEM_SALE_PRICE_ROUTE,
  CREATE_CATALOG_ITEM_ROUTE,
  LIST_CATALOG_PRODUCTS_ROUTE,
  SAVE_CATALOG_ITEM_MEDIA_ROUTE,
  SET_CATALOG_ITEM_SKU_ROUTE,
  SAVE_CATALOG_PRODUCT_PRICES_ROUTE,
  SET_CATALOG_ITEM_BACKORDERS_ROUTE,
  SET_CATALOG_ITEM_MANUAL_AVAILABILITY_ROUTE,
  SET_CATALOG_ITEM_REGULAR_PRICE_ROUTE,
  SET_CATALOG_ITEM_SALE_PRICE_ROUTE,
};

export function createCatalogItemRouteWithLocalStock(
  options: LocalStockHostOptions = {},
): PluginRoute {
  return {
    public: false,
    permission: "content:create",
    handler: async (ctx) => {
      if (ctx.request.method.toUpperCase() !== "POST") {
        routeFail("METHOD_NOT_ALLOWED", "catalog item creation requires POST", 405);
      }

      try {
        return await createCatalogItem(
          ctx.storage.catalogItems as StorageCollection<CatalogStorageRecord>,
          admitV1CatalogCreateInput(
            ctx.input,
            isLocalStockManagementEnabled(readLocalStockAdmission(options, ctx)),
          ),
        );
      } catch (error) {
        rethrowCatalogRouteError(error);
      }
    },
  };
}

export const createCatalogItemRoute: PluginRoute = createCatalogItemRouteWithLocalStock();

export const setCatalogItemBackordersRoute: PluginRoute = {
  public: false,
  permission: "content:edit_any",
  handler: async (ctx) => {
    if (ctx.request.method.toUpperCase() !== "POST") {
      routeFail("METHOD_NOT_ALLOWED", "backorder setting requires POST", 405);
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
      rethrowCatalogRouteError(error);
    }
  },
};

export const setCatalogItemManualAvailabilityRoute: PluginRoute = {
  public: false,
  permission: "content:edit_any",
  handler: async (ctx) => {
    if (ctx.request.method.toUpperCase() !== "POST") {
      routeFail("METHOD_NOT_ALLOWED", "manual availability setting requires POST", 405);
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
      rethrowCatalogRouteError(error);
    }
  },
};

function priceStorage(ctx: Parameters<PluginRoute["handler"]>[0]) {
  return {
    catalog: ctx.storage.catalogItems as StorageCollection<CatalogStorageRecord>,
    prices: ctx.storage.catalogPrices as StorageCollection<CatalogPriceRecord>,
  };
}

function productSaveStorage(ctx: Parameters<PluginRoute["handler"]>[0]) {
  const claims = ctx.storage.managedSkuClaims as StorageCollection<ManagedSkuRegistrationClaimRecord>;
  return {
    ...priceStorage(ctx),
    availability: ctx.storage
      .catalogManualAvailability as StorageCollection<CatalogManualAvailabilityRecord>,
    releaseRegistrationClaims: async (catalogItemId: string) => {
      await releaseManagedSkuRegistrationClaims(claims, { catalogItemId });
    },
  };
}

function catalogPriceRoute(
  action: typeof setCatalogItemRegularPrice,
  methodMessage: string,
): PluginRoute {
  return {
    public: false,
    permission: "content:edit_any",
    handler: async (ctx) => {
      if (ctx.request.method.toUpperCase() !== "POST") {
        routeFail("METHOD_NOT_ALLOWED", methodMessage, 405);
      }
      try {
        return await action(priceStorage(ctx), ctx.input);
      } catch (error) {
        rethrowCatalogRouteError(error);
      }
    },
  };
}

export const setCatalogItemRegularPriceRoute = catalogPriceRoute(
  setCatalogItemRegularPrice,
  "regular price setting requires POST",
);
export const setCatalogItemSalePriceRoute = catalogPriceRoute(
  setCatalogItemSalePrice,
  "sale price setting requires POST",
);
export const clearCatalogItemSalePriceRoute = catalogPriceRoute(
  clearCatalogItemSalePrice,
  "sale price clear requires POST",
);
export const clearCatalogItemRegularPriceRoute = catalogPriceRoute(
  clearCatalogItemRegularPrice,
  "regular price clear requires POST",
);

export function createListCatalogProductsRouteWithLocalStock(
  options: LocalStockHostOptions = {},
): PluginRoute {
  return {
    public: false,
    permission: "content:edit_any",
    handler: async (ctx) => {
      const method = ctx.request.method.toUpperCase();
      if (method !== "GET" && method !== "POST") {
        routeFail("METHOD_NOT_ALLOWED", "product list requires GET or POST", 405);
      }
      try {
        const listed = await listCatalogProducts(productSaveStorage(ctx));
        return {
          ...listed,
          manageStockControl: manageStockControlFromAdmission(
            readLocalStockAdmission(options, ctx),
          ),
        };
      } catch (error) {
        rethrowCatalogRouteError(error);
      }
    },
  };
}

export const listCatalogProductsRoute: PluginRoute =
  createListCatalogProductsRouteWithLocalStock();

export function createSaveCatalogProductPricesRouteWithLocalStock(
  options: LocalStockHostOptions = {},
): PluginRoute {
  return {
    public: false,
    permission: "content:edit_any",
    handler: async (ctx) => {
      if (ctx.request.method.toUpperCase() !== "POST") {
        routeFail("METHOD_NOT_ALLOWED", "price save requires POST", 405);
      }
      try {
        const input =
          typeof ctx.input === "object" && ctx.input !== null && !Array.isArray(ctx.input)
            ? (ctx.input as Record<string, unknown>)
            : null;
        const catalogItemId =
          typeof input?.catalogItemId === "string" ? input.catalogItemId.trim() : "";
        const current = catalogItemId
          ? (await catalogRoot(ctx.storage.catalogItems as StorageCollection<CatalogStorageRecord>, catalogItemId)).current
          : null;
        return await saveCatalogProductPrices(
          productSaveStorage(ctx),
          admitV1CatalogPriceSaveInput(
            ctx.input,
            isManagedCatalogRecord(current),
            isLocalStockManagementEnabled(readLocalStockAdmission(options, ctx)),
          ),
        );
      } catch (error) {
        rethrowCatalogRouteError(error);
      }
    },
  };
}

export const saveCatalogProductPricesRoute: PluginRoute =
  createSaveCatalogProductPricesRouteWithLocalStock();

export const bulkSaveCatalogProductPricesRoute: PluginRoute = {
  public: false,
  permission: "content:edit_any",
  handler: async (ctx) => {
    if (ctx.request.method.toUpperCase() !== "POST") {
      routeFail("METHOD_NOT_ALLOWED", "bulk price save requires POST", 405);
    }
    try {
      const input = ctx.input && typeof ctx.input === "object" && !Array.isArray(ctx.input)
        ? (ctx.input as { rows?: unknown }).rows
        : undefined;
      return await bulkSaveCatalogProductPrices(productSaveStorage(ctx), input as never);
    } catch (error) {
      rethrowCatalogRouteError(error);
    }
  },
};

export const saveCatalogItemMediaRoute: PluginRoute = {
  public: false,
  permission: "content:edit_any",
  handler: async (ctx) => {
    if (ctx.request.method.toUpperCase() !== "POST") {
      routeFail("METHOD_NOT_ALLOWED", "media save requires POST", 405);
    }
    try {
      return await saveCatalogItemMedia(
        {
          catalog: ctx.storage.catalogItems as StorageCollection<CatalogStorageRecord>,
          media: ctx.storage.catalogMedia as CatalogMediaStorage,
        },
        ctx.input,
      );
    } catch (error) {
      rethrowCatalogRouteError(error);
    }
  },
};

function productEditRoute(edit: (catalog: StorageCollection<CatalogStorageRecord>, input: Record<string, unknown>) => Promise<boolean>): PluginRoute {
  return {
    public: false,
    permission: "content:edit_any",
    handler: async (ctx) => {
      if (ctx.request.method.toUpperCase() !== "POST") routeFail("METHOD_NOT_ALLOWED", "Product changes require POST", 405);
      try {
        return { changed: await edit(ctx.storage.catalogItems as StorageCollection<CatalogStorageRecord>, (ctx.input ?? {}) as Record<string, unknown>) };
      } catch (error) {
        rethrowCatalogRouteError(error);
      }
    },
  };
}
/** Renames a product and its choices; past orders keep their names. */
export const renameCatalogProductRoute = productEditRoute(renameCatalogProduct);
/** Archives or restores a product; nothing is deleted. */
export const setCatalogProductArchivedRoute = productEditRoute((catalog, input) => setCatalogProductArchived(catalog, input));
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

export const setCatalogItemSkuRoute: PluginRoute = {
  public: false,
  permission: "content:edit_any",
  handler: async (ctx) => {
    if (ctx.request.method.toUpperCase() !== "POST") {
      routeFail("METHOD_NOT_ALLOWED", "SKU setting requires POST", 405);
    }
    try {
      return await setCatalogItemSku(
        ctx.storage.catalogItems as StorageCollection<CatalogStorageRecord>,
        ctx.input,
      );
    } catch (error) {
      rethrowCatalogRouteError(error);
    }
  },
};

export const setCatalogItemIdentifiersRoute: PluginRoute = {
  public: false,
  permission: "content:edit_any",
  handler: async (ctx) => {
    if (ctx.request.method.toUpperCase() !== "POST") {
      routeFail("METHOD_NOT_ALLOWED", "identifier setting requires POST", 405);
    }
    try {
      return await setCatalogItemIdentifiers(
        ctx.storage.catalogItems as StorageCollection<CatalogStorageRecord>,
        ctx.input,
      );
    } catch (error) {
      rethrowCatalogRouteError(error);
    }
  },
};

export const addCatalogVariantOptionRoute: PluginRoute = {
  public: false,
  permission: "content:edit_any",
  handler: async (ctx) => {
    if (ctx.request.method.toUpperCase() !== "POST") {
      routeFail("METHOD_NOT_ALLOWED", "variant option requires POST", 405);
    }
    try {
      return await addCatalogVariantOption({
        catalog: ctx.storage.catalogItems as never,
      }, ctx.input as never);
    } catch (error) {
      rethrowCatalogRouteError(error);
    }
  },
};

export const updateCatalogVariantLabelsRoute: PluginRoute = {
  public: false,
  permission: "content:edit_any",
  handler: async (ctx) => {
    if (ctx.request.method.toUpperCase() !== "POST") {
      routeFail("METHOD_NOT_ALLOWED", "variant label update requires POST", 405);
    }
    try {
      return await updateCatalogVariantLabels({
        catalog: ctx.storage.catalogItems as never,
      }, ctx.input as never);
    } catch (error) {
      rethrowCatalogRouteError(error);
    }
  },
};
