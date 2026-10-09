import { StorePoliciesError } from "./errors.js";
import { loadStoreShippingPolicy } from "./load-shipping.js";
import { normalizeShippingPolicyInput } from "./normalize.js";
import {
  STORE_POLICY_RECORD_ID,
  type SetStoreShippingPolicyResult,
  type StoreShippingPolicyRecord,
  type StoreShippingPolicyStorage,
} from "./types.js";

export { loadStoreShippingPolicy } from "./load-shipping.js";

function samePolicy(
  left: StoreShippingPolicyRecord,
  right: Omit<StoreShippingPolicyRecord, "revision" | "updatedAt">,
): boolean {
  return (
    left.configurationId === right.configurationId &&
    left.mode === right.mode &&
    left.amount?.currency === right.amount?.currency &&
    left.amount?.minor === right.amount?.minor &&
    JSON.stringify(left.shippingDestinationCountries ?? null) ===
      JSON.stringify(right.shippingDestinationCountries ?? null) &&
    JSON.stringify(left.handlingTimeDays ?? null) ===
      JSON.stringify(right.handlingTimeDays ?? null) &&
    JSON.stringify(left.transitTimeDays ?? null) ===
      JSON.stringify(right.transitTimeDays ?? null) &&
    left.policyPageUrl === right.policyPageUrl
  );
}

export async function setStoreShippingPolicy(
  storage: StoreShippingPolicyStorage,
  rawInput: unknown,
  options: { now?: () => Date } = {},
): Promise<SetStoreShippingPolicyResult> {
  const normalized = normalizeShippingPolicyInput(rawInput);
  const current = await loadStoreShippingPolicy(storage);
  const nextBase = {
    recordKind: "store-shipping-policy" as const,
    recordId: STORE_POLICY_RECORD_ID,
    configurationId: normalized.charge.configurationId,
    mode: normalized.charge.mode,
    ...(normalized.charge.amount ? { amount: normalized.charge.amount } : {}),
    ...(normalized.shippingDestinationCountries
      ? { shippingDestinationCountries: normalized.shippingDestinationCountries }
      : {}),
    ...(normalized.handlingTimeDays ? { handlingTimeDays: normalized.handlingTimeDays } : {}),
    ...(normalized.transitTimeDays ? { transitTimeDays: normalized.transitTimeDays } : {}),
    ...(normalized.policyPageUrl ? { policyPageUrl: normalized.policyPageUrl } : {}),
  };
  if (current && samePolicy(current, nextBase)) {
    return { changed: false, policy: current };
  }
  const policy: StoreShippingPolicyRecord = {
    ...nextBase,
    revision: current ? current.revision + 1 : 1,
    updatedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  try {
    await storage.put(policy.recordId, policy);
  } catch {
    throw new StorePoliciesError("STORAGE_UNAVAILABLE", "shipping policy update failed");
  }
  return { changed: true, policy };
}
