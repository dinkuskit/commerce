import type { PluginContext } from "emdash/plugin";
import type { PublicStorePolicies, StoreReturnPolicyRecord, StoreShippingPolicyRecord } from "./types.js";

const ID = "active";

async function get<T extends { recordKind: string; recordId: string; revision: number }>(
  storage: { get(id: string): Promise<T | null> } | undefined,
  kind: T["recordKind"],
): Promise<T | null> {
  if (!storage?.get) throw new Error("Catalog unavailable");
  let row: T | null;
  try {
    row = await storage.get(ID);
  } catch {
    throw new Error("Catalog unavailable");
  }
  if (!row) return null;
  if (
    row.recordKind !== kind ||
    row.recordId !== ID ||
    typeof row.revision !== "number" ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1
  ) {
    throw new Error("Catalog unavailable");
  }
  return row;
}

/** Minimal sandbox public read — keep out of the write/normalize graph. */
export async function readSandboxPublicStorePolicies(
  ctx: PluginContext,
): Promise<PublicStorePolicies> {
  return {
    shipping: await get<StoreShippingPolicyRecord>(
      ctx.storage.store_shipping_policy as
        | { get(id: string): Promise<StoreShippingPolicyRecord | null> }
        | undefined,
      "store-shipping-policy",
    ),
    returns: await get<StoreReturnPolicyRecord>(
      ctx.storage.store_return_policy as
        | { get(id: string): Promise<StoreReturnPolicyRecord | null> }
        | undefined,
      "store-return-policy",
    ),
  };
}
