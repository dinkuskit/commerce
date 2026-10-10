import type { StorageCollection } from "emdash";
import { scanAll } from "../../shared/scan.js";
import { canonical, isRecord } from "../../shared/record.js";
import { isCheckoutContactSnapshot, normalizeCheckoutDelivery, type CheckoutDeliveryAddress } from "../checkout-contact/index.js";
import { normalizeMoney } from "../catalog/kernel/index.js";
import { PAID_ORDER_SCHEMA, type PaidOrder, type PaidOrderReceiver } from "../../handoffs/paid-order.js";

export const ORDERS_COLLECTION = "orders";
export const ORDER_NUMBERS_COLLECTION = "order_numbers";
export const FIRST_ORDER_NUMBER = 1001;

/** Orders' own record. Later order facts sit beside the copy, never inside it. */
export interface OrderRecord {
  paidOrder: PaidOrder;
  /** Short number for people; absent until numbered. */
  number?: number;
  /** Starts at 1 (absent means 1) and goes up by one on every owner change. */
  revision?: number;
  /** The owner's corrected delivery address. Checkout's frozen copy never changes. */
  delivery?: CheckoutDeliveryAddress;
}

export type OrdersCollection = Pick<StorageCollection<OrderRecord>, "get" | "getVersioned" | "compareAndSet" | "query">;
export type OrderNumbers = Pick<StorageCollection<{ next: number }>, "getVersioned" | "compareAndSet">;

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
export function createPaidOrderReceiver(collection: Pick<OrdersCollection, "get" | "compareAndSet">, numbers?: OrderNumbers): PaidOrderReceiver {
  return {
    async receive(order) {
      admit(order);
      const kept = await collection.get(order.orderId);
      if (kept) return same(kept, order);
      // A number taken for an order that lost the race is skipped, never reused.
      const number = numbers ? { number: await takeOrderNumber(numbers) } : {};
      if ((await collection.compareAndSet(order.orderId, null, { paidOrder: structuredClone(order), ...number, revision: 1 })).applied) return "stored";
      return same(await collection.get(order.orderId), order);
    },
  };
}

/** The next short order number; a failed take throws and the caller retries later. */
export async function takeOrderNumber(numbers: OrderNumbers): Promise<number> {
  for (let tries = 0; tries < 8; tries++) {
    const kept = await numbers.getVersioned("next");
    const next = kept ? kept.value.next : FIRST_ORDER_NUMBER;
    if (!Number.isSafeInteger(next) || next < FIRST_ORDER_NUMBER) throw new Error("Invalid order number");
    if ((await numbers.compareAndSet("next", kept?.revision ?? null, { next: next + 1 })).applied) return next;
  }
  throw new Error("Order numbers busy");
}

/** Numbers kept orders that have none, oldest paid first. Returns how many were numbered. */
export async function numberOrders(collection: Pick<OrdersCollection, "getVersioned" | "compareAndSet">, numbers: OrderNumbers, kept: readonly OrderRecord[]): Promise<number> {
  let numbered = 0;
  const key = (r: OrderRecord) => (r.paidOrder.paidAt ?? "") + "\n" + r.paidOrder.orderId;
  for (const record of kept.filter(r => r.number === undefined).sort((a, b) => key(a) < key(b) ? -1 : 1)) {
    const current = await collection.getVersioned(record.paidOrder.orderId);
    if (!current || current.value.number !== undefined) continue;
    const update = { ...current.value, number: await takeOrderNumber(numbers) };
    if ((await collection.compareAndSet(record.paidOrder.orderId, current.revision, update)).applied) numbered++;
  }
  return numbered;
}

/**
 * Records the owner's corrected delivery address and raises the order's version.
 * Refuses an order with no address, an outdated version, and a country the store does not ship to.
 */
export async function correctDelivery(
  collection: Pick<OrdersCollection, "getVersioned" | "compareAndSet">,
  orderId: string, revision: number, raw: unknown, shippingCountries: readonly string[],
): Promise<"saved" | "outdated" | "invalid"> {
  const current = await collection.getVersioned(orderId);
  if (!current) throw new Error("Invalid order");
  const record = current.value;
  if (!deliveryOf(record)) return "invalid";
  if ((record.revision ?? 1) !== revision) return "outdated";
  let delivery: CheckoutDeliveryAddress;
  try { delivery = normalizeCheckoutDelivery(raw); } catch { return "invalid"; }
  if (!shippingCountries.includes(delivery.country)) return "invalid";
  const write = await collection.compareAndSet(orderId, current.revision, { ...record, delivery, revision: revision + 1 });
  return write.applied ? "saved" : "outdated";
}

/** Where the order goes now: the owner's correction, else the address typed at checkout. */
export function deliveryOf(record: OrderRecord): CheckoutDeliveryAddress | undefined {
  return record.delivery ?? record.paidOrder.contactSnapshot?.contact?.delivery;
}

const count = (v: unknown, min: number) => v === undefined || (Number.isSafeInteger(v) && (v as number) >= min);

/** Every kept order in order-id order. Scans at most 100 pages of 100 and fails closed on a malformed record. */
export async function listOrders(collection: Pick<OrdersCollection, "query">): Promise<OrderRecord[]> {
  const orders: OrderRecord[] = [];
  await scanAll(collection, item => {
    const record = item.data;
    const order = admit(record?.paidOrder, true);
    if (order.orderId !== item.id || !count(record.number, FIRST_ORDER_NUMBER) || !count(record.revision, 1)) throw new Error("Invalid order");
    if (record.delivery !== undefined) normalizeCheckoutDelivery(record.delivery);
    orders.push(record);
  });
  return orders.sort((a, b) => a.paidOrder.orderId < b.paidOrder.orderId ? -1 : a.paidOrder.orderId > b.paidOrder.orderId ? 1 : 0);
}
