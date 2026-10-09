import { StorePoliciesError } from "./errors.js";
import {
  STORE_POLICY_RECORD_ID,
  type StoreShippingPolicyRecord,
  type StoreShippingPolicyStorage,
} from "./types.js";

export async function loadStoreShippingPolicy(
  storage: StoreShippingPolicyStorage,
): Promise<StoreShippingPolicyRecord | null> {
  let stored: StoreShippingPolicyRecord | null;
  try {
    stored = await storage.get(STORE_POLICY_RECORD_ID);
  } catch {
    throw new StorePoliciesError("STORAGE_UNAVAILABLE", "shipping policy lookup failed");
  }
  if (stored === null || stored === undefined) return null;
  if (
    stored.recordKind !== "store-shipping-policy" ||
    stored.recordId !== STORE_POLICY_RECORD_ID ||
    typeof stored.revision !== "number" ||
    !Number.isSafeInteger(stored.revision) ||
    stored.revision < 1 ||
    typeof stored.configurationId !== "string" ||
    (stored.mode !== "free" && stored.mode !== "flat") ||
    typeof stored.updatedAt !== "string"
  ) {
    throw new StorePoliciesError("STORAGE_UNAVAILABLE", "stored shipping policy is invalid");
  }
  return stored;
}
