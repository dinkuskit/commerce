import type { PluginContext } from "emdash/plugin";
import { resolveCatalogItemPrice } from "./price.js";
import { resolveStorefrontAvailability } from "../storefront-availability/kernel/index.js";
import type { CatalogStorageRecord } from "./types.js";
import { bindGuestCheckoutRuntime, SANDBOX_GUEST_CHECKOUT_STORAGE } from "../checkout/kernel/index.js";
import type { StorefrontAvailabilityResult } from "../storefront-availability/kernel/index.js";

function unavailable(): never { throw new Error("Catalog unavailable"); }

export const PUBLIC_CATALOG_ROUTE = "catalog/public";
export interface PublicCatalogProduct {
  readonly id: string;
  readonly name: string;
  readonly sku: string;
  readonly price: { readonly currency: "USD"; readonly minor: string };
  readonly availability: Pick<StorefrontAvailabilityResult, "status" | "sellable" | "listable">;
}
export interface PublicCatalogResponse {
  readonly products: readonly PublicCatalogProduct[];
  readonly cursor?: string;
}

/** Runtime-owned context only. Structural storage access does not attest installation. */
export async function readPublicCatalog(ctx: PluginContext, cursor?: string): Promise<PublicCatalogResponse> {
  if (cursor !== undefined && (!cursor || cursor.length > 1024)) unavailable();
  const c = ctx.storage;
  const storage = bindGuestCheckoutRuntime(c, SANDBOX_GUEST_CHECKOUT_STORAGE, { runtimeSiteUrl: ctx.site.url }).catalog;
  const page = await c.catalog_items!.query({ limit: 50, cursor });
  if (page.items.length > 50 || (page.hasMore && (!page.cursor || page.cursor === cursor || page.cursor.length > 1024))) {
    unavailable();
  }
  const products: PublicCatalogProduct[] = [];
  for (const row of page.items) {
    const item = row.data as unknown as CatalogStorageRecord;
    if (item.recordKind !== "catalog-item") continue;
    if (row.id !== item.itemId || [item.itemId, item.name, item.sku].some(value => typeof value !== "string" || !value || value.length > 1024)) unavailable();
    const availability = await resolveStorefrontAvailability(storage, { catalogItemId: item.itemId });
    const price = await resolveCatalogItemPrice(storage.prices, item.itemId);
    if (!price.listable || !price.customerPays || !availability.listable) continue;
    products.push({ id: item.itemId, name: item.name, sku: item.sku, price: price.customerPays,
      availability: { status: availability.status, sellable: availability.sellable, listable: availability.listable } });
  }
  return { products, ...(page.hasMore ? { cursor: page.cursor } : {}) };
}
