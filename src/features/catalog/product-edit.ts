import type { StorageCollection } from "emdash";
import { CatalogError } from "./errors.js";
import { normalizeProductName, normalizeSku } from "./normalize.js";
import { assertCatalogStorageConstraints, identifyConfirmedUniqueViolation } from "./storage-constraints.js";
import type { CatalogItemRecord, CatalogStorage, CatalogStorageRecord } from "./types.js";

type Catalog = Pick<StorageCollection<CatalogStorageRecord>, "getVersioned" | "compareAndSet">;

/**
 * Applies one edit to a product's own record, which speaks for each of its
 * choices: the shop, cart and checkout read the name and archive state from it.
 * One compare-and-set per edit, so two edits can never leave a mix.
 */
export async function editProduct(catalog: Catalog, catalogItemId: unknown,
  edit: (item: CatalogItemRecord) => CatalogItemRecord | null, variants = false): Promise<boolean> {
  if (typeof catalogItemId !== "string" || !catalogItemId || catalogItemId.length > 1024) throw new CatalogError("INVALID_INPUT", "catalogItemId must be a valid itemId");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stored = await catalog.getVersioned(catalogItemId);
    const current = stored?.value as CatalogItemRecord | undefined;
    // A variant's own record is edited only where the edit is its own fact, such as its SKU.
    if (!stored || current?.recordKind !== "catalog-item" || current.itemId !== catalogItemId || (current.variantProductId && !variants)) {
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
  return editProduct(catalog, input.catalogItemId, (item) => item.name === name ? null : named(item, name));
}

/** The product under a new name, keeping the first creationPayload. */
export const named = (item: CatalogItemRecord, name: string): CatalogItemRecord => ({
  ...item, name,
  creationPayload: item.creationPayload ?? { kind: item.kind, name: item.name, sku: item.sku, skuKey: item.skuKey, manageStock: item.creationIntent?.manageStock ?? false },
});

/** Archives a product (off the shop, not for sale) or restores it as a Draft. Nothing is deleted. */
/**
 * Archives or restores a product. The product page panel restores it as a Draft (`toDraft`) for its page's publish
 * check to put back on sale; the native Products screen, which has no page, restores it straight onto the shop.
 */
export async function setCatalogProductArchived(catalog: Catalog, input: { catalogItemId?: unknown; archived?: unknown }, now = () => new Date(), toDraft = false): Promise<boolean> {
  if (typeof input.archived !== "boolean") throw new CatalogError("INVALID_INPUT", "archived must be true or false");
  const archivedAt = now().toISOString();
  return editProduct(catalog, input.catalogItemId, (item) => {
    if (Boolean(item.archivedAt) === input.archived) return null;
    const { archivedAt: _old, ...rest } = item;
    return input.archived ? { ...rest, archivedAt } : toDraft ? { ...rest, offSale: true } : rest;
  });
}

/** Puts a product on sale or takes it back to Draft. Only the store's publish check calls this; Commerce never reads the page. */
export async function setCatalogProductOnSale(catalog: Catalog, input: { catalogItemId?: unknown; onSale?: unknown }): Promise<boolean> {
  if (typeof input.onSale !== "boolean") throw new CatalogError("INVALID_INPUT", "onSale must be true or false");
  return editProduct(catalog, input.catalogItemId, (item) => {
    if (!item.offSale === input.onSale) return null;
    const { offSale: _old, ...rest } = item;
    return input.onSale ? rest : { ...rest, offSale: true };
  });
}

/** Off the shop and refused at checkout: archived, or a Draft whose page is not published. */
export function offShop(item: { archivedAt?: string; offSale?: true } | null | undefined): boolean {
  return Boolean(item?.archivedAt || item?.offSale);
}

/**
 * Changes a product's SKU; the item id never changes. A SKU another product has is refused by the
 * store's unique index, which must be proven active first. The panel's Save and the catalog API's
 * `sku` op both come here.
 */
export async function changeCatalogItemSku(catalog: Catalog & CatalogStorage, catalogItemId: unknown, raw: unknown,
  options: { collection?: string; pluginId?: string } = {}): Promise<boolean> {
  const sku = normalizeSku(raw);
  await assertCatalogStorageConstraints(catalog, options.collection, options.pluginId);
  try {
    return await editProduct(catalog, catalogItemId, item => item.sku === sku && item.skuKey === sku ? null : { ...named(item, item.name), sku, skuKey: sku }, true);
  } catch (error) {
    if (identifyConfirmedUniqueViolation(error, options.collection, options.pluginId) === "skuKey") throw new CatalogError("SKU_CONFLICT", "sku is already assigned to another catalog item");
    throw error;
  }
}
