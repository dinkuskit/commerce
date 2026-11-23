import type { StorageCollection } from "emdash";
import { scanAll } from "../../shared/scan.js";
import { PAID_ORDER_SCHEMA, type PaidOrder, type PaidOrderReceipt } from "../../handoffs/paid-order.js";
import type { CheckoutAttempt, CheckoutExecution, CheckoutRecord, CommerceOrder } from "./types.js";

/** The Checkout to Orders message for one paid order, built from Checkout's own record. */
export function paidOrderOf(order: CommerceOrder): PaidOrder {
  return { schema: PAID_ORDER_SCHEMA, ...structuredClone(order) };
}

/** What Orders answered, or "unavailable" when it could not be reached. Without an Orders receiver there is nothing to hand to. */
export type PaidOrderHandoffResult = PaidOrderReceipt | "unavailable";

/** Hands a paid attempt's order to Orders. Never changes the shopper's outcome; reports whether Orders durably accepted it. */
export async function handOffPaidOrder(e: CheckoutExecution, attempt: CheckoutAttempt): Promise<PaidOrderHandoffResult> {
  if (!e.paidOrders || !attempt.order) return "stored";
  try { return await e.paidOrders.receive(paidOrderOf(attempt.order)); } catch { return "unavailable"; }
}

/**
 * Every paid order Checkout holds, for Orders to bring in what it is missing.
 * Scans at most 100 pages of 100 checkouts and fails closed on a malformed
 * record, a repeated order id or a repeated cursor.
 */
export async function listPaidOrders(carts: Pick<StorageCollection<CheckoutRecord>, "query">): Promise<PaidOrder[]> {
  const orders: PaidOrder[] = [];
  const ids = new Set<string>();
  await scanAll(carts, item => {
    if (!Array.isArray(item.data.attempts)) throw new Error("Invalid aggregate");
    for (const attempt of item.data.attempts) {
      const order = attempt.order;
      if (!order) continue;
      if (attempt.phase !== "paid" || order.attemptId !== attempt.attemptId || !order.orderId || !order.receiptId || ids.has(order.orderId)) throw new Error("Invalid order");
      ids.add(order.orderId);
      orders.push(paidOrderOf(order));
    }
  });
  return orders;
}
