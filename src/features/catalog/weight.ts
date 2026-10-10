import type { StorageCollection } from "emdash";
import { CatalogError } from "./errors.js";
import type { CatalogItemRecord, CatalogStorageRecord } from "./types.js";

export const CATALOG_WEIGHT_MESSAGE = "Weight must be a number of ounces above 0 and up to 2400, with at most 2 decimals.";

/** The owner's typed shipping weight in ounces; blank clears it. */
export function normalizeWeightOz(raw: unknown): number | null {
  const typed = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : raw;
  if (typed === null || typed === "") return null;
  const weight = typeof typed === "string" && /^\d{1,4}(\.\d{1,2})?$/.test(typed) ? Number(typed) : NaN;
  if (!(weight > 0 && weight <= 2400)) throw new CatalogError("INVALID_INPUT", CATALOG_WEIGHT_MESSAGE);
  return weight;
}

/**
 * Sets or clears one catalog item's shipping weight. Retries a racing write so
 * it never overwrites a newer record, and changes nothing else on the item.
 */
export async function setCatalogItemWeight(
  catalog: Pick<StorageCollection<CatalogStorageRecord>, "getVersioned" | "compareAndSet">,
  catalogItemId: string, raw: unknown,
): Promise<boolean> {
  const weightOz = normalizeWeightOz(raw);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stored = await catalog.getVersioned(catalogItemId);
    const current = stored?.value as CatalogItemRecord | undefined;
    if (!stored || current?.recordKind !== "catalog-item" || current.itemId !== catalogItemId) {
      throw new CatalogError("CATALOG_ITEM_NOT_FOUND", "Product not found. Return to Products.");
    }
    if ((current.weightOz ?? null) === weightOz) return false;
    const { weightOz: _old, ...rest } = current;
    if ((await catalog.compareAndSet(catalogItemId, stored.revision, weightOz === null ? rest : { ...rest, weightOz })).applied) return true;
  }
  throw new CatalogError("STORAGE_UNAVAILABLE", "Weight not saved because the product kept changing. Try again.");
}
