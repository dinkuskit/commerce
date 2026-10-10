import type { StorageCollection } from "emdash";
import { scanAll } from "../../shared/scan.js";
import { PAID_ORDER_SCHEMA, type PaidOrder, type PaidOrderReceiver } from "../../handoffs/paid-order.js";

export const ORDERS_COLLECTION = "orders";

/** Orders' own record. Later order facts sit beside the copy, never inside it. */
export interface OrderRecord { paidOrder: PaidOrder }

export type OrdersCollection = Pick<StorageCollection<OrderRecord>, "get" | "compareAndSet" | "query">;

function text(value: unknown): value is string {
  return typeof value === "string" && value !== "" && value.length <= 1024;
}
function admit(order: PaidOrder): PaidOrder {
  if (!order || order.schema !== PAID_ORDER_SCHEMA || !text(order.orderId) || !text(order.receiptId) || !text(order.attemptId) ||
      !Array.isArray(order.lines) || !order.total || typeof order.total.minor !== "string") throw new Error("Invalid paid order");
  return order;
}
// Key order can differ between a live hand-off and a stored copy read back.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) => v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1)) : v);
}
function same(kept: OrderRecord | null, order: PaidOrder) {
  return kept && canonical(kept.paidOrder) === canonical(order) ? "duplicate" : "conflict";
}

/** Orders' receiving side of the Checkout to Orders handoff. The first copy is kept for good. */
export function createPaidOrderReceiver(collection: Pick<OrdersCollection, "get" | "compareAndSet">): PaidOrderReceiver {
  return {
    async receive(order) {
      admit(order);
      const kept = await collection.get(order.orderId);
      if (kept) return same(kept, order);
      if ((await collection.compareAndSet(order.orderId, null, { paidOrder: structuredClone(order) })).applied) return "stored";
      return same(await collection.get(order.orderId), order);
    },
  };
}

/** Every kept order in order-id order. Scans at most 100 pages of 100 and fails closed on a malformed copy. */
export async function listOrders(collection: Pick<OrdersCollection, "query">): Promise<PaidOrder[]> {
  const orders: PaidOrder[] = [];
  await scanAll(collection, item => {
    const order = admit(item.data?.paidOrder);
    if (order.orderId !== item.id) throw new Error("Invalid order");
    orders.push(order);
  });
  return orders.sort((a, b) => a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0);
}
