import { isRecord } from "../../shared/record.js";
import { completeOrder, listOrders, orderFacts, type OrdersCollection } from "./store.js";

/** One order version as Orders sends it to Ship's hosted service (docs/contracts/commerce-handoffs.md). */
export const SHIP_ORDER_SCHEMA = "dinkuskit.commerce.ship-order/v1";
/** At most this many orders go to Ship per sync, so a backlog never holds up the Orders page for long. */
export const SHIP_ORDERS_PER_SYNC = 10;

/** Ship's hosted service for this store, bound by the entry. */
export interface ShipConnection {
  /** Bare https origin, such as https://ship.dinkuskit.com. */
  origin: string;
  /** The store's id at Ship, the same as in its passes. */
  site: string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Reads a JSON answer, refusing one too large to be Ship's. */
  read: (response: Response) => Promise<unknown>;
  /** A current ship:orders pass for this store. */
  credential: () => Promise<string>;
}

/** Whether a catalog item goes in the box, and its shipping weight in ounces when set; null when it is gone. */
export type ShipItemLookup = (catalogItemId: string) => Promise<{ physical: boolean; weightOz?: number } | null>;

function unavailable(): never {
  throw new Error("Ship unavailable");
}

/** Ship's label page for one order. The owner signs in there with DinkusKit.com; the link carries no pass. */
export function shipLabelPage(ship: Pick<ShipConnection, "origin" | "site">, orderId: string): string {
  return new URL(ship.origin).origin + "/stores/" + encodeURIComponent(ship.site) + "/orders/" + encodeURIComponent(orderId);
}

/**
 * Brings Orders and Ship up to date. Each label Ship bought marks its order Completed with
 * Ship's carrier and tracking number, but only while the order is still Processing at the
 * version Ship labeled; either way the label is acknowledged. Then each order with a delivery
 * address goes to Ship whenever its version is one Ship has not taken. Throws when Ship cannot
 * be reached; anything not acknowledged or sent is picked up by the next sync.
 */
export async function syncShip(collection: OrdersCollection, ship: ShipConnection, item: ShipItemLookup): Promise<void> {
  const call = async (path: string, body?: unknown) => ship.fetch(new URL(ship.origin).origin + path, {
    method: body ? "POST" : "GET", cache: "no-store", redirect: "error",
    headers: { accept: "application/json", authorization: "Bearer " + await ship.credential(), "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const listed = await call("/v1/labels");
  const labels = listed.ok ? await ship.read(listed) : unavailable();
  if (!Array.isArray(labels) || labels.length > 100) unavailable();
  for (const label of labels) {
    if (!isRecord(label) || typeof label.eventId !== "string") unavailable();
    // A label for an order Orders does not have, an older version or a Completed order changes nothing.
    if (typeof label.orderId === "string" && await collection.get(label.orderId)) {
      await completeOrder(collection, label.orderId, label.version as number, label, new Date().toISOString());
    }
    if (!(await call("/v1/labels/ack", { eventId: label.eventId })).ok) unavailable();
  }
  let room = SHIP_ORDERS_PER_SYNC;
  for (const record of await listOrders(collection)) {
    const facts = orderFacts(record);
    if (!facts.shipTo || record.shipVersion === facts.version) continue;
    if (!room--) break;
    const lines = [];
    for (const { catalogItemId, name, quantity, unitPrice } of record.paidOrder.lines) {
      // Digital items never go in the box; an item since removed from the catalog goes without a weight.
      // Each line carries what the shopper paid for one of it, for insurance and packing slips.
      const found = await item(catalogItemId);
      if (found?.physical !== false) lines.push({ catalogItemId, name, quantity, unitPrice, ...(found?.weightOz ? { weightOz: found.weightOz } : {}) });
    }
    const response = await call("/v1/orders", { schema: SHIP_ORDER_SCHEMA, ...facts, lines });
    // 422 means Ship can never label this version, so it waits for the order's next change.
    if (!response.ok && response.status !== 422) unavailable();
    const current = await collection.getVersioned(facts.orderId);
    if (current && (current.value.revision ?? 1) === facts.version) {
      await collection.compareAndSet(facts.orderId, current.revision, { ...current.value, shipVersion: facts.version });
    }
  }
}
