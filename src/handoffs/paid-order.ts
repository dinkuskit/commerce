import type { Money } from "../features/catalog/kernel/index.js";
import type {
  AddonUse,
  CheckoutContactSnapshot,
  CheckoutPricingSnapshot,
  CheckoutVariantSelectionSnapshot,
} from "../features/checkout/kernel/index.js";

/**
 * Checkout to Orders. Checkout sends one of these when it records an order as
 * paid; Orders keeps it as its own copy. Inside one plugin this is a function
 * call; across plugins the same record is what gets posted. See
 * docs/contracts/commerce-handoffs.md.
 */
export const PAID_ORDER_SCHEMA = "dinkuskit.commerce.paid-order/v1" as const;

export interface PaidOrderLine {
  catalogItemId: string;
  quantity: number;
  name: string;
  unitPrice: Money;
}

export interface PaidOrder {
  schema: typeof PAID_ORDER_SCHEMA;
  orderId: string;
  receiptId: string;
  /** Checkout's attempt id: the link back to Checkout. */
  attemptId: string;
  /** Present only when a payment provider took the payment. */
  paymentId?: string;
  /** When Checkout recorded the payment; absent on orders paid before v1 recorded it. */
  paidAt?: string;
  lines: readonly PaidOrderLine[];
  total: Money;
  pricing?: CheckoutPricingSnapshot;
  variantSelections?: readonly CheckoutVariantSelectionSnapshot[];
  /** Inventory ticket ids from reserve, when the provider returned them. */
  ticketIds?: readonly string[];
  contactSnapshot?: CheckoutContactSnapshot;
  /**
   * "live" only when the store and Payments were both set to live payments.
   * "test" or absent is a test order: no money moved and no postage is bought.
   */
  mode?: "test" | "live";
  /** The payment was confirmed after Checkout had let the checkout go as ended and unpaid. */
  paidAfterEnd?: true;
  /** The add-ons whose answers priced the order, with their references and the codes the shopper typed. */
  addons?: readonly AddonUse[];
  /** The store's own facts from the cart, frozen at checkout start (commerce-cart-attributes-order-paid-20261123). */
  attributes?: Readonly<Record<string, string>>;
}

/**
 * stored: first copy kept. duplicate: identical copy already kept.
 * conflict: a different copy is already kept; it is never replaced.
 */
export type PaidOrderReceipt = "stored" | "duplicate" | "conflict";

/** Where Orders has the order now: Completed (shipped, never "delivered") with what the owner recorded, or Processing, plus its assigned short number and test mark. */
export interface PaidOrderStatus {
  status: "processing" | "completed";
  completed: { at: string; carrier?: string; tracking?: string } | null;
  number: number | null;
  test: boolean;
}

export interface PaidOrderReceiver {
  receive(order: PaidOrder): Promise<PaidOrderReceipt>;
  /** The kept order's current status, or null when Orders holds none. */
  status?(orderId: string): Promise<PaidOrderStatus | null>;
}
