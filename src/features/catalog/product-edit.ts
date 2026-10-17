import type { StorageCollection } from "emdash";
import { CatalogError } from "./errors.js";
import { normalizeProductName } from "./normalize.js";
import type { CatalogItemRecord, CatalogStorageRecord } from "./types.js";

type Catalog = Pick<StorageCollection<CatalogStorageRecord>, "getVersioned" | "compareAndSet">;

function itemId(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 1024) throw new CatalogError("INVALID_INPUT", "catalogItemId must be a valid itemId");
  return value;
}

/**
 * Applies one edit to a product and, for a product with choices, to each of its
 * choices, so the cart, checkout and new orders all see it. Each record retries a
 * racing write and is skipped when it already matches, so a retry finishes the job.
 */
async function editProduct(catalog: Catalog, catalogItemId: string,
  edit: (item: CatalogItemRecord) => CatalogItemRecord | null): Promise<boolean> {
  let changed = false;
  const ids = [catalogItemId];
  for (const [index, id] of ids.entries()) {
    for (let attempt = 0; ; attempt += 1) {
      if (attempt === 4) throw new CatalogError("STORAGE_UNAVAILABLE", "Not saved because the product kept changing. Try again.");
      const stored = await catalog.getVersioned(id);
      const current = stored?.value as CatalogItemRecord | undefined;
      if (!stored || current?.recordKind !== "catalog-item" || current.itemId !== id || (!index && current.variantProductId)) {
        throw new CatalogError("CATALOG_ITEM_NOT_FOUND", "Product not found. Return to Products.");
      }
      if (!index) for (const member of current.variantProduct?.members ?? []) if (member.catalogItemId !== id) ids.push(member.catalogItemId);
      const next = edit(current);
      if (!next) break;
      if ((await catalog.compareAndSet(id, stored.revision, next)).applied) { changed = true; break; }
    }
  }
  return changed;
}

/** Renames a product. Past orders keep the name the product had when it was bought. */
export async function renameCatalogProduct(catalog: Catalog, input: { catalogItemId?: unknown; name?: unknown }): Promise<boolean> {
  const name = normalizeProductName(input.name);
  return editProduct(catalog, itemId(input.catalogItemId), (item) => item.name === name ? null : {
    ...item, name,
    creationPayload: item.creationPayload ?? { kind: item.kind, name: item.name, sku: item.sku, skuKey: item.skuKey, manageStock: item.creationIntent?.manageStock ?? false },
  });
}

/** Archives a product (off the shop, not for sale) or restores it. Nothing is deleted. */
export async function setCatalogProductArchived(catalog: Catalog, input: { catalogItemId?: unknown; archived?: unknown }, now = () => new Date()): Promise<boolean> {
  if (typeof input.archived !== "boolean") throw new CatalogError("INVALID_INPUT", "archived must be true or false");
  const archivedAt = now().toISOString();
  return editProduct(catalog, itemId(input.catalogItemId), (item) => {
    if (Boolean(item.archivedAt) === input.archived) return null;
    const { archivedAt: _old, ...rest } = item;
    return input.archived ? { ...rest, archivedAt } : rest;
  });
}
