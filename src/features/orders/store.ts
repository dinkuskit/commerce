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
  /** Present once the order is Completed (shipped, never "delivered"); absent means Processing. */
  completed?: OrderCompletion;
  /** The version Ship last took, or refused for good. Recording it never raises the version. */
  shipVersion?: number;
  /** Left by the retired isolated Ship TEST profile (0.3.0-beta.0 to beta.2): such an order never goes to Ship. */
  shipPin?: unknown;
}

export interface OrderCompletion {
  at: string;
  carrier?: string;
  tracking?: string;
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
      !optional(o.paymentId, text) || !optional(o.paidAt, text) || !optional(o.mode, m => m === "test" || m === "live") || !optional(o.ticketIds, textList) ||
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

type OwnerChange = "saved" | "outdated" | "invalid";

/** Applies one owner change to the order's current version and raises it; a stale version changes nothing. */
async function change(
  collection: Pick<OrdersCollection, "getVersioned" | "compareAndSet">, orderId: string, revision: number,
  edit: (record: OrderRecord) => OrderRecord | OwnerChange,
): Promise<OwnerChange> {
  const current = await collection.getVersioned(orderId);
  if (!current) throw new Error("Invalid order");
  if ((current.value.revision ?? 1) !== revision) return "outdated";
  const next = edit(current.value);
  if (typeof next === "string") return next;
  return (await collection.compareAndSet(orderId, current.revision, { ...next, revision: revision + 1 })).applied ? "saved" : "outdated";
}

/**
 * Records the owner's corrected delivery address and raises the order's version.
 * Refuses an order with no address, an outdated version, and a country the store does not ship to.
 */
export function correctDelivery(
  collection: Pick<OrdersCollection, "getVersioned" | "compareAndSet">,
  orderId: string, revision: number, raw: unknown, shippingCountries: readonly string[],
): Promise<OwnerChange> {
  return change(collection, orderId, revision, record => {
    if (!deliveryOf(record)) return "invalid";
    // A Completed order's address is locked; completing raised the version, so an open form is out of date.
    if (record.completed) return "outdated";
    let delivery: CheckoutDeliveryAddress;
    try { delivery = normalizeCheckoutDelivery(raw); } catch { return "invalid"; }
    return shippingCountries.includes(delivery.country) ? { ...record, delivery } : "invalid";
  });
}

/** Optional short text such as a carrier: blank is none, null is unusable. */
function note(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return !trimmed ? undefined : trimmed.length <= 64 && !/[\u0000-\u001f\u007f]/.test(trimmed) ? trimmed : null;
}

/** The owner marks a Processing order Completed by hand; carrier and tracking number are optional. */
export function completeOrder(
  collection: Pick<OrdersCollection, "getVersioned" | "compareAndSet">,
  orderId: string, revision: number, raw: unknown, at: string,
): Promise<OwnerChange> {
  return change(collection, orderId, revision, record => {
    if (record.completed) return "outdated";
    const values = isRecord(raw) ? raw : {};
    const carrier = note(values.carrier), tracking = note(values.tracking);
    if (carrier === null || tracking === null) return "invalid";
    return { ...record, completed: { at, ...(carrier && { carrier }), ...(tracking && { tracking }) } };
  });
}

/** The owner moves a Completed order back to Processing; its carrier, tracking and completion time are cleared. */
export function reopenOrder(
  collection: Pick<OrdersCollection, "getVersioned" | "compareAndSet">, orderId: string, revision: number,
): Promise<OwnerChange> {
  return change(collection, orderId, revision, ({ completed, ...record }) => completed ? record : "outdated");
}

/** Where the order goes now: the owner's correction, else the address typed at checkout. */
export function deliveryOf(record: OrderRecord): CheckoutDeliveryAddress | undefined {
  return record.delivery ?? record.paidOrder.contactSnapshot?.contact?.delivery;
}

/** What agents and Ship both see of an order: who it is, its version and status, the test mark, where it goes and who to tell. */
export function orderFacts(record: OrderRecord) {
  const order = record.paidOrder;
  return {
    orderId: order.orderId, number: record.number ?? null, version: record.revision ?? 1,
    status: record.completed ? "completed" : "processing", test: order.mode !== "live",
    shipTo: deliveryOf(record) ?? null, email: order.contactSnapshot?.contact?.email ?? null,
    completed: record.completed ?? null,
  };
}

const count = (v: unknown, min: number) => v === undefined || (Number.isSafeInteger(v) && (v as number) >= min);
const completion = (v: unknown) => isRecord(v) && text(v.at) && optional(v.carrier, c => note(c) === c) && optional(v.tracking, t => note(t) === t);

/** Every kept order in order-id order. Scans at most 100 pages of 100 and fails closed on a malformed record. */
export async function listOrders(collection: Pick<OrdersCollection, "query">): Promise<OrderRecord[]> {
  const orders: OrderRecord[] = [];
  await scanAll(collection, item => {
    const record = item.data;
    const order = admit(record?.paidOrder, true);
    if (order.orderId !== item.id || !count(record.number, FIRST_ORDER_NUMBER) || !count(record.revision, 1) ||
        !optional(record.completed, completion)) throw new Error("Invalid order");
    if (record.delivery !== undefined) normalizeCheckoutDelivery(record.delivery);
    orders.push(record);
  });
  return orders.sort((a, b) => a.paidOrder.orderId < b.paidOrder.orderId ? -1 : a.paidOrder.orderId > b.paidOrder.orderId ? 1 : 0);
}

/** Shopper-safe order summary for a verified customer email. */
export interface ShopperOrderSummary {
  orderId: string;
  receiptId: string;
  number: number | null;
  status: "processing" | "completed";
  paidAt: string | null;
  total: PaidOrder["total"];
  lines: PaidOrder["lines"];
  choices: NonNullable<PaidOrder["variantSelections"]>;
  pricing: {
    merchandiseSubtotal: PaidOrder["total"];
    couponDiscount: PaidOrder["total"];
    netMerchandise: PaidOrder["total"];
    shipping: { mode: "free" | "flat"; charge: PaidOrder["total"] };
    finalTotal: PaidOrder["total"];
  } | null;
  delivery: CheckoutDeliveryAddress | null;
  phone: string | null;
  completed: OrderCompletion | null;
}

/** Projects one order record for its verified shopper; omits internal IDs, test flags and provider bindings. */
export function projectShopperOrder(record: OrderRecord): ShopperOrderSummary {
  const order = record.paidOrder;
  const p = order.pricing;
  return {
    orderId: order.orderId,
    receiptId: order.receiptId,
    number: record.number ?? null,
    status: record.completed ? "completed" : "processing",
    paidAt: order.paidAt ?? null,
    total: structuredClone(order.total),
    lines: structuredClone(order.lines),
    choices: structuredClone(order.variantSelections ?? []),
    pricing: p
      ? structuredClone({
          merchandiseSubtotal: p.merchandiseSubtotal,
          couponDiscount: p.couponDiscount,
          netMerchandise: p.netMerchandise,
          shipping: { mode: p.shipping.mode, charge: p.shipping.charge },
          finalTotal: p.finalTotal,
        })
      : null,
    delivery: structuredClone(deliveryOf(record) ?? null),
    phone: order.contactSnapshot?.contact?.phone ?? null,
    completed: structuredClone(record.completed ?? null),
  };
}

/** Every kept order whose frozen checkout email matches the verified email (case-folded), newest first. */
export async function listOrdersForEmail(
  collection: Pick<OrdersCollection, "query">,
  email: string,
): Promise<ShopperOrderSummary[]> {
  const target = email.trim().toLowerCase();
  if (!target) return [];
  const all = await listOrders(collection);
  return all
    .filter(record => record.paidOrder.contactSnapshot?.contact?.email?.trim().toLowerCase() === target)
    .sort((a, b) => {
      const aNum = a.number ?? -1;
      const bNum = b.number ?? -1;
      if (aNum !== bNum) return bNum - aNum;
      const aPaid = a.paidOrder.paidAt ?? "";
      const bPaid = b.paidOrder.paidAt ?? "";
      if (aPaid !== bPaid) return aPaid > bPaid ? -1 : 1;
      return a.paidOrder.orderId > b.paidOrder.orderId ? -1 : a.paidOrder.orderId < b.paidOrder.orderId ? 1 : 0;
    })
    .map(projectShopperOrder);
}

