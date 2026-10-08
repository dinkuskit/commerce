export const MANAGED_SKU_REGISTRATION_CLAIMS_COLLECTION =
  "managedSkuClaims";
export const MANAGED_SKU_REGISTRATION_CLAIM_UNIQUE_INDEXES = [
  "claimKey",
  "operationId",
] as const;

export type ManagedSkuRegistrationClaimUniqueField =
  (typeof MANAGED_SKU_REGISTRATION_CLAIM_UNIQUE_INDEXES)[number];
