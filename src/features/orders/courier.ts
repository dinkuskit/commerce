import type { PluginContext } from "emdash";
import { ORDERS_COLLECTION, orderFacts, type OrderRecord, type OrdersCollection } from "./store.js";

/**
 * Commerce's courier outbox (dinkuskit/courier docs/doors.md; order-shipped-outbox-20261122): the news
 * that an order was marked Completed, for Reviews. Only the store's courier calls it, from the store's
 * own code with nobody signed in, so the buyer's email never leaves the store.
 */
export const COURIER_OUTBOX_ROUTE = "courier/outbox";
/** A Completed order is news once it is a minute old, so one saved a moment later under an earlier time is never passed by. */
const SETTLED_MS = 60_000;

/** A refusal in the shape of EmDash's route error, its code leading the words, which are all a sandbox passes on. */
const refuse = (code: string, words: string, status: number) =>
  Object.assign(new Error(`${code}: ${words}`), { name: "PluginRouteError", code, status });

function news(record: OrderRecord) {
  const order = record.paidOrder, at = record.completed!.at, { email, shipTo } = orderFacts(record);
  return { id: `${order.orderId}:shipped`, at, data: {
    orderId: order.orderId, shippedAt: at, email, name: (shipTo ?? order.contactSnapshot?.contact?.billing)?.name ?? null,
    // A size or colour is reviewed as its product, under the id the product page shows.
    lines: order.lines.map(line => ({ productId: order.variantSelections?.find(v => v.catalogItemId === line.catalogItemId)?.productId ?? line.catalogItemId, productName: line.name })),
  } };
}

/** `POST courier/outbox`: the orders Completed after the courier's bookmark, oldest first. */
export async function courierOutbox(route: { input: unknown; user?: unknown }, ctx: PluginContext) {
  if (route.user) throw refuse("COURIER_ONLY", "Only the store's courier may use this door.", 403);
  const input = route.input as Record<string, unknown> | null;
  if (input?.courier !== 1 || input.op !== "since") throw refuse("BAD_COURIER_REQUEST", "This is not a courier request.", 400);
  if (input.topic !== "order.shipped") throw refuse("UNKNOWN_TOPIC", "Commerce sends only order.shipped.", 404);
  const after = typeof input.after === "string" ? input.after : null;
  const limit = Number.isInteger(input.limit) ? Math.min(Math.max(input.limit as number, 1), 100) : 50;
  const page = await (ctx.storage[ORDERS_COLLECTION] as OrdersCollection).query({
    where: { shippedKey: { gt: after ?? "", lt: new Date(Date.now() - SETTLED_MS).toISOString() } },
    orderBy: { shippedKey: "asc" }, limit,
  });
  return { courier: 1, items: page.items.map(({ data }) => news(data)), next: page.items.at(-1)?.data.shippedKey ?? after, more: page.hasMore };
}
