import { StorePoliciesError } from "./errors.js";
import { loadStoreReturnPolicy } from "./load-returns.js";
import { normalizeReturnPolicyInput } from "./normalize.js";
import {
  STORE_POLICY_RECORD_ID,
  type SetStoreReturnPolicyResult,
  type StoreReturnPolicyRecord,
  type StoreReturnPolicyStorage,
} from "./types.js";

export { loadStoreReturnPolicy } from "./load-returns.js";

function samePolicy(
  left: StoreReturnPolicyRecord,
  right: Omit<StoreReturnPolicyRecord, "revision" | "updatedAt" | "recordKind" | "recordId">,
): boolean {
  return (
    JSON.stringify(left.applicableCountry ?? null) ===
      JSON.stringify(right.applicableCountry ?? null) &&
    left.returnPolicyCategory === right.returnPolicyCategory &&
    left.merchantReturnDays === right.merchantReturnDays &&
    left.returnMethod === right.returnMethod &&
    left.returnFees === right.returnFees &&
    left.policyPageUrl === right.policyPageUrl
  );
}

export async function setStoreReturnPolicy(
  storage: StoreReturnPolicyStorage,
  rawInput: unknown,
  options: { now?: () => Date } = {},
): Promise<SetStoreReturnPolicyResult> {
  const normalized = normalizeReturnPolicyInput(rawInput);
  const current = await loadStoreReturnPolicy(storage);
  if (current && samePolicy(current, normalized)) {
    return { changed: false, policy: current };
  }
  const policy: StoreReturnPolicyRecord = {
    recordKind: "store-return-policy",
    recordId: STORE_POLICY_RECORD_ID,
    revision: current ? current.revision + 1 : 1,
    ...normalized,
    updatedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  try {
    await storage.put(policy.recordId, policy);
  } catch {
    throw new StorePoliciesError("STORAGE_UNAVAILABLE", "return policy update failed");
  }
  return { changed: true, policy };
}
