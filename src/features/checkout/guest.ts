import { GuestCheckoutError, guestCheckoutErrorMessage } from "./errors.js";
import { startCheckout, reconcileCheckout, CheckoutError } from "./orchestrate.js";
import { authorizeGuestCapability, mintGuestCapability, readGuestCapabilityHeader } from "./capability.js";
import { projectGuestCheckout } from "./project.js";
import { createCheckoutStore } from "./storage.js";
import type {
  CartLine,
  CheckoutAttempt,
  GuestCheckoutHostOptions,
  GuestCheckoutResult,
  GuestCheckoutRuntime,
} from "./types.js";

function fail(code: GuestCheckoutError["code"]): never {
  throw new GuestCheckoutError(code);
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_CART");
  return value as Record<string, unknown>;
}

export function admitGuestCheckoutStartInput(raw: unknown): CartLine[] {
  const input = asObject(raw);
  if (Object.keys(input).join() !== "lines") fail("INVALID_CART");
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 100) {
    fail("INVALID_CART");
  }
  return input.lines.map((line) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) fail("INVALID_CART");
    const keys = Object.keys(line).sort().join();
    if (keys !== "catalogItemId,quantity") fail("INVALID_CART");
    const catalogItemId = (line as { catalogItemId: unknown }).catalogItemId;
    const quantity = (line as { quantity: unknown }).quantity;
    if (typeof catalogItemId !== "string" || !catalogItemId.trim()) fail("INVALID_CART");
    if (!Number.isSafeInteger(quantity) || (quantity as number) <= 0) fail("INVALID_CART");
    return { catalogItemId: catalogItemId.trim(), quantity: quantity as number };
  });
}

function mapCheckoutError(error: unknown): never {
  if (error instanceof GuestCheckoutError) throw error;
  const message = error instanceof Error ? error.message : "";
  if (/Invalid cart|Invalid quantity|Zero-total/i.test(message)) fail("INVALID_CART");
  if (/frozen/i.test(message)) fail("CHECKOUT_FROZEN");
  if (/Retry requires/i.test(message)) fail("RETRY_REQUIRED");
  if (/Retry checkout not found|Checkout not found/i.test(message)) fail("CHECKOUT_NOT_FOUND");
  if (/Product unavailable|Product unpriced/i.test(message)) fail("PRODUCT_UNAVAILABLE");
  if (/Inventory/i.test(message)) fail("INVENTORY_UNAVAILABLE");
  if (/Payment binding/i.test(message)) fail("PAYMENTS_UNAVAILABLE");
  if (/contention/i.test(message)) fail("CONTENTION");
  if (error instanceof CheckoutError) fail("UNAVAILABLE");
  throw error;
}

function paymentsReady(host: GuestCheckoutHostOptions): boolean {
  return Boolean(host.paymentBindingRef?.trim() && host.resolvePayments);
}

function executionOf(runtime: GuestCheckoutRuntime) {
  if (!paymentsReady(runtime.host)) fail("PAYMENTS_UNAVAILABLE");
  return {
    store: createCheckoutStore(runtime.carts),
    catalog: runtime.catalog,
    availability: { resolveProvider: runtime.host.resolveAvailabilityProvider },
    resolveInventory: runtime.host.resolveInventory ?? (async () => null),
    paymentBindingRef: runtime.host.paymentBindingRef!.trim(),
    resolvePayments: runtime.host.resolvePayments!,
    createAttemptId: runtime.host.createAttemptId,
    now: runtime.host.now,
  };
}

function currentAttempt(attempts: CheckoutAttempt[]): CheckoutAttempt | undefined {
  return attempts[attempts.length - 1];
}

export async function startGuestCheckout(
  runtime: GuestCheckoutRuntime,
  input: unknown,
  headers?: Headers | Record<string, string>,
): Promise<GuestCheckoutResult> {
  try {
    const lines = admitGuestCheckoutStartInput(input);
    if (!paymentsReady(runtime.host)) fail("PAYMENTS_UNAVAILABLE");
    const presented = readGuestCapabilityHeader(headers);
    const minted = presented
      ? undefined
      : await mintGuestCapability(runtime);
    const authorized = presented
      ? await authorizeGuestCapability(runtime, presented)
      : minted!.record;
    const store = createCheckoutStore(runtime.carts);
    const existing = await store.read(authorized.cartId);
    const previous = existing ? currentAttempt(existing.record.attempts) : undefined;
    const retryAfter =
      previous?.phase === "released" ? previous.attemptId : undefined;
    const attempt = await startCheckout(executionOf(runtime), authorized.cartId, lines, retryAfter);
    return {
      ok: true,
      capabilityId: authorized.capabilityId,
      ...(minted ? { capability: minted.presentation } : {}),
      checkout: projectGuestCheckout(attempt),
    };
  } catch (error) {
    if (error instanceof GuestCheckoutError) {
      return { ok: false, error: { code: error.code, message: error.message } };
    }
    try {
      mapCheckoutError(error);
    } catch (mapped) {
      if (mapped instanceof GuestCheckoutError) {
        return { ok: false, error: { code: mapped.code, message: mapped.message } };
      }
      throw mapped;
    }
    throw error;
  }
}

export async function statusGuestCheckout(
  runtime: GuestCheckoutRuntime,
  input: unknown,
  headers?: Headers | Record<string, string>,
): Promise<GuestCheckoutResult> {
  try {
    const authorized = await authorizeGuestCapability(
      runtime,
      readGuestCapabilityHeader(headers),
    );
    if (!paymentsReady(runtime.host)) {
      const stored = await createCheckoutStore(runtime.carts).read(authorized.cartId);
      return {
        ok: true,
        capabilityId: authorized.capabilityId,
        checkout: projectGuestCheckout(currentAttempt(stored?.record.attempts ?? [])),
      };
    }
    const body = input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
    const stored = await createCheckoutStore(runtime.carts).read(authorized.cartId);
    const current = currentAttempt(stored?.record.attempts ?? []);
    if (!current) fail("CHECKOUT_NOT_FOUND");
    const hinted = typeof body.attemptId === "string" ? body.attemptId.trim() : "";
    if (hinted && !stored?.record.attempts.some((attempt) => attempt.attemptId === hinted)) {
      fail("CHECKOUT_NOT_FOUND");
    }
    const attempt = await reconcileCheckout(
      executionOf(runtime),
      authorized.cartId,
      hinted || current.attemptId,
    );
    return {
      ok: true,
      capabilityId: authorized.capabilityId,
      checkout: projectGuestCheckout(attempt),
    };
  } catch (error) {
    if (error instanceof GuestCheckoutError) {
      return { ok: false, error: { code: error.code, message: error.message } };
    }
    try {
      mapCheckoutError(error);
    } catch (mapped) {
      if (mapped instanceof GuestCheckoutError) {
        return { ok: false, error: { code: mapped.code, message: mapped.message } };
      }
      throw mapped;
    }
    throw error;
  }
}

export function guestCheckoutFailure(
  code: GuestCheckoutError["code"],
): GuestCheckoutResult {
  return { ok: false, error: { code, message: guestCheckoutErrorMessage(code) } };
}
