import { CatalogError } from "./errors.js";
import type {
  CatalogBackorderPolicyRecord,
  CatalogBackorderPolicyStorage,
} from "./types.js";

function catalogFail(code: ConstructorParameters<typeof CatalogError>[0], message: string, options?: ErrorOptions): never {
  throw new CatalogError(code, message, options);
}

export async function loadCatalogItemBackorderPolicy(
  storage: CatalogBackorderPolicyStorage,
  catalogItemId: string,
): Promise<CatalogBackorderPolicyRecord> {
  if (typeof catalogItemId !== "string" || catalogItemId.trim().length === 0) {
    catalogFail("INVALID_INPUT", "catalogItemId must be a non-empty string");
  }
  const id = catalogItemId.trim();
  let stored: CatalogBackorderPolicyRecord | null;
  try {
    stored = await storage.get(id);
  } catch (error) {
    catalogFail("STORAGE_UNAVAILABLE", "backorder policy lookup failed", { cause: error });
  }
  if (stored === null) {
    return { recordKind: "catalog-backorder-policy", recordId: id, catalogItemId: id, allowBackorders: false };
  }
  if (
    stored.recordKind !== "catalog-backorder-policy" ||
    stored.recordId !== id ||
    stored.catalogItemId !== id ||
    typeof stored.allowBackorders !== "boolean"
  ) {
    catalogFail("STORAGE_UNAVAILABLE", "stored backorder policy is invalid");
  }
  return stored;
}
