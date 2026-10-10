import type { Money } from "../features/catalog/kernel/index.js";
import type {
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
}

/**
 * stored: first copy kept. duplicate: identical copy already kept.
 * conflict: a different copy is already kept; it is never replaced.
 */
export type PaidOrderReceipt = "stored" | "duplicate" | "conflict";

export interface PaidOrderReceiver {
  receive(order: PaidOrder): Promise<PaidOrderReceipt>;
}
