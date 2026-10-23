import type { StorageCollection } from "emdash";
import { isRecord } from "../../shared/record.js";
import { CatalogError } from "./errors.js";
import { setCatalogProductOnSale } from "./product-edit.js";
import type { CatalogStorageRecord } from "./types.js";

/**
 * Which product page sells which Commerce product, keyed by the page's entry id.
 * Commerce never reads the CMS: the page's own Commerce panel and the store's
 * publish check tell it, so Commerce Settings can list products without a page.
 */
export const PRODUCT_PAGES_COLLECTION = "product_pages";
export interface ProductPageRecord {
  entryId: string;
  catalogItemId: string;
}
export type ProductPages = Pick<StorageCollection<ProductPageRecord>, "get" | "put" | "delete" | "query">;
type Catalog = Pick<StorageCollection<CatalogStorageRecord>, "getVersioned" | "compareAndSet">;

function id(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 1024) throw new CatalogError("INVALID_INPUT", field + " must be a valid id");
  return value.trim();
}

/** Links a page to its product. One product has one page: a product another page sells is refused. */
export async function linkProductPage(pages: ProductPages, entryId: string, catalogItemId: string): Promise<void> {
  if ((await pages.query({ where: { catalogItemId }, limit: 2 })).items.some(row => row.id !== entryId)) {
    throw new CatalogError("PRODUCT_PAGE_CONFLICT", "Another page sells this product");
  }
  await pages.put(entryId, { entryId, catalogItemId });
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
 * sale; unpublishing or deleting the page takes it back to Draft. A deleted
 * page also drops its link, so the product shows as having no page. A page
 * naming a product another page sells is refused, so it changes nothing.
 */
export async function setProductPageOnSale(storage: { catalog: Catalog; pages: ProductPages }, input: unknown): Promise<{ changed: boolean }> {
  if (!isRecord(input)) throw new CatalogError("INVALID_INPUT", "request body must be an object");
  const catalogItemId = id(input.catalogItemId, "catalogItemId");
  const entryId = input.entryId === undefined ? undefined : id(input.entryId, "entryId");
  if (input.deleted !== undefined && (input.deleted !== true || input.onSale !== false || !entryId)) throw new CatalogError("INVALID_INPUT", "Invalid deleted");
  // A page can only change the product it sells: one another page already sells is refused before any write.
  if (entryId) await linkProductPage(storage.pages, entryId, catalogItemId);
  const changed = await setCatalogProductOnSale(storage.catalog, { catalogItemId, onSale: input.onSale });
  if (entryId && input.deleted) await storage.pages.delete(entryId);
  return { changed };
}
