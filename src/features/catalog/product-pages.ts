import type { StorageCollection } from "emdash";
import { isRecord } from "../../shared/record.js";
import { CatalogError } from "./errors.js";
import { normalizeProductName } from "./normalize.js";
import { editProduct, named, offShop } from "./product-edit.js";
import type { CatalogItemRecord, CatalogStorageRecord } from "./types.js";

/**
 * Which product page sells which Commerce product. Commerce never reads the
 * CMS: the page's own Commerce panel and the store's publish check tell it.
 * Every product is made for its page (catalog-product-needs-page-20261031).
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
type Catalog = Pick<StorageCollection<CatalogStorageRecord>, "getVersioned" | "compareAndSet" | "compareAndDelete" | "deleteMany">;
/** A product's own rows outside catalog_items, each keyed by its item id: prices, stock, backorders, media, feeds. */
type ProductRows = Pick<StorageCollection<unknown>, "deleteMany">[];

function id(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 1024) throw new CatalogError("INVALID_INPUT", field + " must be a valid id");
  return value.trim();
}
const conflict = () => new CatalogError("PRODUCT_PAGE_CONFLICT", "Another page sells this product");
/** Refuses a product that is gone; the panels answer with the same words. */
export const productNotFound = (): never => { throw new CatalogError("CATALOG_ITEM_NOT_FOUND", "Product not found."); };

/** The product a page's panel picked, else the one its publish check sold; `sold` asks for the sold one first. */
export async function pageProduct(pages: ProductPages, entryId: string, sold?: boolean): Promise<string | undefined> {
  const rows = (await pages.query({ where: { entryId }, limit: 10 })).items;
  return (rows.find(row => row.id.startsWith(sold ? "p:" : "e:")) ?? rows[0])?.data.catalogItemId;
}

/**
 * Claims an empty page for a new product: its note is written only while no
 * other note exists, so of two creates for one page only one sells it. False
 * when another product took the page first.
 */
export async function claimProductPage(storage: { catalog: Catalog; pages: ProductPages }, entryId: string, catalogItemId: string): Promise<boolean> {
  await editProduct(storage.catalog, catalogItemId, item => {
    if (item.pageId && item.pageId !== entryId) throw conflict();
    return null;
  });
  return (await storage.pages.compareAndSet("e:" + entryId, null, { entryId, catalogItemId })).applied;
}

/** Notes the picked product; missing products, choice IDs and products another page sells are refused. */
export async function linkProductPage(storage: { catalog: Catalog; pages: ProductPages }, entryId: string, catalogItemId: string): Promise<void> {
  await editProduct(storage.catalog, catalogItemId, item => {
    if (item.pageId && item.pageId !== entryId) throw conflict();
    return null; // Validate the product without changing it; only the page's pick is written.
  });
  await storage.pages.put("e:" + entryId, { entryId, catalogItemId });
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
export async function setProductPageOnSale(storage: { catalog: Catalog; pages: ProductPages; rows?: ProductRows }, input: unknown): Promise<{ changed: boolean }> {
  if (!isRecord(input)) throw new CatalogError("INVALID_INPUT", "request body must be an object");
  const { onSale, deleted } = input, entryId = id(input.entryId, "entryId"), { catalog, pages } = storage, key = "p:" + entryId;
  // Commerce holds the page's link (catalog-page-link-in-commerce-20261029): a publish sells the panel's pick, and
  // every other change acts on what the page sold. An older store still names the product itself.
  const catalogItemId = input.catalogItemId === undefined
    ? await pageProduct(pages, entryId, onSale !== true) ?? productNotFound()
    : id(input.catalogItemId, "catalogItemId");
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
  // A permanent delete that stopped after deleting a product finds it gone, and goes on with the rest.
  const gone = (error: CatalogError) => { if (!deleted || error.code !== "CATALOG_ITEM_NOT_FOUND") throw error; };
  // Only while the claim that took it still holds: give a product back, off the shop with no page.
  const release = (itemId: string, token?: string) => editProduct(catalog, itemId, item => {
    if (!token || item.pageClaim !== token) return null;
    const { pageId: _page, pageClaim: _claim, ...rest } = item;
    return { ...rest, offSale: true };
  });
  await editProduct(catalog, catalogItemId, item => {
    if (item.pageId && item.pageId !== entryId) throw conflict();
    changed = !offShop(item) !== onSale;
    // A page deleted for good keeps its products until they are gone, so no other page can take one halfway.
    return { ...(name ? named(item, name) : item), offSale: onSale ? undefined : true, pageId: entryId, pageClaim: claim, deleting: deleted };
  }).catch(gone);
  // A check that stopped after selling the panel's pick, before moving the pointer, left that pick on sale under this
  // page; taking the page off the shop withdraws it too (catalog-archive-is-page-trash-20261115), and deleting it for
  // good withdraws it before deleting it below, so a delete that stops halfway leaves nothing on sale.
  const pick = input.catalogItemId === undefined && !onSale ? await pageProduct(pages, entryId) : undefined;
  if (pick && pick !== catalogItemId) await editProduct(catalog, pick, item => {
    // Deleted for good, it is held like the page's own product, so a variant added meanwhile is not kept.
    if (item.pageId !== entryId || item.offSale && item.deleting === deleted) return null;
    changed ||= !offShop(item);
    return { ...item, offSale: true, deleting: deleted };
  }).catch(gone);
  // Give the old product up before the pointer moves, so a check that stops halfway is finished by the next one.
  if (old && old.catalogItemId !== catalogItemId) await release(old.catalogItemId, old.claim);
  // The page is gone for good, so its products are too, freeing their SKUs (catalog-permanent-delete-20261122). Its
  // links go only after them, so the same request finishes a delete that stopped.
  if (deleted) for (const itemId of new Set([catalogItemId, pick])) if (itemId) await forgetProduct(catalog, storage.rows, itemId, entryId);
  const moved = deleted ? !mine || (await pages.compareAndDelete(key, mine.revision)).applied
    : (await pages.compareAndSet(key, mine?.revision ?? null, { entryId, catalogItemId, claim })).applied;
  if (!moved && (await pages.get(key))?.catalogItemId !== catalogItemId) {
    await release(catalogItemId, claim);
    throw conflict();
  }
  if (deleted) await pages.delete("e:" + entryId);
  return { changed };
}

/**
 * Deletes a product the deleted page still holds, with every variant and their own rows, in one call per collection
 * whatever its size; orders keep their own copy. The product's own item goes last, and only while it is as read, so a
 * variant added meanwhile is deleted too, and a delete that stops halfway leaves it, still held by the page, to delete again.
 */
async function forgetProduct(catalog: Catalog, rows: ProductRows = [], itemId: string, entryId: string): Promise<void> {
  const stored = await catalog.getVersioned(itemId), item = stored?.value as CatalogItemRecord | undefined;
  if (item?.pageId !== entryId) return;
  const variants = (item.variantProduct?.members ?? []).map(member => member.catalogItemId).filter(id => id !== itemId);
  for (const row of rows) await row.deleteMany([...variants, itemId]);
  await catalog.deleteMany(variants);
  // Changed since it was read, such as a variant added: read it again.
  if (!(await catalog.compareAndDelete(itemId, stored!.revision)).applied) await forgetProduct(catalog, rows, itemId, entryId);
}
