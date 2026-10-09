import type { PluginContext } from "emdash/plugin";
import { StorePoliciesError } from "./errors.js";
import { loadStoreReturnPolicy } from "./load-returns.js";
import { loadStoreShippingPolicy } from "./load-shipping.js";
import {
  STORE_RETURN_POLICY_SANDBOX_COLLECTION,
  STORE_SHIPPING_POLICY_SANDBOX_COLLECTION,
  type PublicStorePolicies,
  type StoreReturnPolicyStorage,
  type StoreShippingPolicyStorage,
} from "./types.js";

export const PUBLIC_STORE_POLICIES_ROUTE = "policies/public";

function shippingStorage(ctx: PluginContext): StoreShippingPolicyStorage {
  const native = ctx.storage["storeShippingPolicy"];
  const sandbox = ctx.storage[STORE_SHIPPING_POLICY_SANDBOX_COLLECTION];
  const storage = (sandbox ?? native) as StoreShippingPolicyStorage | undefined;
  if (!storage?.get) {
    throw new StorePoliciesError("STORAGE_UNAVAILABLE", "shipping policy storage missing");
  }
  return storage;
}

function returnStorage(ctx: PluginContext): StoreReturnPolicyStorage {
  const native = ctx.storage["storeReturnPolicy"];
  const sandbox = ctx.storage[STORE_RETURN_POLICY_SANDBOX_COLLECTION];
  const storage = (sandbox ?? native) as StoreReturnPolicyStorage | undefined;
  if (!storage?.get) {
    throw new StorePoliciesError("STORAGE_UNAVAILABLE", "return policy storage missing");
  }
  return storage;
}

/** Public read of the same versioned policy records policy pages and JSON-LD consume. */
export async function readPublicStorePolicies(
  ctx: PluginContext,
): Promise<PublicStorePolicies> {
  const [shipping, returns] = await Promise.all([
    loadStoreShippingPolicy(shippingStorage(ctx)),
    loadStoreReturnPolicy(returnStorage(ctx)),
  ]);
  return { shipping, returns };
}

export async function readPublicStorePoliciesFromStorage(input: {
  shipping: StoreShippingPolicyStorage;
  returns: StoreReturnPolicyStorage;
}): Promise<PublicStorePolicies> {
  const [shipping, returns] = await Promise.all([
    loadStoreShippingPolicy(input.shipping),
    loadStoreReturnPolicy(input.returns),
  ]);
  return { shipping, returns };
}
