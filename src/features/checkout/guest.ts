import { isRecord, sortedKeys } from "../../shared/record.js";
import { GuestCheckoutError, guestCheckoutErrorMessage } from "./errors.js";
import { cartInput, startCheckout, reconcileCheckout } from "./orchestrate.js";
import { quoteCatalogBasket } from "../storefront-availability/kernel/index.js";
import { resolveCatalogVariantMember, variantSelections } from "../catalog/kernel/index.js";
import { CouponUnavailableError } from "./pricing.js";
import { authorizeGuestCapability, mintGuestCapability, readGuestCapabilityHeader } from "./capability.js";
import { projectGuestCheckout, projectPreparedGuestCheckout } from "./project.js";
import { createCheckoutStore } from "./storage.js";
import { reconcilePaymentWakes } from "./wake.js";
import { resolveTrustedSiteOrigin } from "./site-scope.js";
import {
  CheckoutContactError,
  type CheckoutContactRequirements,
} from "../checkout-contact/index.js";
import type {
  CartLine,
  CheckoutAttempt,
  CheckoutRecord,
  GuestCheckoutHostOptions,
  GuestCheckoutResult,
  GuestCheckoutRuntime,
} from "./types.js";
import type { CommercePaymentWakePort } from "./wake.js";

function fail(code: GuestCheckoutError["code"]): never {
  throw new GuestCheckoutError(code);
}

function asObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) fail("INVALID_CART");
  return value as Record<string, unknown>;
}

export function admitGuestCheckoutPrepareInput(raw: unknown): void {
  const input = raw === undefined ? {} : asObject(raw);
  if (Object.keys(input).length !== 0) fail("INVALID_CART");
}

/** Checkout starts from the cart record; the browser sends no lines (commerce-server-cart-20261113). */
export function admitGuestCheckoutStartInput(raw: unknown, pricing?: boolean): { couponCode?: string } {
  const input = asObject(raw);
  if (!["", "contact", ...(pricing ? ["couponCode", "contact,couponCode"] : [])].includes(sortedKeys(input))) fail("INVALID_CART");
  if (!Object.hasOwn(input, "couponCode")) return {};
  if (typeof input.couponCode !== "string" || !input.couponCode.trim() ||
      input.couponCode.length > 128) fail("INVALID_CART");
  return { couponCode: input.couponCode.trim() };
}

const CART_SECONDS = 30 * 86_400;

/** Live lines: none once the cart is 30 days untouched (commerce-cart-expiry-20261113) or its order is paid. */
export function cartLines(record: CheckoutRecord | undefined, now: number): CartLine[] {
  return record?.cart && now < +record.cartExpires! && record.attempts.at(-1)?.phase !== "paid" ? record.cart.lines : [];
}

async function cartLine(runtime: GuestCheckoutRuntime, line: unknown): Promise<CartLine> {
  if (!isRecord(line)) fail("INVALID_CART");
  const keys = sortedKeys(line);
  if (keys === "catalogItemId,quantity") return line as unknown as CartLine;
  const { productId, options, quantity } = line as { productId: unknown; options: unknown; quantity: unknown };
  if (keys !== "options,productId,quantity" || typeof productId !== "string" || !isRecord(options)) fail("INVALID_CART");
  // Commerce picks the variant from the chosen option labels (template-cart-size-picker-20261113).
  const product = (await resolveCatalogVariantMember(runtime.catalog.catalog, productId))?.product;
  const member = product?.members.find(m => m.selections.length === Object.keys(options).length &&
    variantSelections(product, m).every(s => options[s.optionLabel] === s.valueLabel));
  return member ? { catalogItemId: member.catalogItemId, quantity: quantity as number } : fail("PRODUCT_UNAVAILABLE");
}

/**
 * Read the cart (`{}`) or replace it whole (`{lines, version}`, plus `key` for an agent retry).
 * A stale version changes nothing (commerce-cart-agent-writes-20261113).
 */
export async function cartGuestCheckout(
  runtime: GuestCheckoutRuntime,
  input: unknown,
  headers?: Headers | Record<string, string>,
): Promise<GuestCheckoutResult> {
  try {
    const raw = input === undefined ? {} : asObject(input);
    const keys = sortedKeys(raw);
    if (!["", "lines,version", "key,lines,version"].includes(keys)) fail("INVALID_CART");
    const authorized = await authorizeGuestCapability(runtime, readGuestCapabilityHeader(headers));
    const store = createCheckoutStore(runtime.carts);
    const now = nowSeconds(runtime);
    const stored = await store.read(authorized.cartId);
    const { lines, version, key } = raw as { lines: unknown; version: unknown; key?: unknown };
    let attempt = stored?.record.attempts.at(-1);
    if (!keys) {
      // A read is also the status check: it runs Commerce's payment check on the current attempt.
      if (attempt && paymentsReady(runtime.host)) attempt = await reconcileCheckout(executionOf(runtime), authorized.cartId, attempt.attemptId);
    } else if (key === undefined || key !== stored?.record.cart?.key) {
      if (attempt && attempt.phase !== "released") fail("CHECKOUT_FROZEN");
      if (!Array.isArray(lines) || key !== undefined && (typeof key !== "string" || key.length > 128)) fail("INVALID_CART");
      if (version !== (stored?.version ?? null)) fail("CONTENTION");
      const merged = lines.length ? cartInput(await Promise.all(lines.map(line => cartLine(runtime, line)))) : [];
      // Stock is checked again when checkout starts; any refusal here reads as unavailable.
      if (!(await quoteCatalogBasket(runtime.catalog, merged.map(line => line.catalogItemId),
        { resolveProvider: runtime.host.resolveAvailabilityProvider })).ok) fail("PRODUCT_UNAVAILABLE");
      if (!await store.compareAndSet(authorized.cartId, stored?.version ?? null, {
        attempts: stored?.record.attempts ?? [], cart: { lines: merged, ...(key ? { key } : {}) }, cartExpires: String(now + CART_SECONDS),
      })) fail("CONTENTION");
    }
    const saved = await store.read(authorized.cartId);
    return {
      ok: true, capabilityId: authorized.capabilityId, checkout: attempt ? projectGuestCheckout(attempt, now) : projectPreparedGuestCheckout(),
      cart: { lines: cartLines(saved?.record, now), version: saved?.version ?? null, expiresAt: +(saved?.record.cartExpires ?? now + CART_SECONDS) },
    };
  } catch (error) {
    return guestSafeResult(error);
  }
}

export function admitGuestCheckoutStatusInput(raw: unknown): { attemptId?: string } {
  const input = raw === undefined ? {} : asObject(raw);
  const keys = sortedKeys(input);
  if (keys === "") return {};
  if (keys !== "wake" && keys !== "attemptId" && keys !== "attemptId,wake") fail("INVALID_CART");
  if (keys.includes("wake") && input.wake !== true) fail("INVALID_CART");
  if (!keys.includes("attemptId")) return {};
  if (typeof input.attemptId !== "string" || !input.attemptId.trim() ||
      input.attemptId.length > 256) fail("INVALID_CART");
  return { attemptId: input.attemptId.trim() };
}

function contactRequirements(
  runtime: GuestCheckoutRuntime,
): Promise<CheckoutContactRequirements> {
  if (!runtime.host.loadCheckoutContactRequirements) {
    return Promise.reject(new CheckoutContactError("REQUIREMENTS_UNAVAILABLE"));
  }
  return runtime.host.loadCheckoutContactRequirements().then((value) => {
    if (
      !isRecord(value) ||
      sortedKeys(value) !== "requirePhoneNumber,revision,shippingCountries" ||
      typeof value.requirePhoneNumber !== "boolean" ||
      !Array.isArray(value.shippingCountries) ||
      (value.revision !== null && typeof value.revision !== "string")
    ) {
      throw new CheckoutContactError("REQUIREMENTS_UNAVAILABLE");
    }
    return { requirePhoneNumber: value.requirePhoneNumber, shippingCountries: [...value.shippingCountries], revision: value.revision };
  }).catch((error) => {
    if (error instanceof CheckoutContactError) throw error;
    throw new CheckoutContactError("REQUIREMENTS_UNAVAILABLE");
  });
}

function mapCheckoutError(error: unknown): never {
  if (error instanceof GuestCheckoutError) throw error;
  if (error instanceof CheckoutContactError) {
    if (error.code === "REQUIREMENTS_UNAVAILABLE") fail("UNAVAILABLE");
    // Address problems say what to fix; other contact problems stay generic.
    if (/^(DELIVERY|BILLING)_/.test(error.code)) throw new GuestCheckoutError("INVALID_CART", error.message);
    fail("INVALID_CART");
  }
  if (error instanceof CouponUnavailableError) {
    const mapped = new GuestCheckoutError("COUPON_UNAVAILABLE");
    mapped.coupon = error.coupon;
    throw mapped;
  }
  const message = error instanceof Error ? error.message : "";
  if (/Invalid cart|Invalid quantity|Zero-total/i.test(message)) fail("INVALID_CART");
  if (/frozen/i.test(message)) fail("CHECKOUT_FROZEN");
  if (/Retry requires/i.test(message)) fail("RETRY_REQUIRED");
  if (/Retry checkout not found|Checkout not found/i.test(message)) fail("CHECKOUT_NOT_FOUND");
  if (/Product unavailable|Product unpriced/i.test(message)) fail("PRODUCT_UNAVAILABLE");
  if (/Inventory/i.test(message)) fail("INVENTORY_UNAVAILABLE");
  if (/Payment binding/i.test(message)) fail("PAYMENTS_UNAVAILABLE");
  if (/contention/i.test(message)) fail("CONTENTION");
  fail("UNAVAILABLE");
}

function paymentsReady(host: GuestCheckoutHostOptions): boolean {
  return Boolean(host.paymentBindingRef?.trim() && host.resolvePayments);
}

export function executionOf(runtime: GuestCheckoutRuntime) {
  if (!paymentsReady(runtime.host)) fail("PAYMENTS_UNAVAILABLE");
  return {
    store: createCheckoutStore(runtime.carts),
    catalog: runtime.catalog,
    availability: { resolveProvider: runtime.host.resolveAvailabilityProvider },
    resolveInventory: runtime.host.resolveInventory ?? (async () => null),
    paymentAssociations: runtime.paymentAssociations,
    paymentBindingRef: runtime.host.paymentBindingRef!.trim(),
    paymentMode: runtime.host.paymentMode,
    resolvePayments: runtime.host.resolvePayments!,
    createAttemptId: runtime.host.createAttemptId,
    now: runtime.host.now,
    loadCheckoutContactRequirements: runtime.host.loadCheckoutContactRequirements,
    pricing: runtime.pricing,
    paidOrders: runtime.paidOrders,
  };
}

/**
 * Trusted host-only wake seam. The caller supplies a Payments-owned list/ack
 * port; Commerce supplies its bound storage and canonical order writer.
 */
export async function reconcileGuestPaymentWakes(
  runtime: GuestCheckoutRuntime,
  wakes: CommercePaymentWakePort,
) {
  const resolved = resolveTrustedSiteOrigin({
    constructorSiteUrl: runtime.constructorSiteUrl ?? runtime.host.siteUrl,
    runtimeSiteUrl: runtime.runtimeSiteUrl ?? runtime.siteUrl,
    topLevelSiteUrl: runtime.topLevelSiteUrl ?? runtime.host.topLevelSiteUrl,
    checkoutSiteUrl: runtime.checkoutSiteUrl ?? runtime.host.checkoutSiteUrl,
  });
  if (!resolved.ok || runtime.siteUrl !== resolved.origin ||
      !runtime.paymentAssociations || !paymentsReady(runtime.host)) {
    fail("UNAVAILABLE");
  }
  return reconcilePaymentWakes(executionOf(runtime), runtime.paymentAssociations, wakes);
}

function nowSeconds(runtime: GuestCheckoutRuntime): number {
  return runtime.host.now?.() ?? Math.floor(Date.now() / 1000);
}

function currentAttempt(attempts: CheckoutAttempt[]): CheckoutAttempt | undefined {
  return attempts[attempts.length - 1];
}

function guestSafeError(error: GuestCheckoutError): GuestCheckoutResult {
  return { ok: false, error: { code: error.code, message: error.message, ...structuredClone(error.coupon) } };
}

function guestSafeResult(error: unknown): GuestCheckoutResult {
  if (error instanceof GuestCheckoutError) return guestSafeError(error);
  try {
    mapCheckoutError(error);
  } catch (mapped) {
    if (mapped instanceof GuestCheckoutError) return guestSafeError(mapped);
  }
  return guestCheckoutFailure("UNAVAILABLE");
}

export async function prepareGuestCheckout(
  runtime: GuestCheckoutRuntime,
  input?: unknown,
): Promise<GuestCheckoutResult> {
  try {
    admitGuestCheckoutPrepareInput(input);
    const requirements = await contactRequirements(runtime);
    const minted = await mintGuestCapability(runtime);
    return {
      ok: true,
      capabilityId: minted.record.capabilityId,
      capability: minted.presentation,
      contactRequirements: { requirePhoneNumber: requirements.requirePhoneNumber },
      checkout: projectPreparedGuestCheckout(),
    };
  } catch (error) {
    return guestSafeResult(error);
  }
}

function projected(capabilityId: string, attempt: CheckoutAttempt | undefined, now: number): GuestCheckoutResult {
  return { ok: true, capabilityId, checkout: projectGuestCheckout(attempt, now) };
}

export async function startGuestCheckout(
  runtime: GuestCheckoutRuntime,
  input: unknown,
  headers?: Headers | Record<string, string>,
): Promise<GuestCheckoutResult> {
  try {
    admitGuestCheckoutStartInput(input, Boolean(runtime.host.pricing));
    const authorized = await authorizeGuestCapability(
      runtime,
      readGuestCapabilityHeader(headers),
    );
    if (!paymentsReady(runtime.host)) fail("PAYMENTS_UNAVAILABLE");
    const store = createCheckoutStore(runtime.carts);
    const existing = await store.read(authorized.cartId);
    const previous = existing ? currentAttempt(existing.record.attempts) : undefined;
    const retryAfter =
      previous?.phase === "released" ? previous.attemptId : undefined;
    const currentNow = nowSeconds(runtime);
    // An open or paid attempt replays its own frozen lines; otherwise the live cart is bought.
    const lines = previous && !retryAfter ? previous.cart : cartLines(existing?.record, currentNow);
    if (!lines.length) fail("INVALID_CART");
    const attempt = await startCheckout(
      executionOf(runtime),
      authorized.cartId,
      { ...(input as Record<string, unknown>), lines },
      retryAfter,
      true,
    );
    return projected(authorized.capabilityId, attempt, currentNow);
  } catch (error) {
    return guestSafeResult(error);
  }
}

export async function statusGuestCheckout(
  runtime: GuestCheckoutRuntime,
  input: unknown,
  headers?: Headers | Record<string, string>,
): Promise<GuestCheckoutResult> {
  try {
    const admitted = admitGuestCheckoutStatusInput(input);
    const authorized = await authorizeGuestCapability(
      runtime,
      readGuestCapabilityHeader(headers),
    );
    const currentNow = nowSeconds(runtime);
    if (!paymentsReady(runtime.host)) {
      const stored = await createCheckoutStore(runtime.carts).read(authorized.cartId);
      return projected(authorized.capabilityId, currentAttempt(stored?.record.attempts ?? []), currentNow);
    }
    const stored = await createCheckoutStore(runtime.carts).read(authorized.cartId);
    // Validation can reject start before any attempt is saved. Observe that
    // absence without minting a new capability or creating a payment session.
    if (!stored?.record.attempts.length && admitted.attemptId === undefined) {
      return { ok: true, capabilityId: authorized.capabilityId, checkout: projectPreparedGuestCheckout() };
    }
    const current = currentAttempt(stored?.record.attempts ?? []);
    if (!current) fail("CHECKOUT_NOT_FOUND");
    const hinted = admitted.attemptId ?? "";
    if (hinted && !stored?.record.attempts.some((attempt) => attempt.attemptId === hinted)) {
      fail("CHECKOUT_NOT_FOUND");
    }
    const attempt = await reconcileCheckout(
      executionOf(runtime),
      authorized.cartId,
      hinted || current.attemptId,
    );
    return projected(authorized.capabilityId, attempt, currentNow);
  } catch (error) {
    return guestSafeResult(error);
  }
}

export function guestCheckoutFailure(
  code: GuestCheckoutError["code"],
): GuestCheckoutResult {
  return { ok: false, error: { code, message: guestCheckoutErrorMessage(code) } };
}
