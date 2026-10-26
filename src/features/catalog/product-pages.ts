import type { StorageCollection } from "emdash";
import { isRecord } from "../../shared/record.js";
import { CatalogError } from "./errors.js";
import { normalizeProductName } from "./normalize.js";
import { editProduct, named } from "./product-edit.js";
import type { CatalogItemRecord, CatalogStorageRecord } from "./types.js";

/**
 * Which product page sells which Commerce product. Commerce never reads the
 * CMS: the page's own Commerce panel and the store's publish check tell it, so
 * Commerce Settings can list products without a page.
 *
 * The page that sells a product is kept on the product itself (`pageId`), set
 * by the publish check in the same write that puts it on sale or takes it off,
 * so one product has one page and a page that lost a product can never change
 * it again. Two kinds of row share this collection:
 * - `e:<entryId>`: the panel's note of the product an editor picked. It only
 *   reopens the panel and never decides who sells what.
 * - `p:<entryId>`: the product the page's last publish check sold, so a page
 *   that now sells another product gives the old one up.
 */
export const PRODUCT_PAGES_COLLECTION = "product_pages";
export interface ProductPageRecord {
  entryId: string;
  catalogItemId: string;
  /** On a `p:` row: the claim its check wrote on the product. */
  claim?: string;
}
export type ProductPages = Pick<StorageCollection<ProductPageRecord>, "get" | "put" | "getVersioned" | "compareAndSet" | "compareAndDelete" | "delete" | "query">;
type Catalog = Pick<StorageCollection<CatalogStorageRecord>, "getVersioned" | "compareAndSet">;

function id(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 1024) throw new CatalogError("INVALID_INPUT", field + " must be a valid id");
  return value.trim();
}
const conflict = () => new CatalogError("PRODUCT_PAGE_CONFLICT", "Another page sells this product");

/** The product a page's panel picked, else the one its publish check sold. */
export async function pageProduct(pages: ProductPages, entryId: string): Promise<string | undefined> {
  const rows = (await pages.query({ where: { entryId }, limit: 10 })).items;
  return (rows.find(row => row.id.startsWith("e:")) ?? rows[0])?.data.catalogItemId;
}

/** The panel notes the product an editor picked; a product another page sells is refused. */
export async function linkProductPage(storage: { catalog: Catalog; pages: ProductPages }, entryId: string, catalogItemId: string): Promise<void> {
  const owner = ((await storage.catalog.getVersioned(catalogItemId))?.value as CatalogItemRecord | undefined)?.pageId;
  if (owner && owner !== entryId) throw conflict();
  await storage.pages.put("e:" + entryId, { entryId, catalogItemId });
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
 * required and the whole request is checked before any write. The product's
 * page and its sale state change in one conditional write, refused when
 * another page sells it, and each check writes a fresh claim on the product.
 * The product the page sold before goes back to Draft with no page first, only
 * while the claim that took it still holds, so a newer check that took it
 * again keeps it and a check that stops halfway is finished by the next. The
 * page's own pointer then moves from the revision read before, so of two
 * overlapping checks for one page only one lands; the other gives its product
 * back and is refused. A publish may carry the page's title as `name`: the
 * page title is the product's one name (catalog-page-title-is-name-20261026),
 * saved in that same write.
 */
export async function setProductPageOnSale(storage: { catalog: Catalog; pages: ProductPages }, input: unknown): Promise<{ changed: boolean }> {
  if (!isRecord(input)) throw new CatalogError("INVALID_INPUT", "request body must be an object");
  const catalogItemId = id(input.catalogItemId, "catalogItemId"), entryId = id(input.entryId, "entryId"), { catalog, pages } = storage, key = "p:" + entryId;
  const { onSale, deleted } = input;
  // A title-only write renames the product this page sells, and never changes its sale state or link.
  if (onSale === undefined && deleted === undefined && input.name !== undefined) {
    const name = normalizeProductName(input.name);
    await editProduct(catalog, catalogItemId, item => item.pageId !== entryId || item.name === name ? null : named(item, name));
    return { changed: false };
  }
  if (typeof onSale !== "boolean" || (deleted !== undefined && (deleted !== true || onSale))) throw new CatalogError("INVALID_INPUT", "Invalid onSale");
  const name = onSale && input.name !== undefined ? normalizeProductName(input.name) : undefined;
  const mine = await pages.getVersioned(key), claim = crypto.randomUUID(), old = mine?.value;
  let changed = false;
  // Only while the claim that took it still holds: give a product back, off the shop with no page.
  const release = (itemId: string, token?: string) => editProduct(catalog, itemId, item => {
    if (!token || item.pageClaim !== token) return null;
    const { pageId: _page, pageClaim: _claim, ...rest } = item;
    return { ...rest, offSale: true };
  });
  await editProduct(catalog, catalogItemId, item => {
    if (item.pageId && item.pageId !== entryId) throw conflict();
    const { offSale: _off, pageId: _page, pageClaim: _claim, ...rest } = item;
    changed = !item.offSale !== onSale;
    return { ...(name ? named(rest as CatalogItemRecord, name) : rest), ...(onSale ? {} : { offSale: true as const }), ...(deleted ? {} : { pageId: entryId, pageClaim: claim }) };
  });
  // Give the old product up before the pointer moves, so a check that stops halfway is finished by the next one.
  if (old && old.catalogItemId !== catalogItemId) await release(old.catalogItemId, old.claim);
  const moved = deleted ? !mine || (await pages.compareAndDelete(key, mine.revision)).applied
    : (await pages.compareAndSet(key, mine?.revision ?? null, { entryId, catalogItemId, claim })).applied;
  if (!moved && (await pages.get(key))?.catalogItemId !== catalogItemId) {
    await release(catalogItemId, claim);
    throw conflict();
  }
  if (deleted) await pages.delete("e:" + entryId);
  return { changed };
}
