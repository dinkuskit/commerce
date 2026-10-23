import type { StorageCollection } from "emdash";
import { isRecord } from "../../shared/record.js";
import { CatalogError } from "./errors.js";
import { setCatalogProductOnSale } from "./product-edit.js";
import type { CatalogStorageRecord } from "./types.js";

/**
 * Which product page sells which Commerce product, keyed by the product id so
 * one product has one page. Commerce never reads the CMS: the page's own
 * Commerce panel and the store's publish check tell it, so Commerce Settings
 * can list products without a page.
 */
export const PRODUCT_PAGES_COLLECTION = "product_pages";
export interface ProductPageRecord {
  entryId: string;
  catalogItemId: string;
  /** Set by the publish check. Without it the link is the panel's, unsaved until the page is published. */
  confirmed?: true;
}
export type ProductPages = Pick<StorageCollection<ProductPageRecord>, "get" | "getVersioned" | "compareAndSet" | "delete" | "query">;
type Catalog = Pick<StorageCollection<CatalogStorageRecord>, "getVersioned" | "compareAndSet">;

function id(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 1024) throw new CatalogError("INVALID_INPUT", field + " must be a valid id");
  return value.trim();
}
const conflict = () => new CatalogError("PRODUCT_PAGE_CONFLICT", "Another page sells this product");

/** The product a page sells, if it has a link. */
export async function pageProduct(pages: ProductPages, entryId: string): Promise<string | undefined> {
  return (await pages.query({ where: { entryId }, limit: 1 })).items[0]?.data.catalogItemId;
}

/**
 * Claims a product for a page in one conditional write, so two pages can never
 * both hold it. A product another page's publish check confirmed is refused; an
 * unconfirmed panel link of another page gives way. The page's other links go.
 */
export async function linkProductPage(pages: ProductPages, entryId: string, catalogItemId: string, confirmed = false): Promise<void> {
  const current = await pages.getVersioned(catalogItemId), mine = current?.value.entryId === entryId;
  if (current && !mine && current.value.confirmed) throw conflict();
  const keep = confirmed || (mine && current.value.confirmed);
  if (!(await pages.compareAndSet(catalogItemId, current?.revision ?? null, { entryId, catalogItemId, ...(keep ? { confirmed: true as const } : {}) })).applied) throw conflict();
  for (const row of (await pages.query({ where: { entryId }, limit: 10 })).items) if (row.id !== catalogItemId) await pages.delete(row.id);
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
 * page also drops its link, so the product shows as having no page. The whole
 * request is checked before anything is written, and the page's claim on the
 * product is made first, so a page naming a product another page's publish
 * check confirmed changes nothing.
 */
export async function setProductPageOnSale(storage: { catalog: Catalog; pages: ProductPages }, input: unknown): Promise<{ changed: boolean }> {
  if (!isRecord(input)) throw new CatalogError("INVALID_INPUT", "request body must be an object");
  const catalogItemId = id(input.catalogItemId, "catalogItemId");
  const entryId = input.entryId === undefined ? undefined : id(input.entryId, "entryId");
  if (typeof input.onSale !== "boolean" || (input.deleted !== undefined && (input.deleted !== true || input.onSale || !entryId))) throw new CatalogError("INVALID_INPUT", "Invalid onSale");
  if (!await storage.catalog.getVersioned(catalogItemId)) throw new CatalogError("CATALOG_ITEM_NOT_FOUND", "Product not found.");
  if (entryId) await linkProductPage(storage.pages, entryId, catalogItemId, true);
  const changed = await setCatalogProductOnSale(storage.catalog, { catalogItemId, onSale: input.onSale });
  if (entryId && input.deleted) await storage.pages.delete(catalogItemId);
  return { changed };
}
