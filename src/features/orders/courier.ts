import type { PluginContext, StorageCollection } from "emdash";
import { ORDERS_COLLECTION, billingOf, orderFacts, type OrderRecord, type OrdersCollection } from "./store.js";
import { cut, lineOptions } from "../../shared/line-text.js";
import type { CheckoutRecord } from "../checkout/kernel/index.js";

/**
 * Commerce's courier outbox (dinkuskit/courier docs/doors.md; order-shipped-outbox-20261122, store-emails-plugin-20261122):
 * news for the store's other plugins. `order.shipped` is an order marked Completed (Reviews, Store emails), `order.paid`
 * a paid order Commerce stored, and `cart.left` a checkout left unpaid with something in the cart (Store emails).
 * Only the store's courier calls it, from the store's own code with nobody signed in, so the buyer's email never
 * leaves the store.
 */
export const COURIER_OUTBOX_ROUTE = "courier/outbox";
/** News is given once it is a minute old, so one saved a moment later under an earlier time is never passed by. */
const SETTLED_MS = 60_000;
/** Each topic's indexed key, `<time> <id>`: the bookmark is the last key given. */
const KEYS: Record<string, "shippedKey" | "paidKey" | "leftKey"> = { "order.shipped": "shippedKey", "order.paid": "paidKey", "cart.left": "leftKey" };

/** A refusal in the shape of EmDash's route error, its code leading the words, which are all a sandbox passes on. */
const refuse = (code: string, words: string, status: number) =>
  Object.assign(new Error(`${code}: ${words}`), { name: "PluginRouteError", code, status });

/**
 * The courier refuses a whole batch when one item is over 8 KB of JSON, and the receiver's bookmark then never moves, so
 * that topic would stop for good. An item keeps at most 50 lines, and drops lines from the end while the whole item is
 * over 7,500 bytes; `moreLines` counts the lines left out.
 */
function fit<T extends { data: { lines: unknown[] | null; moreLines?: number } }>(item: T): T {
  const lines = item.data.lines, all = lines?.length ?? 0;
  lines?.splice(50);
  while (lines?.length && new TextEncoder().encode(JSON.stringify(item)).length > 7500) lines.pop();
  if (lines && lines.length < all) item.data.moreLines = all - lines.length;
  return item;
}

function shipped(record: OrderRecord) {
  const order = record.paidOrder, at = record.completed!.at, { email, shipTo, number, test } = orderFacts(record);
  return fit({ id: `${order.orderId}:shipped`, at, data: {
    orderId: order.orderId, number, test, shippedAt: at, email, name: (shipTo ?? billingOf(record))?.name ?? null,
    carrier: record.completed!.carrier ?? null, tracking: record.completed!.tracking ?? null,
    // A size or colour is reviewed as its product, under the id the product page shows.
    lines: order.lines.map(line => ({ productId: order.variantSelections?.find(v => v.catalogItemId === line.catalogItemId)?.productId ?? line.catalogItemId, productName: cut(line.name), quantity: line.quantity })),
  } as { lines: unknown[]; moreLines?: number } });
}

function paid(record: OrderRecord) {
  const order = record.paidOrder, pricing = order.pricing, { email, shipTo, number, test } = orderFacts(record);
  return fit({ id: `${order.orderId}:paid`, at: record.paidKey!.split(" ")[0]!, data: {
    orderId: order.orderId, number, test, email, name: (shipTo ?? billingOf(record))?.name ?? null, shipTo,
    lines: order.lines.map(line => ({ name: cut(line.name), options: cut(lineOptions(order, line.catalogItemId)), quantity: line.quantity, unitPrice: line.unitPrice })),
    subtotal: pricing?.merchandiseSubtotal ?? null, discount: pricing?.coupon ? pricing.couponDiscount : null,
    shipping: pricing?.shipping.charge ?? null, total: order.total,
  } as { lines: unknown[]; moreLines?: number } });
}

function left(id: string, record: CheckoutRecord) {
  const attempt = record.attempts.at(-1)!, link = record.leftLink!;
  // The items are listed when the cart still holds what the shopper took to checkout.
  const same = JSON.stringify(record.cart?.lines) === JSON.stringify(attempt.cart);
  return fit({ id: `${id}:left`, at: record.leftKey!.split(" ")[0]!, data: {
    email: attempt.contactSnapshot!.contact.email, ticked: !!record.news, link, stopLink: `${link}&stop=1`,
    lines: same ? attempt.payment.lines.map(line => ({ name: cut(line.name), quantity: line.quantity, options: cut(line.options ?? "") })) : null,
  } as { lines: unknown[] | null; moreLines?: number } });
}

/** `POST courier/outbox`: a topic's news after the courier's bookmark, oldest first. */
export async function courierOutbox(route: { input: unknown; user?: unknown }, ctx: PluginContext) {
  if (route.user) throw refuse("COURIER_ONLY", "Only the store's courier may use this door.", 403);
  const input = route.input as Record<string, unknown> | null;
  if (input?.courier !== 1 || input.op !== "since") throw refuse("BAD_COURIER_REQUEST", "This is not a courier request.", 400);
  const key = KEYS[input.topic as string];
  if (!key) throw refuse("UNKNOWN_TOPIC", "Commerce sends order.shipped, order.paid and cart.left.", 404);
  const after = typeof input.after === "string" ? input.after : null;
  const limit = Number.isInteger(input.limit) ? Math.min(Math.max(input.limit as number, 1), 100) : 50;
  const query = { where: { [key]: { gt: after ?? "", lt: new Date(Date.now() - SETTLED_MS).toISOString() } }, orderBy: { [key]: "asc" }, limit };
  const page = await (key === "leftKey" ? ctx.storage.checkout_carts as StorageCollection<CheckoutRecord> : ctx.storage[ORDERS_COLLECTION] as OrdersCollection)
    .query(query as never) as { items: { id: string; data: OrderRecord & CheckoutRecord }[]; hasMore: boolean };
  const items = page.items.map(({ id, data }) => key === "leftKey" ? left(id, data) : key === "paidKey" ? paid(data) : shipped(data));
  return { courier: 1, items, next: page.items.at(-1)?.data[key] ?? after, more: page.hasMore };
}
