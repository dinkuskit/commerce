import { PluginRouteError, type PluginRoute } from "emdash";
import { merchantStoreSettingsAuthorized } from "./authorization.js";
export { merchantStoreSettingsAuthorized } from "./authorization.js";

import { merchantStoreSettingsBlocks } from "./admin/index.js";
import { StoreSettingsError } from "./types.js";

export const MERCHANT_STORE_SETTINGS_ROUTE = "admin";

function routeError(error: unknown): PluginRouteError {
  if (error instanceof StoreSettingsError) return new PluginRouteError(error.code, error.message, error.status);
  return new PluginRouteError("STORAGE_UNAVAILABLE", "Could not access merchant store settings", 503);
}

export function createMerchantStoreSettingsRoute(): PluginRoute {
  return {
    permission: "content:edit_any",
    methods: ["POST"],
    handler: async (ctx) => {
      if (!merchantStoreSettingsAuthorized(ctx)) {
        throw new PluginRouteError("UNAUTHORIZED", "Merchant store settings require an authenticated editor admin", 403);
      }
      if (ctx.request.method.toUpperCase() !== "POST") {
        throw new PluginRouteError("METHOD_NOT_ALLOWED", "Merchant store settings requires POST", 405);
      }
      try {
        return await merchantStoreSettingsBlocks({
          input: ctx.input, user: ctx.user, ui: ctx.ui,
          request: { method: ctx.request.method, url: ctx.request.url, headers: {} },
        }, ctx);
      } catch (error) {
        throw routeError(error);
      }
    },
  };
}
