import type { StorageCollection } from "emdash";
import { CatalogError } from "./errors.js";
import { normalizeSku } from "./normalize.js";
import {
  assertCatalogStorageConstraints,
  identifyConfirmedUniqueViolation,
} from "./storage-constraints.js";
import type {
  CatalogItemReadStorage,
  CatalogItemRecord,
  CatalogStorage,
  CatalogStorageRecord,
} from "./types.js";

export interface SetCatalogItemSkuInput {
  catalogItemId: string;
  sku: string;
}

export interface SetCatalogItemSkuResult {
  changed: boolean;
  item: CatalogItemRecord;
}

export interface SetCatalogItemSkuOptions {
  /** Trusted installed storage names, never taken from caller input. */
  collection?: string;
  pluginId?: string;
}

export async function setCatalogItemSku(
  storage: CatalogStorage &
    CatalogItemReadStorage &
    Pick<StorageCollection<CatalogStorageRecord>, "compareAndSet" | "getVersioned">,
  rawInput: unknown,
  options: SetCatalogItemSkuOptions = {},
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
  await assertCatalogStorageConstraints(storage, options.collection, options.pluginId);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stored = await storage.getVersioned(input.catalogItemId);
    const current = stored?.value as CatalogItemRecord | undefined;
    if (
      !stored ||
      !current ||
      current.recordKind !== "catalog-item" ||
      current.itemId !== input.catalogItemId
    ) {
      throw new CatalogError("CATALOG_ITEM_NOT_FOUND", "catalog item was not found");
    }
    if (current.sku === sku && current.skuKey === sku) {
      return { changed: false, item: current };
    }
    const item = { ...current, sku, skuKey: sku };
    try {
      const result = await storage.compareAndSet(item.itemId, stored.revision, item);
      if (result.applied) return { changed: true, item };
    } catch (error) {
      if (identifyConfirmedUniqueViolation(error) === "skuKey") {
        throw new CatalogError("SKU_CONFLICT", "sku is already assigned to another catalog item");
      }
      throw new CatalogError("STORAGE_UNAVAILABLE", "catalog SKU update failed", {
        cause: error,
      });
    }
  }
  throw new CatalogError("STORAGE_UNAVAILABLE", "catalog SKU update conflicted repeatedly");
}
