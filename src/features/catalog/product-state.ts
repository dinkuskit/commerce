import { isRecord } from "../../shared/record.js";
import { catalogFail } from "./errors.js";
import type { CatalogData, CatalogItemRecord, CatalogStorageRecord } from "./types.js";

export interface CatalogReader { get(id: string): Promise<CatalogStorageRecord | null> }
export interface CatalogWriter extends CatalogReader {
  getVersioned(id: string): Promise<{ value: CatalogStorageRecord; revision: string } | null>;
  compareAndSet(id: string, revision: string | null, value: CatalogStorageRecord): Promise<{ applied: boolean; revision?: string }>;
}

export function productData(item: CatalogItemRecord): CatalogData {
  const data = item.catalogData;
  if (data !== undefined && (!data || data.version !== 1 || !isRecord(data.items) || Object.keys(data.items).length > 50))
    catalogFail("STORAGE_UNAVAILABLE", "Stored product data is invalid");
  if (data) for (const value of Object.values(data.items)) {
    if (!isRecord(value) ||
      Object.hasOwn(value, "availability") && !value.availability ||
      value.weightOz !== undefined && value.weightOz !== null &&
        (typeof value.weightOz !== "number" || !(value.weightOz > 0 && value.weightOz <= 2400)))
      catalogFail("STORAGE_UNAVAILABLE", "Stored product data is invalid");
  }
  return data ?? { version: 1, items: {} };
}

function item(value: CatalogStorageRecord | null | undefined, id: string): CatalogItemRecord {
  if (!value || value.recordKind !== "catalog-item" || value.itemId !== id)
    catalogFail("CATALOG_ITEM_NOT_FOUND", "Product not found. Reload before saving.");
  return value;
}

export function catalogItemState(current: CatalogItemRecord, root: CatalogItemRecord): CatalogItemRecord {
  const saved = productData(root).items[current.itemId];
  if (!saved) return current;
  const result = { ...current };
  if (Object.hasOwn(saved, "weightOz")) {
    delete result.weightOz;
    if (saved.weightOz !== null) result.weightOz = saved.weightOz;
  }
  if (saved.stockManagement) result.stockManagement = saved.stockManagement;
  return result;
}

/** Only the product root owns saved values; a child cannot borrow another product's state. */
export async function catalogRoot(catalog: CatalogReader, id: string) {
  const current = item(await catalog.get(id), id);
  const root = current.variantProductId ? item(await catalog.get(current.variantProductId), current.variantProductId) : current;
  if (root.variantProductId || (current !== root && !root.variantProduct?.members.some(m => m.catalogItemId === id)))
    catalogFail("CATALOG_ITEM_NOT_FOUND", "Variant is unavailable");
  return { current: catalogItemState(current, root), root };
}

export async function catalogValue<K extends keyof CatalogData["items"][string]>(catalog: CatalogReader, id: string, key: K) {
  if (!catalog) catalogFail("INVALID_INPUT", "A catalog reader is required");
  const { root } = await catalogRoot(catalog, id);
  const values = productData(root).items[id];
  return values && Object.hasOwn(values, key) ? values[key] : undefined;
}

/** One physical commit per logical save. A racing edit is refused, never partly replayed. */
export async function saveProductData<T>(catalog: CatalogWriter, id: string,
  edit: (data: CatalogData, current: CatalogItemRecord, root: CatalogItemRecord) => Promise<T> | T,
  expectedRevision?: string | null,
): Promise<T> {
  const selected = await catalog.getVersioned(id);
  let current = item(selected?.value, id);
  const stored = current.variantProductId ? await catalog.getVersioned(current.variantProductId) : selected;
  const root = structuredClone(item(stored?.value, current.variantProductId ?? id));
  if (root.variantProductId || (current.variantProductId && !root.variantProduct?.members.some(m => m.catalogItemId === id)))
    catalogFail("CATALOG_ITEM_NOT_FOUND", "Variant is unavailable");
  if (expectedRevision !== undefined && expectedRevision !== "catalog:" + stored!.revision)
    catalogFail("COMMAND_CONFLICT", "Product changed; reload before saving");
  current = catalogItemState(current, root);
  const original = JSON.stringify(root);
  const before = productData(root), data = structuredClone(before);
  const result = await edit(data, current, root);
  if (JSON.stringify(data) === JSON.stringify(before) && JSON.stringify(root) === original) return result;
  const next = { ...root, catalogData: data };
  productData(next);
  if (new TextEncoder().encode(JSON.stringify(next)).byteLength > 1024 * 1024)
    catalogFail("INVALID_INPUT", "Product is too large to save");
  let applied;
  try { applied = await catalog.compareAndSet(root.itemId, stored!.revision, next); }
  catch {
    // A transport error is not proof of a refused write. Reconcile once, without replaying it.
    try {
      if (JSON.stringify((await catalog.getVersioned(root.itemId))?.value) === JSON.stringify(next)) return result;
    } catch { /* The UI must offer a read, not encourage a second write. */ }
    catalogFail("SAVE_OUTCOME_UNKNOWN", "Save outcome unknown. Reload the product to check before saving again.");
  }
  if (!applied.applied)
    catalogFail("COMMAND_CONFLICT", "Product changed; reload before saving");
  return result;
}
