import type { StorageCollection } from "emdash";
import type { CheckoutRecord, CheckoutStore } from "./types.js";

export const CHECKOUT_COLLECTION = "checkoutCarts";

/** Mount this collection through the native/registry owner before exposing checkout. */
export function createCheckoutStore(collection: Pick<StorageCollection<CheckoutRecord>, "getVersioned" | "compareAndSet">): CheckoutStore {
  return {
    async read(cartId) {
      const stored = await collection.getVersioned(cartId);
      if (!stored) return null;
      if (!stored.value || !Array.isArray(stored.value.attempts) || !stored.value.attempts.length) {
        throw new Error("Invalid stored checkout aggregate");
      }
      return { version: stored.revision, record: stored.value };
    },
    async compareAndSet(cartId, version, record) {
      return (await collection.compareAndSet(cartId, version, record)).applied;
    },
  };
}
