import type { PluginContext, SandboxedRouteContext } from "emdash/plugin";
import {
  addCatalogVariantOption, admitV1CatalogPriceSaveInput, CatalogError, changeCatalogItemSku, createProductForPage, editProduct, isManagedCatalogRecord,
  listCatalogProductSummaries, loadCatalogItemMedia, loadCatalogProduct, normalizeIdentifierPatch, pageProduct,
  saveCatalogItemMedia, saveCatalogProductPrices, setCatalogItemWeight, setCatalogProductArchived, updateCatalogVariantLabels,
} from "../features/catalog/kernel/index.js";
import { loadProductFeedEligibility, setProductFeedEligibility } from "../features/feeds/kernel/index.js";
import { isRecord } from "../shared/record.js";
import { sha256Hex } from "../shared/secret.js";
import { feedEligibility, storage, unique } from "./products.js";

/** Private JSON route for agents and the CLI: what the product page panels read and change (catalog-api-20261027). */
export const CATALOG_API_ROUTE = "catalog";

/**
 * One `op` a request, with the panels' own checks: list, get (by `catalogItemId`, or by `entryId` for a page's product), create (a Draft for
 * the page `entryId`, which must sell no other product, with its price, stock status and weight when given; `commandId` makes a retry find
 * the same product), prices, option, labels, sku, weight, identifiers, archive, media and feeds. Manage stock stays off, as in the panels.
 * Writes return what the core functions return, so a refused write says why. A write may carry
 * `expected`, the code a preview printed: the first 12 hex digits of SHA-256 over the JSON `get` answer
 * (product, pictures and feed channels)
 * for `productId` (a variant's product), else `catalogItemId`.
 */
export async function catalogApi(route: SandboxedRouteContext, ctx: PluginContext): Promise<unknown> {
  const { op, expected, ...input } = isRecord(route.input) ? route.input : {};
  const store = storage(ctx), feeds = feedEligibility(ctx), id = input.catalogItemId as string;
  const read = async (itemId: string) => ({ product: await loadCatalogProduct(store, itemId), media: await loadCatalogItemMedia(store.media, itemId),
    feeds: feeds && await loadProductFeedEligibility(feeds, itemId, store.catalog) });
  if (op === "list") return { products: await listCatalogProductSummaries(store.catalog) };
  if (op === "get") {
    // By page: the product its panel picked, else the one it last sold, as the page's next publish sells it (catalog-page-link-in-commerce-20261029).
    const linked = input.entryId === undefined ? id : await pageProduct(store.pages, String(input.entryId));
    return linked ? read(linked) : { product: null };
  }
  // Every product is made for its page, and a page sells one product (catalog-product-needs-page-20261031); the panel's first Save runs the same function.
  if (op === "create") {
    return createProductForPage(store, input, unique(ctx));
  }
  // Saved only while the product still reads as the preview showed it, checked here rather than by the caller.
  if (expected !== undefined && (await sha256Hex(JSON.stringify(await read((input.productId ?? id) as string)))).slice(0, 12) !== expected)
    throw new CatalogError("COMMAND_CONFLICT", "The product changed since that preview. Nothing changed; preview again.");
  if (op === "prices") return saveCatalogProductPrices(store, admitV1CatalogPriceSaveInput(input, isManagedCatalogRecord(await store.catalog.get(id))));
  if (op === "option") return addCatalogVariantOption(store, input as never, unique(ctx));
  if (op === "labels") return updateCatalogVariantLabels(store, input as never);
  // The item id never changes; a SKU another product has is refused by the store's unique index, proven active first.
  if (op === "sku") return { changed: await changeCatalogItemSku(store.catalog, id, input.sku, unique(ctx)) };
  if (op === "weight") return { changed: await setCatalogItemWeight(store.catalog, id, input.weightOz) };
  if (op === "identifiers") {
    // The identifiers route's checks: a left-out field stays, null or "" clears it.
    const { catalogItemId: _id, ...fields } = input, patch = normalizeIdentifierPatch(fields);
    return { changed: await editProduct(store.catalog, id, item => {
      const next: Record<string, unknown> = { ...item, ...patch };
      for (const [key, value] of Object.entries(patch)) if (value === null) delete next[key];
      return next as never;
    }) };
  }
  if (op === "archive") return { changed: await setCatalogProductArchived(store.catalog, input, undefined, true) };
  if (op === "media") return saveCatalogItemMedia(store, input);
  if (op === "feeds") return setProductFeedEligibility(feeds!, store.catalog, input as never);
  throw new Error("Invalid catalog request");
}
