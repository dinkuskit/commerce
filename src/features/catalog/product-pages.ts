import type { StorageCollection } from "emdash";
import { isRecord } from "../../shared/record.js";
import { CatalogError } from "./errors.js";
import { setCatalogProductOnSale } from "./product-edit.js";
import type { CatalogItemRecord, CatalogStorageRecord } from "./types.js";

/**
 * Which product page sells which Commerce product. Commerce never reads the
 * CMS: the page's own Commerce panel and the store's publish check tell it, so
 * Commerce Settings can list products without a page.
 *
 * Two kinds of row share the collection:
 * - `e:<entryId>`: the panel's note of the product an editor picked. It is only
 *   a convenience for reopening the panel and never decides who sells what.
 * - `<catalogItemId>`: which page sells the product, written only by the
 *   publish check, one row per product, so one product has one page.
 */
export const PRODUCT_PAGES_COLLECTION = "product_pages";
export interface ProductPageRecord {
  entryId: string;
  catalogItemId: string;
}
export type ProductPages = Pick<StorageCollection<ProductPageRecord>, "get" | "put" | "getVersioned" | "compareAndSet" | "compareAndDelete" | "delete" | "query">;
type Catalog = Pick<StorageCollection<CatalogStorageRecord>, "getVersioned" | "compareAndSet">;

function id(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 1024) throw new CatalogError("INVALID_INPUT", field + " must be a valid id");
  return value.trim();
}
const conflict = () => new CatalogError("PRODUCT_PAGE_CONFLICT", "Another page sells this product");

/** The product a page's panel picked, else the one its publish check recorded. */
export async function pageProduct(pages: ProductPages, entryId: string): Promise<string | undefined> {
  const rows = (await pages.query({ where: { entryId }, limit: 10 })).items;
  return (rows.find(row => row.id.startsWith("e:")) ?? rows[0])?.data.catalogItemId;
}

/** The panel notes the product an editor picked; a product another page's publish check recorded is refused. */
export async function linkProductPage(pages: ProductPages, entryId: string, catalogItemId: string): Promise<void> {
  const owner = (await pages.get(catalogItemId))?.entryId;
  if (owner && owner !== entryId) throw conflict();
  await pages.put("e:" + entryId, { entryId, catalogItemId });
}

/** Every linked product id, so Settings can show the ones no page sells. */
export async function productPageLinks(pages: ProductPages): Promise<Set<string>> {
  const linked = new Set<string>();
  let cursor: string | undefined;
  do {
    const found = await pages.query({ limit: 100, cursor });
    for (const row of found.items) linked.add(row.data.catalogItemId);
    cursor = found.hasMore ? found.cursor : undefined;
  } while (cursor);
  return linked;
}

/**
 * The store's publish check: publishing a product page puts its product on
 * sale; unpublishing or deleting the page takes it back to Draft. The page is
 * required, the whole request and the product are checked before any write,
 * and the page claims the product in one conditional write, so a product
 * another page sells is refused. A page that now sells another product gives
 * up its old one, and a deleted page drops its rows; each removal is
 * conditional on the row still being that page's.
 */
export async function setProductPageOnSale(storage: { catalog: Catalog; pages: ProductPages }, input: unknown): Promise<{ changed: boolean }> {
  if (!isRecord(input)) throw new CatalogError("INVALID_INPUT", "request body must be an object");
  const catalogItemId = id(input.catalogItemId, "catalogItemId"), entryId = id(input.entryId, "entryId"), { pages } = storage;
  if (typeof input.onSale !== "boolean" || (input.deleted !== undefined && (input.deleted !== true || input.onSale))) throw new CatalogError("INVALID_INPUT", "Invalid onSale");
  const item = (await storage.catalog.getVersioned(catalogItemId))?.value as CatalogItemRecord | undefined;
  if (item?.recordKind !== "catalog-item" || item.variantProductId) throw new CatalogError("CATALOG_ITEM_NOT_FOUND", "Product not found.");
  const owner = await pages.getVersioned(catalogItemId);
  if (owner ? owner.value.entryId !== entryId : !(await pages.compareAndSet(catalogItemId, null, { entryId, catalogItemId })).applied) throw conflict();
  const changed = await setCatalogProductOnSale(storage.catalog, { catalogItemId, onSale: input.onSale });
  for (const row of (await pages.query({ where: { entryId }, limit: 10 })).items) {
    if (row.id === catalogItemId && !input.deleted) continue;
    const mine = await pages.getVersioned(row.id);
    if (mine?.value.entryId === entryId) await pages.compareAndDelete(row.id, mine.revision);
  }
  return { changed };
}
