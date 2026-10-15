import type { PluginContext, SandboxedRouteContext } from "emdash/plugin";
import { isRecord } from "../../shared/record.js";
import { completeOrder, listOrders, orderFacts, ORDERS_COLLECTION, reopenOrder, type OrderRecord, type OrdersCollection } from "./store.js";
import { admitShipOrder, disableShipOrder, validGeneration } from './cohort.js';
import { resolveRegistryShip } from '../checkout/kernel/index.js';

/** Private JSON route for agents and the CLI: the Orders page's reads and owner changes. */
export const ORDERS_API_ROUTE = "orders";
const PAGE = 50;

/** One order for agents: the frozen paid order's facts and what Orders keeps beside it. */
function apiOrder(record: OrderRecord) {
  const order = record.paidOrder;
  return {
    ...orderFacts(record), paidAt: order.paidAt ?? null, total: order.total, lines: order.lines,
    choices: order.variantSelections ?? [], phone: order.contactSnapshot?.contact?.phone ?? null,
  };
}

function invalid(): never {
  throw new Error("Invalid orders request");
}

/**
 * list (optional status and offset, 50 a page, by order number), show, complete
 * (optional carrier and tracking) and reopen. Changes name the order version they
 * were read at, like the Orders page's forms, so a stale change does nothing.
 */
export async function ordersApi(route: SandboxedRouteContext, ctx: PluginContext): Promise<unknown> {
  // EmDash already requires plugins:manage, and the admin scope for API tokens; this is the Orders page's own check.
  if (route.user?.role !== 50) throw new Error("Orders require plugins:manage");
  const input = route.input;
  if (!isRecord(input)) invalid();
  const allowed = { list: "action,status,offset", show: "action,orderId", complete: "action,orderId,version,carrier,tracking", reopen: "action,orderId,version",
    'ship.admit': 'action,orderId,version,generation', 'cohort.disable': 'action,orderId,generation' }[String(input.action)];
  if (!allowed || Object.keys(input).some(key => !allowed.split(",").includes(key))) invalid();
  const collection = ctx.storage[ORDERS_COLLECTION] as OrdersCollection;
  if (input.action === "list") {
    const { status, offset = 0 } = input;
    if ((status !== undefined && status !== "processing" && status !== "completed") || !Number.isSafeInteger(offset) || (offset as number) < 0) invalid();
    const start = offset as number;
    const orders = (await listOrders(collection)).filter(record => !status || (status === "completed") === !!record.completed)
      .sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity));
    return { orders: orders.slice(start, start + PAGE).map(apiOrder), total: orders.length,
      ...(start + PAGE < orders.length ? { next: start + PAGE } : {}) };
  }
  const id = input.orderId, version = input.version as number;
  if (typeof id !== "string" || !id || id.length > 1024) invalid();
  if (input.action === 'ship.admit' || input.action === 'cohort.disable') {
    if (id.length > 200 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(id) || !validGeneration(input.generation)) invalid();
    if (input.action === 'cohort.disable') return { result: await disableShipOrder(collection, id, input.generation) };
    if (!Number.isSafeInteger(version) || version < 1) invalid();
    const ship = await resolveRegistryShip(ctx);
    if (!ship?.isolation || ship.isolation.generation !== input.generation || !await ship.current?.()) invalid();
    return { result: await admitShipOrder(collection, id, version, { ...ship.isolation, site: ship.site }) };
  }
  if (input.action === "show") {
    const kept = await collection.get(id);
    return { order: kept ? apiOrder(kept) : null };
  }
  if (!Number.isSafeInteger(version) || version < 1) invalid();
  if (!await collection.get(id)) return { result: "not_found" };
  const result = input.action === "complete"
    ? await completeOrder(collection, id, version, input, new Date().toISOString())
    : await reopenOrder(collection, id, version);
  return { result, order: apiOrder((await collection.get(id))!) };
}
