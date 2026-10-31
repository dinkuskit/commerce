import type { StorageCollection } from "emdash";
import { createCatalogItem } from "./create-catalog-item.js";
import { CatalogError } from "./errors.js";
import { saveCatalogProductPrices, type CatalogProductPriceForm } from "./product-admin.js";
import { setCatalogProductArchived } from "./product-edit.js";
import { claimProductPage, pageProduct, type ProductPages } from "./product-pages.js";
import type { CatalogManualAvailabilityRecord, CatalogPriceRecord, CatalogStorageRecord } from "./types.js";
import { normalizeWeightOz, setCatalogItemWeight } from "./weight.js";

export interface CreateProductForPageInput {
  entryId?: unknown; commandId?: unknown; name?: unknown; sku?: unknown;
  /** physical unless told otherwise; a digital product has no weight. */
  fulfillment?: unknown;
  /** Left out: no price or stock status is written. Given: saved right after the product is made, as the panel's Save does; a refused price comes back in `price`. */
  regular?: unknown; sale?: unknown; stockStatus?: unknown; weightOz?: unknown;
}
export interface CreateProductForPageStorage {
  catalog: StorageCollection<CatalogStorageRecord>;
  pages: ProductPages;
  prices: StorageCollection<CatalogPriceRecord>;
  availability: StorageCollection<CatalogManualAvailabilityRecord>;
}
export interface CreateProductForPageResult {
  catalogItemId: string;
  /** False when the command had already made it. */
  created: boolean;
  /** The price form Commerce answered with, when a price or stock status was sent; `saved: false` says why it was refused. */
  price?: CatalogProductPriceForm;
}
const str = (v: unknown) => v == null ? "" : String(v);

/**
 * Makes a page's product in one go: the Draft, claimed for its page, then its price, stock status and weight.
 * The panel's first Save, the catalog API's `create` and the CLI all call this, so every way of making a product
 * runs the same checks (catalog-product-needs-page-20261031, catalog-first-save-creates-20261031). The weight is
 * checked before anything is written; a price Commerce refuses answers in `price` with the Draft made and linked, so
 * the owner fixes it on the product, and the same `commandId` again finds that product and saves the price again.
 */
export async function createProductForPage(
  storage: CreateProductForPageStorage, raw: CreateProductForPageInput, options: { collection?: string; pluginId?: string } = {},
): Promise<CreateProductForPageResult> {
  if (raw.entryId === undefined) throw new CatalogError("INVALID_INPUT", "entryId is required: make the product's page first");
  const entryId = String(raw.entryId), fulfillment = raw.fulfillment ?? "physical";
  if (fulfillment !== "physical" && fulfillment !== "digital") throw new CatalogError("INVALID_INPUT", "fulfillment must be physical or digital");
  const priced = raw.regular !== undefined || raw.sale !== undefined || raw.stockStatus !== undefined;
  const regular = str(raw.regular), sale = str(raw.sale);
  const weightOz = normalizeWeightOz(raw.weightOz ?? null);
  if (weightOz !== null && fulfillment === "digital") throw new CatalogError("INVALID_INPUT", "A digital product has no weight");
  // A page sells one product; the same command again finds the one it made.
  const sold = await pageProduct(storage.pages, entryId);
  const taken = () => new CatalogError("PRODUCT_PAGE_CONFLICT", "This page already sells a product");
  if (sold && (await storage.catalog.get(sold) as { commandId?: unknown } | null)?.commandId !== raw.commandId) throw taken();
  // createCatalogItem checks the input and answers a repeated command with the product it made, refusing changed input.
  const { created, item } = await createCatalogItem(storage.catalog,
    { commandId: raw.commandId, name: raw.name, sku: raw.sku, fulfillment }, { ...options, offSale: true });
  if (sold) { if (item.itemId !== sold) throw taken(); }
  else if (!(await claimProductPage(storage, entryId, item.itemId) || await pageProduct(storage.pages, entryId) === item.itemId)) {
    // Another create took the page first: the Draft this one just made is archived, never left off every page.
    if (created) await setCatalogProductArchived(storage.catalog, { catalogItemId: item.itemId, archived: true });
    throw taken();
  }
  const price = priced ? await saveCatalogProductPrices(storage, { catalogItemId: item.itemId, regular, sale,
    ...(raw.stockStatus === undefined ? {} : { stockStatus: raw.stockStatus as string }) }) : undefined;
  if (weightOz !== null) await setCatalogItemWeight(storage.catalog, item.itemId, weightOz);
  return { catalogItemId: item.itemId, created, price };
}
