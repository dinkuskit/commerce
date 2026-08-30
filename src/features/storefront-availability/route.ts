import {
  PluginRouteError,
  type PluginRoute,
  type StorageCollection,
} from "emdash";

import { StorefrontAvailabilityError } from "./errors.js";
import { setStorefrontAvailabilityPolicy } from "./settings.js";
import type { StorefrontAvailabilitySettingsRecord } from "./types.js";

export const SET_STOREFRONT_AVAILABILITY_POLICY_ROUTE =
  "settings/storefront-availability";

export const setStorefrontAvailabilityPolicyRoute: PluginRoute = {
  permission: "content:edit_any",
  handler: async (ctx) => {
    if (ctx.request.method.toUpperCase() !== "POST") {
      throw new PluginRouteError(
        "METHOD_NOT_ALLOWED",
        "storefront availability setting requires POST",
        405,
      );
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
