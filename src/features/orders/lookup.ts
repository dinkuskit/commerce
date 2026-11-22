import type { PluginContext, StorageCollection } from "emdash";
import { admitSameOriginWrite, resolveTrustedSiteOrigin } from "../checkout/kernel/index.js";
import { isRecord } from "../../shared/record.js";
import { sha256Hex } from "../../shared/secret.js";
import { ORDERS_COLLECTION, findOrderByNumberAndEmail, projectShopperOrder, type OrdersCollection, type ShopperOrderSummary } from "./store.js";

/**
 * The order lookup page, like WooCommerce's Track your order (templates/order/form-tracking.php): order number
 * plus checkout email shows that one order, and the not-found answer never says which box was wrong
 * (accounts-v1-scope-20261121). Wrong guesses are limited: 5 for one email or one order number, then that
 * box is refused for an hour after its last try (order-lookup-guess-limit-20261122). A try is claimed before the
 * order is read and given back when the guess is right.
 */
export const ORDER_LOOKUP_ROUTE = "orders/lookup";
export const ORDER_LOOKUP_GUESSES_COLLECTION = "order_lookup_guesses";
export const ORDER_LOOKUP_TRIES = 5;
export const ORDER_LOOKUP_WAIT_SECONDS = 3600;

interface GuessRecord { tries: number; expiresAt: number }
type Guesses = Pick<StorageCollection<GuessRecord>, "getVersioned" | "compareAndSet" | "compareAndDelete" | "query">;

const MESSAGES = {
  INVALID_INPUT: "Enter your order number and the email used at checkout.",
  ORDER_NOT_FOUND: "No order matches that order number and email. Check both and try again.",
  LOOKUP_LIMITED: "Too many tries. Try again in an hour.",
  ORIGIN_DENIED: "That request did not come from this store.",
  UNAVAILABLE: "Order lookup is unavailable right now. Try again in a moment.",
} as const;
type LookupErrorCode = keyof typeof MESSAGES;

export type OrderLookupResult =
  | { ok: true; order: ShopperOrderSummary }
  | { ok: false; error: { code: LookupErrorCode; message: string } };

class Refused extends Error {
  constructor(readonly code: LookupErrorCode) { super(code); }
}
const refuse = (code: LookupErrorCode): never => { throw new Refused(code); };

function admitInput(input: unknown): { number: number; emailKey: string } {
  if (!isRecord(input) || Object.keys(input).sort().join() !== "email,orderNumber") refuse("INVALID_INPUT");
  const { email, orderNumber } = input as { email: unknown; orderNumber: unknown };
  const digits = typeof orderNumber === "number" ? String(orderNumber) : typeof orderNumber === "string" ? orderNumber.trim().replace(/^#/, "") : "";
  const emailKey = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!/^[1-9][0-9]{0,14}$/.test(digits) || !Number.isSafeInteger(+digits) || emailKey.length > 254 || !/^[^@\s]+@[^@\s]+$/.test(emailKey)) {
    refuse("INVALID_INPUT");
  }
  return { number: +digits, emailKey };
}

const limited = (row: { value: GuessRecord } | null, now: number) =>
  row !== null && row.value.tries >= ORDER_LOOKUP_TRIES && now < row.value.expiresAt;

/**
 * Claims one try against a box before any order is read, so a burst of lookups at the same moment gets no more
 * than 5 reads; a used-up box is refused, and a claim that cannot be kept fails closed.
 */
async function claimTry(guesses: Guesses, id: string, now: number): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await guesses.getVersioned(id);
    if (limited(row, now)) refuse("LOOKUP_LIMITED");
    const tries = row && now < row.value.expiresAt ? row.value.tries + 1 : 1;
    if ((await guesses.compareAndSet(id, row?.revision ?? null, { tries, expiresAt: now + ORDER_LOOKUP_WAIT_SECONDS })).applied) return;
  }
  refuse("UNAVAILABLE");
}

/** Gives a claimed try back: the guess was right, or the lookup stopped before reading an order. */
async function returnTry(guesses: Guesses, id: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await guesses.getVersioned(id);
    if (!row || row.value.tries < 1) return;
    if ((await guesses.compareAndSet(id, row.revision, { ...row.value, tries: row.value.tries - 1 })).applied) return;
  }
}

/** One order for its number and checkout email, from a same-origin write on the store's own server page. */
export async function lookUpOrder(route: { input: unknown; request: { url: string; headers?: Headers | Record<string, string> } },
  ctx: PluginContext, now = Math.floor(Date.now() / 1000)): Promise<OrderLookupResult> {
  try {
    const site = resolveTrustedSiteOrigin({ runtimeSiteUrl: ctx.site?.url });
    const orders = ctx.storage[ORDERS_COLLECTION] as OrdersCollection | undefined;
    const guesses = ctx.storage[ORDER_LOOKUP_GUESSES_COLLECTION] as Guesses | undefined;
    if (!site.ok || !orders || !guesses) refuse("UNAVAILABLE");
    admitSameOriginWrite({ requestUrl: route.request.url, headers: route.request.headers, siteOrigin: (site as { origin: string }).origin }, () => refuse("ORIGIN_DENIED"));
    const { number, emailKey } = admitInput(route.input);
    // Neither box is kept as typed: an email is kept only as its hash.
    const ids = [`email:${await sha256Hex(emailKey)}`, `number:${number}`];
    // Each box's try is claimed first and stays counted when the guess is wrong.
    const claimed: string[] = [];
    let record;
    try {
      for (const id of ids) { await claimTry(guesses!, id, now); claimed.push(id); }
      record = await findOrderByNumberAndEmail(orders!, number, emailKey);
    } catch (error) {
      for (const id of claimed) await returnTry(guesses!, id).catch(() => undefined);
      throw error;
    }
    if (!record) refuse("ORDER_NOT_FOUND");
    for (const id of claimed) await returnTry(guesses!, id).catch(() => undefined);
    return { ok: true, order: projectShopperOrder(record!) };
  } catch (error) {
    const code = error instanceof Refused ? error.code : "UNAVAILABLE";
    return { ok: false, error: { code, message: MESSAGES[code] } };
  }
}

/** Deletes up to 100 guess counts whose hour is over, each only at the revision it read and while still over. */
export async function clearOldLookupGuesses(ctx: PluginContext, now = Math.floor(Date.now() / 1000)): Promise<void> {
  const guesses = ctx.storage[ORDER_LOOKUP_GUESSES_COLLECTION] as Guesses | undefined;
  if (!guesses) return;
  const old = await guesses.query({ where: { expiresAt: { lte: now } }, limit: 100 });
  for (const { id } of old.items) {
    const row = await guesses.getVersioned(id);
    if (row && row.value.expiresAt <= now) await guesses.compareAndDelete(id, row.revision);
  }
}
