import type { Money } from "../catalog/index.js";
import type { InventoryProviderBinding } from "../inventory-provider/index.js";
import type { StorefrontAvailabilityResolverStorage, ResolveStorefrontAvailabilityExecution } from "../storefront-availability/index.js";

export const CHECKOUT_FEATURE_ID = "dinkus.checkout";
export interface CartLine { catalogItemId: string; quantity: number }
export interface CheckoutLine extends CartLine { name: string; unitPrice: Money }
export interface StockRequirement { skuId: string; quantity: number; allowBackorders: boolean }
export interface StockRequest {
  operationId: string;
  binding: InventoryProviderBinding;
  requirements: StockRequirement[];
}
/** Durable whole-basket operation. Never substitute a local stock ledger. */
export interface CheckoutInventoryPort {
  /** Same operation/request forever; terminal rejection has no holds and cannot later succeed. */
  reserve(request: StockRequest): Promise<"reserved" | "rejected" | "unknown">;
  /** Idempotent terminal fence, including an in-flight reserve. No subsequent reacquisition. */
  release(request: StockRequest): Promise<"released" | "unknown">;
}
export interface PaymentRequest {
  attemptId: string;
  /** Immutable server-side merchant/provider binding; never resolve to a replacement account. */
  bindingRef: string;
  lines: CheckoutLine[];
  total: Money;
  paymentWindowSeconds: 1800;
  paymentMethods: readonly ["card"];
}
export interface PaymentSession {
  sessionId: string;
  redirectUrl: string;
  createdAt: number;
  expiresAt: number;
}
export type PaymentOutcome =
  | { outcome: "unknown" }
  | { outcome: "open"; attemptId: string; total: Money; session: PaymentSession }
  | { outcome: "paid"; attemptId: string; total: Money; session: PaymentSession; paymentId: string }
  | { outcome: "expired-unpaid"; attemptId: string; total: Money; session: PaymentSession }
  | { outcome: "not-created"; attemptId: string };
/** Payments owns transport/authenticity and durable processor idempotency, not orders. */
export interface CheckoutPaymentPort {
  /** Ensure one session, with deadline fixed at first creation; never reset on retry. */
  ensureSession(request: PaymentRequest): Promise<PaymentOutcome>;
  /** Authoritative lookup. Events are hints only. not-created is a terminal creation fence. */
  lookup(request: PaymentRequest): Promise<PaymentOutcome>;
}
export interface CommerceOrder {
  orderId: string;
  receiptId: string;
  attemptId: string;
  paymentId: string;
  lines: CheckoutLine[];
  total: Money;
}
export interface CheckoutAttempt {
  attemptId: string;
  cart: CartLine[];
  payment: PaymentRequest;
  stock?: StockRequest;
  phase: "reserving" | "paying" | "releasing" | "released" | "paid";
  session?: PaymentSession;
  order?: CommerceOrder;
}
/** One durable aggregate per trusted cart. Preserve past attempts and paid receipts. */
export interface CheckoutRecord { attempts: CheckoutAttempt[] }
export interface CheckoutStore {
  read(cartId: string): Promise<{ version: string; record: CheckoutRecord } | null>;
  /** Atomic insert (null version) or compare-and-set across processes. */
  compareAndSet(cartId: string, version: string | null, record: CheckoutRecord): Promise<boolean>;
}
export interface CheckoutExecution {
  store: CheckoutStore;
  catalog: StorefrontAvailabilityResolverStorage;
  availability: ResolveStorefrontAvailabilityExecution;
  resolveInventory(binding: InventoryProviderBinding): Promise<CheckoutInventoryPort | null>;
  paymentBindingRef: string;
  resolvePayments(bindingRef: string): Promise<CheckoutPaymentPort | null>;
  createAttemptId?: () => string;
  now?: () => number;
}
