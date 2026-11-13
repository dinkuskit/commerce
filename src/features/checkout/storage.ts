import type { StorageCollection } from "emdash";
import type {
  CheckoutPaymentAssociation,
  CheckoutPaymentAssociationPort,
  CheckoutRecord,
  CheckoutStore,
} from "./types.js";

export const CHECKOUT_COLLECTION = "checkoutCarts";
export const CHECKOUT_PAYMENT_ASSOCIATIONS_COLLECTION = "checkoutPaymentAssociations";
export const CHECKOUT_PAYMENT_ASSOCIATIONS_SANDBOX_COLLECTION = "checkout_payment_associations";
export {
  CHECKOUT_GUEST_CAPABILITY_COLLECTION,
  CHECKOUT_GUEST_CAPABILITY_SANDBOX_COLLECTION,
  CHECKOUT_SANDBOX_COLLECTION,
} from "./types.js";

/** Mount this collection through the native/registry owner before exposing checkout. */
export function createCheckoutStore(collection: Pick<StorageCollection<CheckoutRecord>, "getVersioned" | "compareAndSet">): CheckoutStore {
  return {
    async read(cartId) {
      const stored = await collection.getVersioned(cartId);
      if (!stored) return null;
      if (!stored.value || !Array.isArray(stored.value.attempts) || !(stored.value.attempts.length || stored.value.cart)) {
        throw new Error("Invalid stored checkout aggregate");
      }
      return { version: stored.revision, record: stored.value };
    },
    async compareAndSet(cartId, version, record) {
      return (await collection.compareAndSet(cartId, version, record)).applied;
    },
  };
}

/**
 * The background check's cleanup, WooCommerce-style (commerce-cart-expiry-20261113): up to 100 carts past
 * their 30 days per run. A cart with no checkout, or only released ones, is deleted. A paid cart keeps its
 * order record and loses only the cart. A cart mid-checkout loses its lines and is looked at again a day on.
 */
export async function clearExpiredCarts(
  carts: Pick<StorageCollection<CheckoutRecord>, "query" | "getVersioned" | "compareAndSet" | "compareAndDelete">,
  now: number,
): Promise<void> {
  for (const { id } of (await carts.query({ where: { cartExpires: { lt: String(now) } }, limit: 100 })).items) {
    const found = await carts.getVersioned(id);
    const record = found?.value;
    if (!found || !record || !(+record.cartExpires! <= now)) continue;
    const phases = record.attempts.map(attempt => attempt.phase);
    if (phases.every(phase => phase === "released")) await carts.compareAndDelete(id, found.revision);
    // Past its 30 days the cart's lines are gone either way. A cart mid-checkout keeps its attempts and is
    // looked at again a day on, so it never holds the page and starves carts behind it.
    else await carts.compareAndSet(id, found.revision, { attempts: record.attempts, ...phases.includes("paid") ? {} : { cartExpires: String(now + 86400) } });
  }
}

export function createCheckoutPaymentAssociationPort(
  collection: Pick<
    StorageCollection<CheckoutPaymentAssociation>,
    "get" | "compareAndSet"
  >,
): CheckoutPaymentAssociationPort {
  const valid = (record: CheckoutPaymentAssociation, attemptId = record.attemptId) =>
    record.recordKind === "checkout-payment-association" &&
    typeof record.attemptId === "string" && record.attemptId.trim() !== "" &&
    record.attemptId === attemptId &&
    typeof record.cartId === "string" && record.cartId.trim() !== "" &&
    typeof record.bindingRef === "string" && record.bindingRef.trim() !== "";
  return {
    async claim(record) {
      if (!valid(record)) return false;
      const existing = await collection.get(record.attemptId);
      if (existing) {
        return valid(existing, record.attemptId) &&
          existing.cartId === record.cartId &&
          existing.bindingRef === record.bindingRef;
      }
      return (await collection.compareAndSet(record.attemptId, null, record)).applied;
    },
    async get(attemptId) {
      if (typeof attemptId !== "string" || attemptId.trim() === "") return null;
      const record = await collection.get(attemptId);
      return record && valid(record, attemptId) ? record : null;
    },
  };
}
