import type { PluginContext, SandboxedRouteContext } from "emdash/plugin";
import {
  addCatalogVariantOption, admitV1CatalogPriceSaveInput, assertCatalogStorageConstraints, CatalogError, createCatalogItem, editProduct, identifyConfirmedUniqueViolation, isManagedCatalogRecord,
  linkProductPage, listCatalogProductSummaries, loadCatalogItemMedia, loadCatalogProduct, named, normalizeIdentifierPatch, normalizeSku,
  saveCatalogItemMedia, saveCatalogProductPrices, setCatalogItemWeight, setCatalogProductArchived, updateCatalogVariantLabels,
} from "../features/catalog/kernel/index.js";
import { loadProductFeedEligibility, setProductFeedEligibility } from "../features/feeds/kernel/index.js";
import { isRecord } from "../shared/record.js";
import { sha256Hex } from "../shared/secret.js";
import { feedEligibility, storage, unique } from "./products.js";

/** Private JSON route for agents and the CLI: what the product page panels read and change (catalog-api-20261027). */
export const CATALOG_API_ROUTE = "catalog";

/**
 * One `op` a request, with the panels' own checks: list, get, create (a physical Draft, linked to
 * `entryId` when given; `commandId` makes a retry find the same product), link, prices, choice, labels, sku,
 * weight, identifiers, archive, media and feeds. Manage stock stays off, as in the panels.
 * Writes return what the core functions return, so a refused write says why. A write may carry
 * `expected`, the code a preview printed: the first 12 hex digits of SHA-256 over the JSON `get` answer
 * (product, pictures and feed channels)
 * for `productId` (a choice's product), else `catalogItemId`.
 */
export async function catalogApi(route: SandboxedRouteContext, ctx: PluginContext): Promise<unknown> {
  const { op, expected, ...input } = isRecord(route.input) ? route.input : {};
  const store = storage(ctx), feeds = feedEligibility(ctx), id = input.catalogItemId as string;
  const read = async (itemId: string) => ({ product: await loadCatalogProduct(store, itemId), media: await loadCatalogItemMedia(store.media, itemId),
    feeds: feeds && await loadProductFeedEligibility(feeds, itemId) });
  if (op === "list") return { products: await listCatalogProductSummaries(store.catalog) };
  if (op === "get") return read(id);
  if (op === "create") {
    const made = (await createCatalogItem(store.catalog,
      { commandId: input.commandId, name: input.name, sku: input.sku, fulfillment: "physical" }, { ...unique(ctx), offSale: true })).item.itemId;
    if (input.entryId !== undefined) await linkProductPage(store, String(input.entryId), made);
    return { catalogItemId: made };
  }
  // Saved only while the product still reads as the preview showed it, checked here rather than by the caller.
  if (expected !== undefined && (await sha256Hex(JSON.stringify(await read((input.productId ?? id) as string)))).slice(0, 12) !== expected)
    throw new CatalogError("COMMAND_CONFLICT", "The product changed since that preview. Nothing changed; preview again.");
  if (op === "link") return { linked: await linkProductPage(store, String(input.entryId), id).then(() => true) };
  if (op === "prices") return saveCatalogProductPrices(store, admitV1CatalogPriceSaveInput(input, isManagedCatalogRecord(await store.catalog.get(id))));
  if (op === "choice") return addCatalogVariantOption(store, input as never, unique(ctx));
  if (op === "labels") return updateCatalogVariantLabels(store, input as never);
  if (op === "sku") {
    // The item id never changes; a SKU another product has is refused by the store's unique index,
    // which must be proven active first, as setCatalogItemSku does.
    const sku = normalizeSku(input.sku), { collection, pluginId } = unique(ctx);
    await assertCatalogStorageConstraints(store.catalog, collection, pluginId);
    try {
      return { changed: await editProduct(store.catalog, id, item => item.sku === sku && item.skuKey === sku ? null : { ...named(item, item.name), sku, skuKey: sku }) };
    } catch (error) {
      if (identifyConfirmedUniqueViolation(error, collection, pluginId) === "skuKey") throw new CatalogError("SKU_CONFLICT", "sku is already assigned to another catalog item");
      throw error;
    }
  }
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
