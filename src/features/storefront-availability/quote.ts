import {
  loadCatalogItemBackorderPolicy,
  resolveCatalogItemPrice,
  resolveCatalogVariantMember,
  variantSelections,
} from "../catalog/kernel/index.js";
import { normalizeStoredStockManagement } from "../inventory-provider/kernel/index.js";
import { loadStoreInventoryConfiguration } from "../inventory-setup/kernel/index.js";
import type { CatalogQuote, CatalogQuoteLine } from "../../handoffs/catalog-quote.js";
import { resolveStorefrontAvailability } from "./resolve.js";
import type {
  ResolveStorefrontAvailabilityExecution,
  StorefrontAvailabilityResolverStorage,
} from "./types.js";

/**
 * Catalog's answer to Checkout for one basket, in cart order. Reads only
 * Catalog-side storage. The first line that cannot be sold decides the reason.
 */
export async function quoteCatalogBasket(
  storage: StorefrontAvailabilityResolverStorage,
  catalogItemIds: readonly string[],
  execution: ResolveStorefrontAvailabilityExecution,
): Promise<CatalogQuote> {
  const lines: CatalogQuoteLine[] = [];
  let inventory;
  for (const catalogItemId of catalogItemIds) {
    const resolved = await resolveCatalogVariantMember(storage.catalog, catalogItemId);
    if (!resolved) return { ok: false, reason: "unavailable" };
    const { item, product, member } = resolved;
    const variant = product && member
      ? { productId: product.productId, selections: variantSelections(product, member), fulfillment: member.fulfillment }
      : undefined;
    if (!(await resolveStorefrontAvailability(storage, { catalogItemId }, execution)).sellable) {
      return { ok: false, reason: "unavailable" };
    }
    const unitPrice = (await resolveCatalogItemPrice(storage.prices, catalogItemId)).customerPays;
    if (!unitPrice) return { ok: false, reason: "unpriced" };
    const fulfillment = member?.fulfillment ?? item.fulfillment ?? "physical";
    const line: CatalogQuoteLine = { catalogItemId, name: item.name, unitPrice, fulfillment, ...(variant ? { variant } : {}) };
    const management = normalizeStoredStockManagement(item.stockManagement);
    if (management.mode === "managed") {
      if (management.status !== "active") return { ok: false, reason: "inventory-setup" };
      if (!inventory) {
        inventory = (await loadStoreInventoryConfiguration(storage.configurations))?.binding;
        if (!inventory) return { ok: false, reason: "inventory-unavailable" };
      }
      line.stock = {
        skuId: management.inventorySkuId,
        allowBackorders: (await loadCatalogItemBackorderPolicy(storage.backorderPolicies, item.itemId)).allowBackorders,
      };
    }
    lines.push(line);
  }
  return { ok: true, lines, ...(inventory ? { inventory } : {}) };
}
