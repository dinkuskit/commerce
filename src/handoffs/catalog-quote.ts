import type { CatalogFulfillment, Money } from "../features/catalog/kernel/index.js";
import type { InventoryProviderBinding } from "../features/inventory-provider/kernel/index.js";

/**
 * Catalog to Checkout. Checkout asks once per basket; Catalog answers with
 * each item's name, price and whether it can be sold, plus what Inventory must
 * hold. Inside one plugin this is a function call; across plugins it is a
 * same-moment request and reply. See docs/contracts/commerce-handoffs.md.
 */
export interface CatalogQuoteLine {
  catalogItemId: string;
  name: string;
  unitPrice: Money;
  /** Present when the item is one choice of a product with options. */
  variant?: {
    productId: string;
    selections: readonly { optionId: string; optionLabel: string; valueId: string; valueLabel: string }[];
    fulfillment: CatalogFulfillment;
  };
  /** Present when Inventory tracks the item. */
  stock?: { skuId: string; allowBackorders: boolean };
}

export type CatalogQuote =
  | { ok: true; lines: CatalogQuoteLine[]; inventory?: InventoryProviderBinding }
  /** The first line that cannot be sold decides the reason. */
  | { ok: false; reason: "unavailable" | "unpriced" | "inventory-setup" | "inventory-unavailable" };
