import { PluginRouteError, type PluginRoute, type StorageCollection } from "emdash";

import { createCatalogItem } from "./create-catalog-item.js";
import { CatalogError } from "./errors.js";
import { setCatalogItemManualAvailability } from "./manual-availability.js";
import {
  clearCatalogItemRegularPrice,
  clearCatalogItemSalePrice,
  setCatalogItemRegularPrice,
  setCatalogItemSalePrice,
} from "./price.js";
import { listCatalogProducts, saveCatalogProductPrices } from "./product-admin.js";
import { setCatalogItemBackorders } from "./set-backorders.js";
import {
  CLEAR_CATALOG_ITEM_REGULAR_PRICE_ROUTE,
  CLEAR_CATALOG_ITEM_SALE_PRICE_ROUTE,
  CREATE_CATALOG_ITEM_ROUTE,
  LIST_CATALOG_PRODUCTS_ROUTE,
  SAVE_CATALOG_PRODUCT_PRICES_ROUTE,
  SET_CATALOG_ITEM_BACKORDERS_ROUTE,
  SET_CATALOG_ITEM_MANUAL_AVAILABILITY_ROUTE,
  SET_CATALOG_ITEM_REGULAR_PRICE_ROUTE,
  SET_CATALOG_ITEM_SALE_PRICE_ROUTE,
} from "./route-ids.js";
import type {
  CatalogBackorderPolicyRecord,
  CatalogManualAvailabilityRecord,
  CatalogPriceRecord,
  CatalogStorageRecord,
} from "./types.js";

export {
  CLEAR_CATALOG_ITEM_REGULAR_PRICE_ROUTE,
  CLEAR_CATALOG_ITEM_SALE_PRICE_ROUTE,
  CREATE_CATALOG_ITEM_ROUTE,
  LIST_CATALOG_PRODUCTS_ROUTE,
  SAVE_CATALOG_PRODUCT_PRICES_ROUTE,
  SET_CATALOG_ITEM_BACKORDERS_ROUTE,
  SET_CATALOG_ITEM_MANUAL_AVAILABILITY_ROUTE,
  SET_CATALOG_ITEM_REGULAR_PRICE_ROUTE,
  SET_CATALOG_ITEM_SALE_PRICE_ROUTE,
};

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

function priceStorage(ctx: Parameters<PluginRoute["handler"]>[0]) {
  return {
    catalog: ctx.storage.catalogItems as StorageCollection<CatalogStorageRecord>,
    prices: ctx.storage.catalogPrices as StorageCollection<CatalogPriceRecord>,
  };
}

function productSaveStorage(ctx: Parameters<PluginRoute["handler"]>[0]) {
  return {
    ...priceStorage(ctx),
    availability: ctx.storage
      .catalogManualAvailability as StorageCollection<CatalogManualAvailabilityRecord>,
  };
}

function catalogPriceRoute(
  action: typeof setCatalogItemRegularPrice,
  methodMessage: string,
): PluginRoute {
  return {
    permission: "content:edit_any",
    handler: async (ctx) => {
      if (ctx.request.method.toUpperCase() !== "POST") {
        throw new PluginRouteError("METHOD_NOT_ALLOWED", methodMessage, 405);
      }
      try {
        return await action(priceStorage(ctx), ctx.input);
      } catch (error) {
        if (error instanceof CatalogError) {
          throw new PluginRouteError(error.code, error.message, error.status);
        }
        throw error;
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

export const listCatalogProductsRoute: PluginRoute = {
  permission: "content:edit_any",
  handler: async (ctx) => {
    const method = ctx.request.method.toUpperCase();
    if (method !== "GET" && method !== "POST") {
      throw new PluginRouteError(
        "METHOD_NOT_ALLOWED",
        "product list requires GET or POST",
        405,
      );
    }
    try {
      return await listCatalogProducts(productSaveStorage(ctx));
    } catch (error) {
      if (error instanceof CatalogError) {
        throw new PluginRouteError(error.code, error.message, error.status);
      }
      throw error;
    }
  },
};

export const saveCatalogProductPricesRoute: PluginRoute = {
  permission: "content:edit_any",
  handler: async (ctx) => {
    if (ctx.request.method.toUpperCase() !== "POST") {
      throw new PluginRouteError(
        "METHOD_NOT_ALLOWED",
        "price save requires POST",
        405,
      );
    }
    try {
      return await saveCatalogProductPrices(productSaveStorage(ctx), ctx.input);
    } catch (error) {
      if (error instanceof CatalogError) {
        throw new PluginRouteError(error.code, error.message, error.status);
      }
      throw error;
    }
  },
};
