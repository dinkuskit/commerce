import type { StorageCollection } from "emdash";

/** Local Money shape — avoid pulling catalog kernel into the sandbox public-read graph. */
export interface Money {
  currency: "USD";
  minor: string;
}

export const STORE_POLICIES_FEATURE_ID = "dinkus.store-policies";
export const STORE_SHIPPING_POLICY_COLLECTION = "storeShippingPolicy";
export const STORE_RETURN_POLICY_COLLECTION = "storeReturnPolicy";
export const STORE_SHIPPING_POLICY_SANDBOX_COLLECTION = "store_shipping_policy";
export const STORE_RETURN_POLICY_SANDBOX_COLLECTION = "store_return_policy";
export const STORE_POLICY_RECORD_ID = "active" as const;

/** Charge fields match TrustedShippingConfiguration so checkout can unify later. */
export interface StoreShippingCharge {
  configurationId: string;
  mode: "free" | "flat";
  amount?: Money;
}

export interface DayBounds {
  min: number;
  max: number;
}

/**
 * Versioned store shipping policy. Charge is required once the record exists;
 * destination countries and handling/transit bounds are optional and never invented.
 */
export interface StoreShippingPolicyRecord extends StoreShippingCharge {
  recordKind: "store-shipping-policy";
  recordId: typeof STORE_POLICY_RECORD_ID;
  revision: number;
  shippingDestinationCountries?: readonly string[];
  handlingTimeDays?: DayBounds;
  transitTimeDays?: DayBounds;
  policyPageUrl?: string;
  updatedAt: string;
}

export type ReturnPolicyCategory =
  | "MerchantReturnFiniteReturnWindow"
  | "MerchantReturnNotPermitted"
  | "MerchantReturnUnlimitedWindow";

export type ReturnMethod = "ReturnByMail" | "ReturnInStore" | "ReturnAtKiosk";

export type ReturnFees =
  | "FreeReturn"
  | "ReturnFeesCustomerResponsibility"
  | "ReturnShippingFees";

/**
 * Versioned store return policy. Every MerchantReturnPolicy field is optional;
 * unset fields are omitted from public reads and JSON-LD.
 */
export interface StoreReturnPolicyRecord {
  recordKind: "store-return-policy";
  recordId: typeof STORE_POLICY_RECORD_ID;
  revision: number;
  applicableCountry?: readonly string[];
  returnPolicyCategory?: ReturnPolicyCategory;
  merchantReturnDays?: number;
  returnMethod?: ReturnMethod;
  returnFees?: ReturnFees;
  policyPageUrl?: string;
  updatedAt: string;
}

export type StoreShippingPolicyStorage = Pick<
  StorageCollection<StoreShippingPolicyRecord>,
  "get" | "put"
>;

export type StoreReturnPolicyStorage = Pick<
  StorageCollection<StoreReturnPolicyRecord>,
  "get" | "put"
>;

export interface PublicStorePolicies {
  shipping: StoreShippingPolicyRecord | null;
  returns: StoreReturnPolicyRecord | null;
}

export interface SetStoreShippingPolicyResult {
  changed: boolean;
  policy: StoreShippingPolicyRecord;
}

export interface SetStoreReturnPolicyResult {
  changed: boolean;
  policy: StoreReturnPolicyRecord;
}
