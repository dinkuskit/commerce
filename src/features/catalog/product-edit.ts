import type { StorageCollection } from "emdash";
import { CatalogError } from "./errors.js";
import { normalizeProductName } from "./normalize.js";
import type { CatalogItemRecord, CatalogStorageRecord } from "./types.js";

type Catalog = Pick<StorageCollection<CatalogStorageRecord>, "getVersioned" | "compareAndSet">;

/**
 * Applies one edit to a product's own record, which speaks for each of its
 * choices: the shop, cart and checkout read the name and archive state from it.
 * One compare-and-set per edit, so two edits can never leave a mix.
 */
async function editProduct(catalog: Catalog, catalogItemId: unknown,
  edit: (item: CatalogItemRecord) => CatalogItemRecord | null): Promise<boolean> {
  if (typeof catalogItemId !== "string" || !catalogItemId || catalogItemId.length > 1024) throw new CatalogError("INVALID_INPUT", "catalogItemId must be a valid itemId");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stored = await catalog.getVersioned(catalogItemId);
    const current = stored?.value as CatalogItemRecord | undefined;
    if (!stored || current?.recordKind !== "catalog-item" || current.itemId !== catalogItemId || current.variantProductId) {
      throw new CatalogError("CATALOG_ITEM_NOT_FOUND", "Product not found. Return to Products.");
    }
    const next = edit(current);
    if (!next) return false;
    if ((await catalog.compareAndSet(catalogItemId, stored.revision, next)).applied) return true;
  }
  throw new CatalogError("STORAGE_UNAVAILABLE", "Not saved because the product kept changing. Try again.");
}

/** Renames a product. Past orders keep the name the product had when it was bought. */
export async function renameCatalogProduct(catalog: Catalog, input: { catalogItemId?: unknown; name?: unknown }): Promise<boolean> {
  const name = normalizeProductName(input.name);
  return editProduct(catalog, input.catalogItemId, (item) => item.name === name ? null : {
    ...item, name,
    creationPayload: item.creationPayload ?? { kind: item.kind, name: item.name, sku: item.sku, skuKey: item.skuKey, manageStock: item.creationIntent?.manageStock ?? false },
  });
}

/** Archives a product (off the shop, not for sale) or restores it. Nothing is deleted. */
export async function setCatalogProductArchived(catalog: Catalog, input: { catalogItemId?: unknown; archived?: unknown }, now = () => new Date()): Promise<boolean> {
  if (typeof input.archived !== "boolean") throw new CatalogError("INVALID_INPUT", "archived must be true or false");
  const archivedAt = now().toISOString();
  return editProduct(catalog, input.catalogItemId, (item) => {
    if (Boolean(item.archivedAt) === input.archived) return null;
    const { archivedAt: _old, ...rest } = item;
    return input.archived ? { ...rest, archivedAt } : rest;
  });
}
