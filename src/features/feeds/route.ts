import { PluginRouteError, type PluginRoute, type StorageCollection } from "emdash";
import { setProductFeedEligibility } from "./eligibility.js";
import {
  PRODUCT_FEED_CHANNELS,
  type ProductFeedEligibilityRecord,
} from "./types.js";
import type { CatalogStorageRecord } from "../catalog/index.js";

export { SET_PRODUCT_FEED_ELIGIBILITY_ROUTE } from "./route-ids.js";
import { SET_PRODUCT_FEED_ELIGIBILITY_ROUTE } from "./route-ids.js";

export const setProductFeedEligibilityRoute: PluginRoute = {
  permission: "content:edit_any",
  handler: async (ctx) => {
    if (ctx.request.method.toUpperCase() !== "POST") {
      throw new PluginRouteError("METHOD_NOT_ALLOWED", "feed eligibility requires POST", 405);
    }
    const input = ctx.input as { catalogItemId?: unknown; channels?: unknown };
    if (typeof input.catalogItemId !== "string" || !Array.isArray(input.channels)) {
      throw new PluginRouteError("INVALID_INPUT", "catalogItemId and channels are required", 400);
    }
    try {
      return await setProductFeedEligibility(
        ctx.storage.productFeedEligibility as StorageCollection<ProductFeedEligibilityRecord>,
        ctx.storage.catalogItems as StorageCollection<CatalogStorageRecord>,
        { catalogItemId: input.catalogItemId, channels: input.channels as typeof PRODUCT_FEED_CHANNELS[number][] },
      );
    } catch (error) {
      throw new PluginRouteError("INVALID_INPUT", error instanceof Error ? error.message : "invalid feed eligibility", 400);
    }
  },
};
