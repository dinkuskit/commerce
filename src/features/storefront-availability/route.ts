import {
  PluginRouteError,
  type PluginRoute,
  type StorageCollection,
} from "emdash";

import { StorefrontAvailabilityError } from "./errors.js";
import { loadOutOfStockListing, setOutOfStockListing } from "./listing.js";
import {
  loadStorefrontPlaceholderImage,
  setStorefrontPlaceholderImage,
  type StorefrontPlaceholderImageRecord,
} from "./placeholder.js";
import { setStorefrontAvailabilityPolicy } from "./settings.js";
import type {
  StorefrontAvailabilitySettingsRecord,
  StorefrontOutOfStockListingRecord,
} from "./types.js";

function routeFail(code: string, message: string, status: number): never {
  throw new PluginRouteError(code, message, status);
}

export {
  OUT_OF_STOCK_LISTING_ROUTE,
  PLACEHOLDER_IMAGE_ROUTE,
  SET_STOREFRONT_AVAILABILITY_POLICY_ROUTE,
} from "./route-ids.js";

export const setStorefrontAvailabilityPolicyRoute: PluginRoute = {
  permission: "content:edit_any",
  handler: async (ctx) => {
    if (ctx.request.method.toUpperCase() !== "POST") {
      routeFail("METHOD_NOT_ALLOWED", "storefront availability setting requires POST", 405);
    }
    try {
      return await setStorefrontAvailabilityPolicy(
        ctx.storage
          .storefrontAvailabilitySettings as StorageCollection<StorefrontAvailabilitySettingsRecord>,
        ctx.input,
      );
    } catch (error) {
      if (error instanceof StorefrontAvailabilityError) {
        throw new PluginRouteError(
          error.code,
          error.message,
          error.code === "INVALID_INPUT" ? 400 : 503,
        );
      }
      throw error;
    }
  },
};

function listingStorage(
  ctx: { storage: Record<string, unknown> },
): StorageCollection<StorefrontOutOfStockListingRecord> {
  return ctx.storage
    .storefrontOutOfStockListing as StorageCollection<StorefrontOutOfStockListingRecord>;
}

function listingError(error: unknown): never {
  if (error instanceof StorefrontAvailabilityError) {
    throw new PluginRouteError(
      error.code,
      error.message,
      error.code === "INVALID_INPUT" ? 400 : 503,
    );
  }
  throw error;
}

export const outOfStockListingRoute: PluginRoute = {
  permission: "content:edit_any",
  handler: async (ctx) => {
    const method = ctx.request.method.toUpperCase();
    if (method === "GET") {
      try {
        return await loadOutOfStockListing(listingStorage(ctx));
      } catch (error) {
        listingError(error);
      }
    }
    if (method !== "POST") {
      routeFail("METHOD_NOT_ALLOWED", "out-of-stock listing requires GET or POST", 405);
    }
    try {
      return await setOutOfStockListing(listingStorage(ctx), ctx.input);
    } catch (error) {
      listingError(error);
    }
  },
};

function placeholderStorage(
  ctx: { storage: Record<string, unknown> },
): StorageCollection<StorefrontPlaceholderImageRecord> {
  return ctx.storage
    .storefrontPlaceholderImage as StorageCollection<StorefrontPlaceholderImageRecord>;
}

export const placeholderImageRoute: PluginRoute = {
  permission: "content:edit_any",
  handler: async (ctx) => {
    const method = ctx.request.method.toUpperCase();
    if (method === "GET") {
      try {
        return await loadStorefrontPlaceholderImage(placeholderStorage(ctx));
      } catch (error) {
        listingError(error);
      }
    }
    if (method !== "POST") {
      routeFail("METHOD_NOT_ALLOWED", "placeholder image requires GET or POST", 405);
    }
    try {
      return await setStorefrontPlaceholderImage(placeholderStorage(ctx), ctx.input);
    } catch (error) {
      listingError(error);
    }
  },
};
