import { loadCatalogItemBackorderPolicy, normalizeMoney, parseMinorUnits, resolveCatalogItemPrice } from "../catalog/index.js";
import { normalizeStoredStockManagement } from "../inventory-provider/index.js";
import { loadStoreInventoryConfiguration } from "../inventory-setup/index.js";
import { resolveStorefrontAvailability } from "../storefront-availability/index.js";
import type { CartLine, CheckoutAttempt, CheckoutExecution, CheckoutLine, PaymentOutcome, StockRequest } from "./types.js";

export class CheckoutError extends Error {}
function fail(message: string): never { throw new CheckoutError(message); }
function cartInput(raw: unknown): CartLine[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) fail("Invalid cart");
  const quantities = new Map<string, number>();
  for (const line of raw) {
    if (!line || typeof line !== "object" || Object.keys(line).sort().join() !== "catalogItemId,quantity" ||
      typeof line.catalogItemId !== "string" || !line.catalogItemId.trim() ||
      !Number.isSafeInteger(line.quantity) || line.quantity <= 0) fail("Invalid cart line");
    const id = line.catalogItemId.trim();
    const quantity = (quantities.get(id) ?? 0) + line.quantity;
    if (!Number.isSafeInteger(quantity)) fail("Invalid quantity");
    quantities.set(id, quantity);
  }
  return [...quantities].sort(([a], [b]) => a.localeCompare(b)).map(([catalogItemId, quantity]) => ({ catalogItemId, quantity }));
}
function current(attempts: CheckoutAttempt[]): CheckoutAttempt {
  return attempts[attempts.length - 1] ?? fail("Checkout not found");
}
async function freeze(cart: CartLine[], e: CheckoutExecution): Promise<CheckoutAttempt> {
  const lines: CheckoutLine[] = [];
  let stock: StockRequest | undefined;
  const attemptId = (e.createAttemptId ?? (() => globalThis.crypto.randomUUID()))();
  if (!attemptId) fail("Invalid attempt identity");
  if (!e.paymentBindingRef.trim()) fail("Payment binding required");
  for (const line of cart) {
    const item = await e.catalog.catalog.get(line.catalogItemId);
    if (!item || item.recordKind !== "catalog-item" || item.itemId !== line.catalogItemId) fail("Product unavailable");
    const availability = await resolveStorefrontAvailability(e.catalog, { catalogItemId: line.catalogItemId }, e.availability);
    if (!availability.sellable) fail("Product unavailable");
    const price = await resolveCatalogItemPrice(e.catalog.prices, line.catalogItemId);
    if (!price.customerPays) fail("Product unpriced");
    lines.push({ ...line, name: item.name, unitPrice: price.customerPays });
    const management = normalizeStoredStockManagement(item.stockManagement);
    if (management.mode === "managed") {
      if (management.status !== "active") fail("Inventory setup required");
      if (!stock) {
        const config = await loadStoreInventoryConfiguration(e.catalog.configurations);
        if (!config) fail("Inventory unavailable");
        stock = { operationId: attemptId, binding: config.binding, requirements: [] };
      }
      const policy = await loadCatalogItemBackorderPolicy(e.catalog.backorderPolicies, item.itemId);
      const existing = stock.requirements.find(r => r.skuId === management.inventorySkuId);
      if (existing) {
        existing.quantity += line.quantity;
        existing.allowBackorders &&= policy.allowBackorders;
        if (!Number.isSafeInteger(existing.quantity)) fail("Invalid quantity");
      } else stock.requirements.push({ skuId: management.inventorySkuId, quantity: line.quantity, allowBackorders: policy.allowBackorders });
    }
  }
  const minor = lines.reduce((sum, line) => sum + parseMinorUnits(line.unitPrice.minor) * BigInt(line.quantity), 0n).toString();
  const total = normalizeMoney({ currency: "USD", minor });
  // This slice has no free-order or delayed-payment settlement policy.
  if (minor === "0") fail("Zero-total checkout is outside this payment slice");
  return { attemptId, cart, payment: { attemptId, bindingRef: e.paymentBindingRef, lines, total, paymentWindowSeconds: 1800, paymentMethods: ["card"] }, ...(stock ? { stock } : {}), phase: "reserving" };
}

/** cartId is a server-owned, tenant-scoped guest capability; never accept arbitrary browser IDs. */
export async function startCheckout(e: CheckoutExecution, cartId: string, rawCart: unknown, retryAfter?: string): Promise<CheckoutAttempt> {
  if (!cartId.trim()) fail("Invalid cart identity");
  const cart = cartInput(rawCart);
  for (let tries = 0; tries < 20; tries++) {
    const stored = await e.store.read(cartId);
    const previous = stored ? current(stored.record.attempts) : undefined;
    if (previous && previous.phase !== "released") {
      if (JSON.stringify(previous.cart) !== JSON.stringify(cart)) fail("Active checkout cart is frozen");
      return drive(e, cartId, previous.attemptId, true);
    }
    if (previous && retryAfter !== previous.attemptId) fail("Retry requires the released attempt identity");
    if (!previous && retryAfter !== undefined) fail("Retry checkout not found");
    const attempt = await freeze(cart, e);
    if (stored?.record.attempts.some(a => a.attemptId === attempt.attemptId)) fail("Attempt identity reused");
    if (await e.store.compareAndSet(cartId, stored?.version ?? null, { attempts: [...(stored?.record.attempts ?? []), attempt] })) {
      return drive(e, cartId, attempt.attemptId, true);
    }
  }
  return fail("Checkout contention; retry");
}

/** An authenticated webhook consumer passes only identity; payloads/success pages are never authority. */
export async function reconcileCheckout(e: CheckoutExecution, cartId: string, attemptId: string): Promise<CheckoutAttempt> {
  return drive(e, cartId, attemptId, false);
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
  if (!s.sessionId || !Number.isSafeInteger(s.createdAt) || s.expiresAt !== s.createdAt + 1800 ||
    !Number.isSafeInteger(s.expiresAt)) fail("Invalid payment window");
  let url: URL;
  try { url = new URL(s.redirectUrl); } catch { return fail("Invalid payment redirect"); }
  if (url.protocol !== "https:" || url.username || url.password) fail("Invalid payment redirect");
  if (attempt.session && JSON.stringify(attempt.session) !== JSON.stringify(s)) fail("Payment session changed");
  if (value.outcome === "paid" && !value.paymentId) fail("Missing payment identity");
}

async function drive(e: CheckoutExecution, cartId: string, attemptId: string, create: boolean): Promise<CheckoutAttempt> {
  for (let tries = 0; tries < 20; tries++) {
    const stored = await e.store.read(cartId);
    if (!stored) fail("Checkout not found");
    const index = stored.record.attempts.findIndex(a => a.attemptId === attemptId);
    const attempt = stored.record.attempts[index];
    if (!attempt) fail("Checkout not found");
    if (attempt.phase === "paid" || attempt.phase === "released") return attempt;
    const next = structuredClone(attempt);
    if (attempt.phase === "reserving") {
      if (attempt.stock) {
        const provider = await e.resolveInventory(attempt.stock.binding);
        if (!provider) return attempt;
        let result;
        try { result = await provider.reserve(structuredClone(attempt.stock)); } catch { return attempt; }
        if (result === "unknown") return attempt;
        if (result !== "reserved" && result !== "rejected") fail("Invalid reservation outcome");
        next.phase = result === "reserved" ? "paying" : "released";
      } else next.phase = "paying";
    } else if (attempt.phase === "releasing") {
      if (attempt.stock) {
        const provider = await e.resolveInventory(attempt.stock.binding);
        if (!provider) return attempt;
        let result;
        try { result = await provider.release(structuredClone(attempt.stock)); } catch { return attempt; }
        if (result !== "released") return attempt;
      }
      next.phase = "released";
    } else {
      let outcome: PaymentOutcome;
      try {
        const payments = await e.resolvePayments(attempt.payment.bindingRef);
        if (!payments) return attempt;
        outcome = await (create ? payments.ensureSession(structuredClone(attempt.payment)) : payments.lookup(structuredClone(attempt.payment)));
      } catch { return attempt; }
      validateOutcome(outcome, attempt);
      if (outcome.outcome === "unknown") return attempt;
      if (outcome.outcome === "not-created") next.phase = "releasing";
      else {
        next.session = outcome.session;
        if (outcome.outcome === "paid") {
          next.phase = "paid";
          next.order = { orderId: `order:${attemptId}`, receiptId: `receipt:${attemptId}`, attemptId, paymentId: outcome.paymentId, lines: attempt.payment.lines, total: attempt.payment.total };
        } else if (outcome.outcome === "expired-unpaid") next.phase = "releasing";
        else {
          // A local clock can suppress an old redirect but never authorize release.
          if ((e.now ?? (() => Date.now() / 1000))() >= outcome.session.expiresAt) {
            return { ...attempt, session: undefined };
          }
        }
      }
    }
    const attempts = [...stored.record.attempts];
    attempts[index] = next;
    if (await e.store.compareAndSet(cartId, stored.version, { attempts })) {
      if (next.phase === "paying" && next.session) return next;
      if (next.phase === "paid" || next.phase === "released") return next;
    }
  }
  return fail("Checkout contention; retry");
}
