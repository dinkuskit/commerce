import { StorePoliciesError } from "./errors.js";
import {
  STORE_POLICY_RECORD_ID,
  type StoreReturnPolicyRecord,
  type StoreReturnPolicyStorage,
} from "./types.js";

export async function loadStoreReturnPolicy(
  storage: StoreReturnPolicyStorage,
): Promise<StoreReturnPolicyRecord | null> {
  let stored: StoreReturnPolicyRecord | null;
  try {
    stored = await storage.get(STORE_POLICY_RECORD_ID);
  } catch {
    throw new StorePoliciesError("STORAGE_UNAVAILABLE", "return policy lookup failed");
  }
  if (stored === null || stored === undefined) return null;
  if (
    stored.recordKind !== "store-return-policy" ||
    stored.recordId !== STORE_POLICY_RECORD_ID ||
    typeof stored.revision !== "number" ||
    !Number.isSafeInteger(stored.revision) ||
    stored.revision < 1 ||
    typeof stored.updatedAt !== "string"
  ) {
    throw new StorePoliciesError("STORAGE_UNAVAILABLE", "stored return policy is invalid");
  }
  return stored;
}
