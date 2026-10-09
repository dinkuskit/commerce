import {
  PluginRouteError,
  type PluginRoute,
  type StorageCollection,
} from "emdash";

import { StorePoliciesError } from "./errors.js";
import { setStoreReturnPolicy } from "./returns.js";
import { setStoreShippingPolicy } from "./shipping.js";
import type { StoreReturnPolicyRecord, StoreShippingPolicyRecord } from "./types.js";

export {
  SET_STORE_RETURN_POLICY_ROUTE,
  SET_STORE_SHIPPING_POLICY_ROUTE,
} from "./route-ids.js";

function mapError(error: unknown): never {
  if (error instanceof StorePoliciesError) {
    throw new PluginRouteError(error.code, error.message, error.status);
  }
  throw error;
}

export const setStoreShippingPolicyRoute: PluginRoute = {
  permission: "content:edit_any",
  handler: async (ctx) => {
    if (ctx.request.method.toUpperCase() !== "POST") {
      throw new PluginRouteError("METHOD_NOT_ALLOWED", "shipping policy requires POST", 405);
    }
    try {
      return await setStoreShippingPolicy(
        (ctx.storage.storeShippingPolicy ??
          ctx.storage.store_shipping_policy) as StorageCollection<StoreShippingPolicyRecord>,
        ctx.input,
      );
    } catch (error) {
      mapError(error);
    }
  },
};

export const setStoreReturnPolicyRoute: PluginRoute = {
  permission: "content:edit_any",
  handler: async (ctx) => {
    if (ctx.request.method.toUpperCase() !== "POST") {
      throw new PluginRouteError("METHOD_NOT_ALLOWED", "return policy requires POST", 405);
    }
    try {
      return await setStoreReturnPolicy(
        (ctx.storage.storeReturnPolicy ??
          ctx.storage.store_return_policy) as StorageCollection<StoreReturnPolicyRecord>,
        ctx.input,
      );
    } catch (error) {
      mapError(error);
    }
  },
};
