import { CatalogError } from "./errors.js";
import { normalizeSku } from "./normalize.js";
import { identifyConfirmedUniqueViolation } from "./storage-constraints.js";
import type {
  CatalogItemReadStorage,
  CatalogItemRecord,
  CatalogStorage,
} from "./types.js";

export interface SetCatalogItemSkuInput {
  catalogItemId: string;
  sku: string;
}

export interface SetCatalogItemSkuResult {
  changed: boolean;
  item: CatalogItemRecord;
}

export async function setCatalogItemSku(
  storage: CatalogItemReadStorage & Pick<CatalogStorage, "put">,
  rawInput: unknown,
): Promise<SetCatalogItemSkuResult> {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    throw new CatalogError("INVALID_INPUT", "request body must be an object");
  }
  const input = rawInput as Partial<SetCatalogItemSkuInput>;
  if (
    typeof input.catalogItemId !== "string" ||
    !input.catalogItemId ||
    input.catalogItemId.length > 1024
  ) {
    throw new CatalogError("INVALID_INPUT", "catalogItemId must be a valid itemId");
  }
  const sku = normalizeSku(input.sku);
  const current = (await storage.get(input.catalogItemId)) as CatalogItemRecord | null;
  if (!current || current.recordKind !== "catalog-item" || current.itemId !== input.catalogItemId) {
    throw new CatalogError("CATALOG_ITEM_NOT_FOUND", "catalog item was not found");
  }
  if (current.sku === sku && current.skuKey === sku) {
    return { changed: false, item: current };
  }
  const item = { ...current, sku, skuKey: sku };
  try {
    await storage.put(item.itemId, item);
  } catch (error) {
    if (identifyConfirmedUniqueViolation(error) === "skuKey") {
      throw new CatalogError("SKU_CONFLICT", "sku is already assigned to another catalog item");
    }
    throw new CatalogError("STORAGE_UNAVAILABLE", "catalog SKU update failed", { cause: error });
  }
  return { changed: true, item };
}
