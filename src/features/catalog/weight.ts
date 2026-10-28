import { saveProductData, type CatalogWriter } from "./product-state.js";
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
export async function setCatalogItemWeight(catalog: CatalogWriter, catalogItemId: string, raw: unknown): Promise<boolean> {
  return setCatalogWeights(catalog, catalogItemId, [[catalogItemId, raw]]);
}

/** Validate the whole form, then atomically replace all of its weights on the product. */
export async function setCatalogWeights(catalog: CatalogWriter, productId: string,
  weights: readonly (readonly [string, unknown])[], expectedRevision?: string | null): Promise<boolean> {
  if (!weights.length || weights.length > 50 || new Set(weights.map(([id]) => id)).size !== weights.length)
    throw new CatalogError("INVALID_INPUT", "Weight form must contain 1–50 distinct items");
  const typed = weights.map(([id, raw]) => [id, normalizeWeightOz(raw)] as const);
  return saveProductData(catalog, productId, (data, item, root) => {
    const members = root.variantProduct?.members ?? [{ catalogItemId: root.itemId, fulfillment: root.fulfillment ?? "physical" }];
    let changed = false;
    for (const [id, weightOz] of typed) {
      if (!members.some(m => m.catalogItemId === id && m.fulfillment === "physical"))
        throw new CatalogError("INVALID_INPUT", "Unknown physical product choice");
      const before = data.items[id] ?? {};
      if (before.weightOz !== weightOz) changed = true;
      data.items[id] = { ...before, weightOz };
    }
    return changed;
  }, expectedRevision);
}
