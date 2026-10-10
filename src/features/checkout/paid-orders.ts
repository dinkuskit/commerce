import type { StorageCollection } from "emdash";
import { PAID_ORDER_SCHEMA, type PaidOrder } from "../../handoffs/paid-order.js";
import type { CheckoutAttempt, CheckoutExecution, CheckoutRecord, CommerceOrder } from "./types.js";

/** The Checkout to Orders message for one paid order, built from Checkout's own record. */
export function paidOrderOf(order: CommerceOrder): PaidOrder {
  return { schema: PAID_ORDER_SCHEMA, ...structuredClone(order) };
}

/** Hands a paid attempt's order to Orders. Never changes the shopper's outcome. */
export async function handOffPaidOrder(e: CheckoutExecution, attempt: CheckoutAttempt): Promise<void> {
  if (!e.paidOrders || attempt.phase !== "paid" || !attempt.order) return;
  try { await e.paidOrders.receive(paidOrderOf(attempt.order)); } catch { /* the next status check retries */ }
}

/**
 * Every paid order Checkout holds, for Orders to bring in what it is missing.
 * Scans at most 100 pages of 100 checkouts and fails closed on a malformed
 * record, a repeated order id or a repeated cursor.
 */
export async function listPaidOrders(carts: Pick<StorageCollection<CheckoutRecord>, "query">): Promise<PaidOrder[]> {
  const orders: PaidOrder[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; ; page++) {
    if (page >= 100) throw new Error("Order scan limit");
    const result = await carts.query({ limit: 100, cursor });
    for (const item of result.items) {
      if (!Array.isArray(item.data.attempts)) throw new Error("Invalid aggregate");
      for (const attempt of item.data.attempts) {
        const order = attempt.order;
        if (!order) continue;
        if (attempt.phase !== "paid" || order.attemptId !== attempt.attemptId || !order.orderId || !order.receiptId || ids.has(order.orderId)) throw new Error("Invalid order");
        ids.add(order.orderId);
        orders.push(paidOrderOf(order));
      }
    }
    if (!result.hasMore) return orders;
    if (!result.cursor || cursors.has(result.cursor)) throw new Error("Invalid cursor");
    cursor = result.cursor; cursors.add(cursor);
  }
}
