import type { StorageCollection } from "emdash";
import { scanAll } from "../../shared/scan.js";
import { canonical, isRecord } from "../../shared/record.js";
import { isCheckoutContactSnapshot } from "../checkout-contact/index.js";
import { normalizeMoney } from "../catalog/kernel/index.js";
import { PAID_ORDER_SCHEMA, type PaidOrder, type PaidOrderReceiver } from "../../handoffs/paid-order.js";

export const ORDERS_COLLECTION = "orders";

/** Orders' own record. Later order facts sit beside the copy, never inside it. */
export interface OrderRecord { paidOrder: PaidOrder }

export type OrdersCollection = Pick<StorageCollection<OrderRecord>, "get" | "compareAndSet" | "query">;

function text(value: unknown): value is string {
  return typeof value === "string" && value !== "" && value.length <= 1024;
}
function money(value: unknown): boolean {
  try { normalizeMoney(value); return true; } catch { return false; }
}
function optional(value: unknown, check: (v: unknown) => boolean): boolean {
  return value === undefined || check(value);
}
const textList = (v: unknown) => Array.isArray(v) && v.every(text);
function line(v: unknown): boolean {
  return isRecord(v) && text(v.catalogItemId) && text(v.name) && Number.isSafeInteger(v.quantity) &&
    (v.quantity as number) > 0 && money(v.unitPrice);
}
function pricing(v: unknown): boolean {
  return isRecord(v) && money(v.merchandiseSubtotal) && money(v.couponDiscount) && money(v.netMerchandise) &&
    money(v.finalTotal) && isRecord(v.shipping) && money(v.shipping.charge) &&
    optional(v.coupon, c => isRecord(c) && text(c.code));
}
/**
 * Everything Orders shows or packs from must be well formed before a copy is kept for good.
 * A copy already kept before the contact check keeps any object there; the detail shows "No address".
 */
function admit(order: PaidOrder, kept = false): PaidOrder {
  const o = order as unknown;
  if (!isRecord(o) || o.schema !== PAID_ORDER_SCHEMA || !text(o.orderId) || !text(o.receiptId) || !text(o.attemptId) ||
      !Array.isArray(o.lines) || !o.lines.length || !o.lines.every(line) || !money(o.total) ||
      !optional(o.paymentId, text) || !optional(o.paidAt, text) || !optional(o.ticketIds, textList) ||
      !optional(o.pricing, pricing) || !optional(o.variantSelections, v => Array.isArray(v) && v.every(isRecord)) ||
      !optional(o.contactSnapshot, kept ? isRecord : isCheckoutContactSnapshot)) throw new Error("Invalid paid order");
  return order;
}
// Key order can differ between a live hand-off and a stored copy read back.
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
    const order = admit(item.data?.paidOrder, true);
    if (order.orderId !== item.id) throw new Error("Invalid order");
    orders.push(order);
  });
  return orders.sort((a, b) => a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0);
}
