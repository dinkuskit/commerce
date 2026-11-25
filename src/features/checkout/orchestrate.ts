import { isRecord, sortedKeys } from "../../shared/record.js";
import { REGISTRY_BUILD } from "../../shared/registry-build.js";
import { normalizeMoney, parseMinorUnits } from "../catalog/kernel/index.js";
import { quoteCatalogBasket } from "../storefront-availability/kernel/index.js";
import { createCurrentPaymentRequest, providerSessionWindowIsValid } from "./payment-window.js";
import { composeCheckoutPricing, taxAddress } from "./pricing.js";
import { handOffPaidOrder, type PaidOrderHandoffResult } from "./paid-orders.js";
import { cut, lineOptions } from "../../shared/line-text.js";
import { CHECKOUT_PRICING_SCHEMA, CHECKOUT_VARIANT_SELECTION_SCHEMA } from "./types.js";
import type { AddonAnswer, AddonUse, CartLine, CheckoutAttempt, CheckoutExecution, CheckoutRecord, CheckoutLine, CheckoutVariantSelectionSnapshot, PaymentOutcome, PaymentSession, StockRequest } from "./types.js";
import {
  captureCheckoutContact,
  CheckoutContactError,
  freezeCheckoutContactSnapshot,
} from "../checkout-contact/index.js";

export class CheckoutError extends Error {}
function fail(message: string): never { throw new CheckoutError(message); }

const QUOTE_FAILURES = {
  unavailable: "Product unavailable",
  unpriced: "Product unpriced",
  // Catalog quotes these only for a managed item, which the Registry build never has.
  ...REGISTRY_BUILD ? {} : { "inventory-setup": "Inventory setup required", "inventory-unavailable": "Inventory unavailable" },
} as Record<string, string>;
export function cartInput(raw: unknown): CartLine[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) fail("Invalid cart");
  const quantities = new Map<string, number>();
  for (const line of raw) {
    if (!line || typeof line !== "object" || sortedKeys(line) !== "catalogItemId,quantity" ||
      typeof line.catalogItemId !== "string" || !line.catalogItemId.trim() ||
      !Number.isSafeInteger(line.quantity) || line.quantity <= 0) fail("Invalid cart line");
    const id = line.catalogItemId.trim();
    const quantity = (quantities.get(id) ?? 0) + line.quantity;
    if (!Number.isSafeInteger(quantity)) fail("Invalid quantity");
    quantities.set(id, quantity);
  }
  return [...quantities].sort(([a], [b]) => a.localeCompare(b)).map(([catalogItemId, quantity]) => ({ catalogItemId, quantity }));
}
async function freeze(
  cart: CartLine[],
  e: CheckoutExecution,
  addons?: AddonAnswer[],
  rawContact?: unknown,
): Promise<CheckoutAttempt> {
  if (!e.loadCheckoutContactRequirements) throw new CheckoutContactError("REQUIREMENTS_UNAVAILABLE");
  const lines: CheckoutLine[] = [];
  const selections: CheckoutVariantSelectionSnapshot[] = [];
  let stock: StockRequest | undefined;
  const attemptId = (e.createAttemptId ?? (() => globalThis.crypto.randomUUID()))();
  if (!attemptId) fail("Invalid attempt identity");
  if (!e.paymentBindingRef.trim()) fail("Payment binding required");
  if (e.pricing && e.pricing.paymentPricingSchema !== CHECKOUT_PRICING_SCHEMA) {
    fail("Payments pricing schema unsupported");
  }
  const quote = await quoteCatalogBasket(e.catalog, cart.map(line => line.catalogItemId), e.availability);
  if (!quote.ok) fail(QUOTE_FAILURES[quote.reason]!);
  const shipsGoods = quote.lines.some(line => line.fulfillment === "physical");
  const contactSnapshot = await captureCheckoutContact(rawContact, e.loadCheckoutContactRequirements, shipsGoods);
  for (const [index, quoted] of quote.lines.entries()) {
    const line = cart[index];
    const { variant } = quoted;
    if (variant) selections.push({ schema: CHECKOUT_VARIANT_SELECTION_SCHEMA, productId: variant.productId,
      catalogItemId: line.catalogItemId, selections: variant.selections, fulfillment: variant.fulfillment });
    // Payments shows the choices under the name on Stripe's page, the same text as the order page.
    const options = cut(lineOptions({ variantSelections: selections }, line.catalogItemId));
    lines.push({ ...line, name: quoted.name, unitPrice: quoted.unitPrice, ...(options ? { options } : {}) });
    // Catalog quotes stock only for a managed item, which the Registry build never has.
    if (!REGISTRY_BUILD && quoted.stock) {
      stock ??= { operationId: attemptId, binding: quote.inventory!, requirements: [] };
      const existing = stock.requirements.find(r => r.skuId === quoted.stock!.skuId);
      if (existing) {
        existing.quantity += line.quantity;
        existing.allowBackorders &&= quoted.stock.allowBackorders;
        if (!Number.isSafeInteger(existing.quantity)) fail("Invalid quantity");
      } else stock.requirements.push({ skuId: quoted.stock.skuId, quantity: line.quantity, allowBackorders: quoted.stock.allowBackorders });
    }
  }
  const { delivery, billing } = contactSnapshot.contact;
  const pricing = e.pricing ? await composeCheckoutPricing(lines, e, shipsGoods, addons, taxAddress(delivery ?? billing))
    : addons ? fail("Pricing composition is unavailable") : undefined;
  const minor = lines.reduce((sum, line) => sum + parseMinorUnits(line.unitPrice.minor) * BigInt(line.quantity), 0n).toString();
  const total = pricing?.finalTotal ?? normalizeMoney({ currency: "USD", minor });
  return {
    attemptId,
    cart,
    contactSnapshot,
    ...(e.paymentMode ? { paymentMode: e.paymentMode } : {}),
    ...(selections.length ? { variantSelections: selections } : {}),
    payment: createCurrentPaymentRequest({
    attemptId, bindingRef: e.paymentBindingRef, lines, total,
    ...(pricing ? { pricing } : {}),
    }),
    ...(stock ? { stock } : {}),
    ...(addons ? { addons: addons.map(({ from, ref, codes }) => ({ from, ref, codes })) } : {}),
    phase: "reserving",
  };
}



/** Printable ASCII only, so a character is a byte and the paid news stays under the courier's 8 KB. */
const TEXT = (value: unknown, max: number) => typeof value === "string" && /^[!-~]+$/.test(value) && value.length <= max;
const CENTS = (value: unknown) => typeof value === "string" && /^\d{1,10}$/.test(value) && +value <= 1e9;
/** A tax rate in millionths, under 100%. */
const RATE = (value: unknown) => typeof value === "string" && /^\d{1,6}$/.test(value);

/**
 * The add-ons' answers, as the store's own code hands them to the add-ons door (commerce-addons-door-20261124):
 * at most 4, one per add-on, each naming at most 100 lines and 6 codes; amounts are whole cents up to $10,000,000.
 * What the order keeps of them (each one's from, ref and codes) is at most 1,500 characters as JSON (punctuation counted), so the paid news fits the
 * courier's 8 KB beside the largest address. Anything malformed, including what makes a check throw, leaves checkout unavailable.
 */
function addonAnswers(list: AddonAnswer[]): AddonAnswer[] {
  if (!list.length || list.length > 4 || new Set(list.map(answer => answer.from)).size < list.length ||
    !list.every(answer => /^(codes,)?from,lines(,ref)?(,ship)?(,shipRate,to)?$/.test(sortedKeys(answer)) && TEXT(answer.from, 64) &&
      (answer.ref === undefined || TEXT(answer.ref, 200)) && (answer.ship ?? "free") === "free" && (answer.to === undefined || RATE(answer.shipRate)) &&
      (answer.codes ?? []).length <= 6 && (answer.codes ?? []).every(code => TEXT(code, 64)) && answer.lines.length <= 100 &&
      answer.lines.every(line => sortedKeys(line) === (answer.to === undefined ? "item,off,price,qty" : "item,off,price,qty,rate") &&
        TEXT(line.item, 200) && CENTS(line.price) && CENTS(line.off) && (answer.to === undefined || RATE(line.rate)))) ||
    JSON.stringify(list.map(answer => [answer.from, answer.ref, answer.codes])).length > 1500) {
    fail("Invalid add-on answer");
  }
  return list;
}
const chosen = (addons?: readonly AddonUse[]) => JSON.stringify(addons?.map(({ from, codes }) => [from, codes]) ?? []);
/** Prefer a paid attempt over later ones (a late payment wake can revive an earlier expired attempt). */
export const currentAttempt = (attempts?: readonly CheckoutAttempt[]) => attempts?.filter(a => a.phase === "paid").at(-1) ?? attempts?.at(-1);

/** cartId is a server-owned, tenant-scoped guest capability; never accept arbitrary browser IDs. */
/** `saved`: the lines were read from the saved cart, which must still hold them (the guest route). */
/** `remind`: the left cart's fields, saved with the new attempt unless that cart was already left (or emailed by a 0.9.0 beta). */
export async function startCheckout(e: CheckoutExecution, cartId: string, rawCart: unknown, retryAfter?: string, saved?: boolean,
  remind?: Pick<CheckoutRecord, "remindAt" | "news">, fence?: (record?: CheckoutRecord) => void): Promise<CheckoutAttempt> {
  if (!cartId.trim()) fail("Invalid cart identity");
  const body = isRecord(rawCart) ? rawCart as { lines: unknown; contact?: unknown; addons?: AddonAnswer[] } : undefined;
  if (!Array.isArray(rawCart) && !body || body && !/^(addons,)?(contact,)?lines$/.test(sortedKeys(body))) fail("Invalid cart");
  const requested = body && "addons" in body ? addonAnswers(body.addons!) : undefined;
  const cart = cartInput(body ? body.lines : rawCart);
  for (let tries = 0; tries < 20; tries++) {
    const stored = await e.store.read(cartId);
    fence?.(stored?.record);
    const previous = currentAttempt(stored?.record.attempts);
    if (previous && previous.phase !== "released") {
      // Its cart and its add-ons' codes are both frozen.
      if (JSON.stringify(previous.cart) + chosen(previous.addons) !== JSON.stringify(cart) + chosen(requested)) fail("Active checkout cart is frozen");
      return drive(e, cartId, previous.attemptId, true);
    }
    // Checkout buys the saved cart: one changed, or deleted by expiry cleanup, since it was read is contention.
    if ((saved || stored?.record.cart) && JSON.stringify(stored?.record.cart?.lines) !== JSON.stringify(cart)) fail("Checkout contention; retry");
    if (previous && retryAfter !== previous.attemptId) fail("Retry requires the released attempt identity");
    if (!previous && retryAfter !== undefined) fail("Retry checkout not found");
    const attempt = await freeze(
      cart,
      e,
      requested,
      body?.contact,
    );
    // The saved cart's attributes are frozen with the attempt (commerce-cart-attributes-order-paid-20261123).
    const attributes = stored?.record.attributes;
    if (attributes && Object.keys(attributes).length) attempt.attributes = attributes;
    if (e.paymentAssociations && !await e.paymentAssociations.claim({
      recordKind: "checkout-payment-association",
      attemptId: attempt.attemptId,
      cartId,
      bindingRef: attempt.payment.bindingRef,
    })) {
      continue;
    }
    if (stored?.record.attempts.some(a => a.attemptId === attempt.attemptId)) fail("Attempt identity reused");
    if (await e.store.compareAndSet(cartId, stored?.version ?? null, { ...stored?.record, ...!stored?.record.emailed && !stored?.record.leftKey && remind, attempts: [...(stored?.record.attempts ?? []), attempt] })) {
      return drive(e, cartId, attempt.attemptId, true);
    }
  }
  return fail("Checkout contention; retry");
}

/**
 * What a payment wake learns from one pass: whether Orders took the paid order, and whether Payments
 * still answered unpaid for a checkout that had ended unpaid.
 */
export interface WakeProbe { handoff: PaidOrderHandoffResult; unpaid?: boolean }

/** An authenticated webhook consumer passes only identity; payloads/success pages are never authority. */
export async function reconcileCheckout(
  e: CheckoutExecution,
  cartId: string,
  attemptId: string,
  wake?: WakeProbe,
): Promise<CheckoutAttempt> {
  return drive(e, cartId, attemptId, false, wake);
}

function samePaymentSession(left: PaymentSession, right: PaymentSession): boolean {
  return left.sessionId === right.sessionId && left.redirectUrl === right.redirectUrl &&
    left.createdAt === right.createdAt && left.expiresAt === right.expiresAt;
}

function validateOutcome(value: PaymentOutcome, attempt: CheckoutAttempt): void {
  if (value.outcome === "unknown") return;
  if (value.attemptId !== attempt.attemptId) fail("Payment identity mismatch");
  if (value.outcome === "not-created") {
    if (attempt.session) fail("Known payment session cannot be not-created");
    return;
  }
  const total = normalizeMoney(value.total);
  if (total.currency !== attempt.payment.total.currency || total.minor !== attempt.payment.total.minor) fail("Payment total mismatch");
  const s = value.session;
  if (!providerSessionWindowIsValid(s, attempt.payment)) fail("Invalid payment window");
  let url: URL;
  try { url = new URL(s.redirectUrl); } catch { return fail("Invalid payment redirect"); }
  if (url.protocol !== "https:" || url.username || url.password) fail("Invalid payment redirect");
  if (attempt.session && !samePaymentSession(attempt.session, s)) fail("Payment session changed");
  if (value.outcome === "paid" && !value.paymentId) fail("Missing payment identity");
}

async function finishPaid(
  e: CheckoutExecution,
  cartId: string,
  attempt: CheckoutAttempt,
  wake?: WakeProbe,
): Promise<CheckoutAttempt> {
  const handoff = await handOffPaidOrder(e, attempt);
  if (wake) wake.handoff = handoff;
  return attempt;
}

function reserveTicketIds(result: unknown, lines: number): readonly string[] | null | "rejected" | "unknown" {
  if (result === "unknown") return "unknown";
  if (result === "rejected") return "rejected";
  if (result === "reserved") return null;
  if (!isRecord(result)) fail("Invalid reservation outcome");
  const value = result as { outcome?: unknown; ticketIds?: unknown };
  if (value.outcome !== "reserved" || !Array.isArray(value.ticketIds)) fail("Invalid reservation outcome");
  const ids = value.ticketIds;
  if (ids.length !== lines || new Set(ids).size !== ids.length) fail("Invalid reservation outcome");
  for (const id of ids) if (typeof id !== "string" || !id.trim() || id !== id.trim()) fail("Invalid reservation outcome");
  return ids;
}
function release(next: CheckoutAttempt, reason: NonNullable<CheckoutAttempt["paymentReleaseReason"]>): void {
  next.phase = "releasing";
  next.paymentReleaseReason = reason;
}
function completeOrder(e: CheckoutExecution, next: CheckoutAttempt, attempt: CheckoutAttempt, attemptId: string, paymentId?: string): void {
  next.phase = "paid";
  next.order = {
    orderId: "order:" + attemptId, receiptId: "receipt:" + attemptId, attemptId,
    ...(paymentId === undefined ? {} : { paymentId }),
    ...(attempt.paymentMode ? { mode: attempt.paymentMode } : {}),
    paidAt: new Date((e.now?.() ?? Date.now() / 1000) * 1000).toISOString(),
    lines: attempt.payment.lines, total: attempt.payment.total,
    ...(attempt.payment.pricing ? { pricing: structuredClone(attempt.payment.pricing) } : {}),
    ...(attempt.variantSelections ? { variantSelections: structuredClone(attempt.variantSelections) } : {}),
    ...(attempt.ticketIds ? { ticketIds: [...attempt.ticketIds] } : {}),
    ...(next.contactSnapshot ? { contactSnapshot: next.contactSnapshot } : {}),
    ...(attempt.phase === "released" ? { paidAfterEnd: true as const } : {}),
    ...(attempt.addons ? { addons: attempt.addons } : {}),
    ...(attempt.attributes ? { attributes: attempt.attributes } : {}),
  };
}

async function drive(
  e: CheckoutExecution,
  cartId: string,
  attemptId: string,
  create: boolean,
  wake?: WakeProbe,
): Promise<CheckoutAttempt> {
  for (let tries = 0; tries < 20; tries++) {
    const stored = await e.store.read(cartId);
    if (!stored) fail("Checkout not found");
    const index = stored.record.attempts.findIndex(a => a.attemptId === attemptId);
    const attempt = stored.record.attempts[index];
    if (!attempt) fail("Checkout not found");
    if (attempt.phase === "paid") return finishPaid(e, cartId, attempt, wake);
    // Only a payment wake asks again about a checkout that ended unpaid (commerce-late-payment-makes-order-20261123).
    if (attempt.phase === "released" && !(wake && attempt.paymentReleaseReason === "expired-unpaid")) return attempt;
    const next = structuredClone(attempt);
    if (attempt.contactSnapshot) {
      next.contactSnapshot = freezeCheckoutContactSnapshot(attempt.contactSnapshot);
    }
    if (attempt.phase === "reserving") {
      if (!REGISTRY_BUILD && attempt.stock) {
        const provider = await e.resolveInventory(attempt.stock.binding);
        if (!provider) return attempt;
        let result;
        try { result = await provider.reserve(structuredClone(attempt.stock)); } catch { return attempt; }
        const ticketIds = reserveTicketIds(result, attempt.stock.requirements.length);
        if (ticketIds === "unknown") return attempt;
        if (ticketIds === "rejected") {
          next.phase = "released";
          next.paymentReleaseReason = "never-started";
        } else {
          if (ticketIds) next.ticketIds = ticketIds;
          next.phase = "paying";
        }
      } else next.phase = "paying";
    } else if (attempt.phase === "releasing") {
      if (!REGISTRY_BUILD && attempt.stock) {
        const provider = await e.resolveInventory(attempt.stock.binding);
        if (!provider) return attempt;
        let result;
        try { result = await provider.release(structuredClone(attempt.stock)); } catch { return attempt; }
        if (result !== "released") return attempt;
      }
      next.phase = "released";
    } else {
      if (attempt.payment.total.currency === "USD" && attempt.payment.total.minor === "0") {
        completeOrder(e, next, attempt, attemptId);
      } else {
        // Current host support is not an authoritative provider creation fence.
        if (attempt.payment.pricing && e.pricing?.paymentPricingSchema !== CHECKOUT_PRICING_SCHEMA) return attempt;
        // Started in the other mode: wait until the store is back in it, so a test payment never becomes a live order or the reverse.
        if ((attempt.paymentMode ?? "test") !== (e.paymentMode ?? "test")) return attempt;
        let outcome: PaymentOutcome;
        try {
          const payments = await e.resolvePayments(attempt.payment.bindingRef);
          if (!payments || attempt.payment.pricing && payments.pricingSchema !== CHECKOUT_PRICING_SCHEMA) return attempt;
          outcome = await (create ? payments.ensureSession(structuredClone(attempt.payment)) : payments.lookup(structuredClone(attempt.payment)));
        } catch { return attempt; }
        validateOutcome(outcome, attempt);
        if (attempt.phase === "released" && outcome.outcome !== "paid") {
          if (outcome.outcome === "expired-unpaid") wake!.unpaid = true;
          return attempt;
        }
        if (outcome.outcome === "unknown") return attempt;
        if (outcome.outcome === "not-created") {
          release(next, "not-created");
        }
        else {
          next.session = outcome.session;
          if (outcome.outcome === "paid") {
            completeOrder(e, next, attempt, attemptId, outcome.paymentId);
          } else if (outcome.outcome === "expired-unpaid") {
            release(next, "expired-unpaid");
          }
        }
      }
    }
    const attempts = [...stored.record.attempts];
    attempts[index] = next;
    if (await e.store.compareAndSet(cartId, stored.version, { ...stored.record, attempts })) {
      if (next.phase === "paying" && next.session) {
        // A local clock can suppress an old redirect but never authorize release.
        if ((e.now ?? (() => Date.now() / 1000))() >= next.session.expiresAt) return { ...next, session: undefined };
        return next;
      }
      if (next.phase === "paid") return finishPaid(e, cartId, next, wake);
      if (next.phase === "released") return next;
    }
  }
  return fail("Checkout contention; retry");
}
