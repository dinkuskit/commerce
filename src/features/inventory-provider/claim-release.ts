import type { StorageCollection } from "emdash";

import {
  createManagedSkuRegistrationClaimKey,
  normalizeManagedSkuRegistrationClaimRecord,
} from "./claim.js";
import { ManagedSkuRegistrationError } from "./registration-errors.js";
import type {
  ManagedSkuRegistrationClaimRecord,
  StockManagement,
} from "./types.js";

export type ManagedSkuRegistrationClaimReleaseStorage = Pick<
  StorageCollection<ManagedSkuRegistrationClaimRecord>,
  "compareAndDelete" | "getVersioned" | "query"
>;

function unavailable(message: string, cause?: unknown): ManagedSkuRegistrationError {
  const error = new ManagedSkuRegistrationError(
    "REGISTRATION_CLAIM_UNAVAILABLE",
    message,
  );
  if (cause !== undefined) Object.defineProperty(error, "cause", { value: cause });
  return error;
}

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw unavailable(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function reconstructableClaimKeys(input: {
  catalogItemId: string;
  stockManagement: StockManagement;
}): string[] {
  const catalogItemId = asNonEmptyString(input.catalogItemId, "catalogItemId");
  const keys = [createManagedSkuRegistrationClaimKey({ catalogItemId })];
  if (
    input.stockManagement.mode === "managed" &&
    (input.stockManagement.status === "setup-pending" ||
      input.stockManagement.status === "setup-needs-attention")
  ) {
    keys.push(
      createManagedSkuRegistrationClaimKey({
        catalogItemId,
        rejectedOperationId: input.stockManagement.registration.operationId,
      }),
    );
  }
  return [...new Set(keys)];
}

async function findClaimByKey(
  storage: ManagedSkuRegistrationClaimReleaseStorage,
  claimKey: string,
): Promise<ManagedSkuRegistrationClaimRecord | null> {
  let result;
  try {
    result = await storage.query({ where: { claimKey }, limit: 2 });
  } catch (error) {
    throw unavailable("registration claim lookup failed", error);
  }
  if (result.items.length === 0) return null;
  if (result.items.length !== 1 || result.hasMore) {
    throw unavailable("registration claim winner is ambiguous");
  }
  const claim = normalizeManagedSkuRegistrationClaimRecord(result.items[0]?.data);
  if (claim.claimKey !== claimKey) {
    throw unavailable("registration claim winner does not match its unique key");
  }
  return claim;
}

async function findClaimsForCatalogItem(
  storage: ManagedSkuRegistrationClaimReleaseStorage,
  catalogItemId: string,
): Promise<ManagedSkuRegistrationClaimRecord[]> {
  let result;
  try {
    result = await storage.query({ where: { catalogItemId }, limit: 50 });
  } catch (error) {
    throw unavailable("registration claim lookup failed", error);
  }
  if (result.hasMore) {
    throw unavailable("registration claim winner is ambiguous");
  }
  const claims: ManagedSkuRegistrationClaimRecord[] = [];
  for (const item of result.items) {
    const claim = normalizeManagedSkuRegistrationClaimRecord(item.data);
    if (claim.catalogItemId !== catalogItemId) {
      throw unavailable("registration claim winner belongs to another catalog item");
    }
    claims.push(claim);
  }
  return claims;
}

async function deleteClaimRecord(
  storage: ManagedSkuRegistrationClaimReleaseStorage,
  recordId: string,
): Promise<boolean> {
  let latest;
  try {
    latest = await storage.getVersioned(recordId);
  } catch (error) {
    throw unavailable("registration claim release failed", error);
  }
  if (latest === null) return false;
  let result;
  try {
    result = await storage.compareAndDelete(recordId, latest.revision);
  } catch (error) {
    throw unavailable("registration claim release failed", error);
  }
  if (!result.applied) {
    throw unavailable("registration claim release lost to a concurrent write");
  }
  return true;
}

export async function releaseManagedSkuRegistrationClaims(
  storage: ManagedSkuRegistrationClaimReleaseStorage,
  input: { catalogItemId: string; stockManagement?: StockManagement },
): Promise<{ released: number }> {
  const catalogItemId = asNonEmptyString(input.catalogItemId, "catalogItemId");
  const claims = new Map<string, ManagedSkuRegistrationClaimRecord>();
  for (const claim of await findClaimsForCatalogItem(storage, catalogItemId)) {
    claims.set(claim.recordId, claim);
  }
  if (input.stockManagement !== undefined) {
    for (const claimKey of reconstructableClaimKeys({
      catalogItemId,
      stockManagement: input.stockManagement,
    })) {
      const claim = await findClaimByKey(storage, claimKey);
      if (!claim) continue;
      if (claim.catalogItemId !== catalogItemId) {
        throw unavailable("registration claim winner belongs to another catalog item");
      }
      claims.set(claim.recordId, claim);
    }
  }
  let released = 0;
  for (const claim of claims.values()) {
    if (await deleteClaimRecord(storage, claim.recordId)) released += 1;
  }
  return { released };
}
