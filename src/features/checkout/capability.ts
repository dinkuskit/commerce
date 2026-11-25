import { GuestCheckoutError } from "./errors.js";
import { randomSecret, sha256Hex, timingSafeEqual } from "../../shared/secret.js";
import { headerValue } from "./origin-admission.js";
import { canonicalizeHttpOrigin, resolveTrustedSiteOrigin } from "./site-scope.js";
import {
  GUEST_CAPABILITY_HEADER,
  type GuestCapabilityPresentation,
  type GuestCapabilityRecord,
  type GuestCheckoutRuntime,
  type CheckoutRecord,
} from "./types.js";

export const hashGuestCapabilitySecret = sha256Hex;
/** A cart, and a key with no cart yet, lasts 30 days. */
export const CART_SECONDS = 30 * 86_400;

function knownOriginsAgree(left: string, right: string): boolean {
  const leftOrigin = canonicalizeHttpOrigin(left);
  return leftOrigin !== null && leftOrigin === canonicalizeHttpOrigin(right);
}

function knownSiteSource(retained: string | undefined, hosted: string | undefined): string | undefined {
  if (retained !== undefined && hosted !== undefined && !knownOriginsAgree(retained, hosted)) {
    throw new GuestCheckoutError("UNAVAILABLE");
  }
  return retained !== undefined ? retained : hosted;
}

/** The store's own web address from the sources given, or checkout is unavailable. */
export function trustedOrigin(sources: Parameters<typeof resolveTrustedSiteOrigin>[0]): string {
  const resolved = resolveTrustedSiteOrigin(sources);
  if (!resolved.ok) throw new GuestCheckoutError("UNAVAILABLE");
  return resolved.origin;
}

export function requireTrustedSiteOrigin(runtime: GuestCheckoutRuntime): string {
  return trustedOrigin({
    constructorSiteUrl: knownSiteSource(runtime.constructorSiteUrl, runtime.host.siteUrl),
    runtimeSiteUrl: runtime.runtimeSiteUrl,
    topLevelSiteUrl: knownSiteSource(runtime.topLevelSiteUrl, runtime.host.topLevelSiteUrl),
    checkoutSiteUrl: knownSiteSource(runtime.checkoutSiteUrl, runtime.host.checkoutSiteUrl),
  });
}

export function hostSiteBinding(siteUrl: string | undefined): string {
  return canonicalizeHttpOrigin(siteUrl) ?? "";
}

export function readGuestCapabilityHeader(
  headers: Headers | Record<string, string> | undefined,
): string | undefined {
  return headerValue(headers, GUEST_CAPABILITY_HEADER);
}

function parsePresentedCapability(token: string): { capabilityId: string; secret: string } {
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) {
    throw new GuestCheckoutError("CAPABILITY_DENIED");
  }
  return { capabilityId: token.slice(0, separator), secret: token.slice(separator + 1) };
}

export async function mintGuestCapability(
  runtime: GuestCheckoutRuntime,
  email?: Pick<GuestCapabilityRecord, "emailHash" | "emailAttempt">,
): Promise<{ record: GuestCapabilityRecord; presentation: GuestCapabilityPresentation }> {
  const siteBinding = requireTrustedSiteOrigin(runtime);
  const capabilityId = (runtime.host.createCapabilityId ?? (() => crypto.randomUUID()))();
  const cartId = (runtime.host.createCartId ?? (() => crypto.randomUUID()))();
  const secret = (runtime.host.createCapabilitySecret ?? randomSecret)();
  const now = Math.floor((runtime.host.now ?? (() => Date.now() / 1000))());
  if (!capabilityId.trim() || !cartId.trim() || !secret.trim()) {
    throw new GuestCheckoutError("UNAVAILABLE");
  }
  const record: GuestCapabilityRecord = {
    recordKind: "guest-checkout-capability",
    capabilityId,
    cartId,
    verifier: await hashGuestCapabilitySecret(secret),
    siteBinding,
    createdAt: new Date(now * 1000).toISOString(),
    // A key lives as long as its cart; until the cart is made, 30 days. The background check deletes it after.
    expiresAt: String(now + CART_SECONDS),
    ...email,
  };
  if (!(await runtime.capabilities.compareAndSet(capabilityId, null, record)).applied) {
    throw new GuestCheckoutError("CONTENTION");
  }
  return {
    record,
    presentation: {
      capabilityId,
      capability: `${capabilityId}.${secret}`,
      retention: "json-body",
      header: GUEST_CAPABILITY_HEADER,
    },
  };
}

export async function authorizeGuestCapability(
  runtime: GuestCheckoutRuntime,
  presented: string | undefined,
): Promise<GuestCapabilityRecord> {
  const requestSite = requireTrustedSiteOrigin(runtime);
  if (!presented) throw new GuestCheckoutError("CAPABILITY_DENIED");
  const { capabilityId, secret } = parsePresentedCapability(presented);
  const stored = await runtime.capabilities.get(capabilityId);
  // The request's own site is never empty, so a record with no site binding fails the match.
  if (
    !stored ||
    stored.recordKind !== "guest-checkout-capability" ||
    stored.capabilityId !== capabilityId ||
    !stored.cartId ||
    !stored.verifier ||
    stored.siteBinding !== requestSite ||
    !timingSafeEqual(stored.verifier, await hashGuestCapabilitySecret(secret))
  ) {
    throw new GuestCheckoutError("CAPABILITY_DENIED");
  }
  return stored;
}

/**
 * A cart key lasts only while its cart lives (commerce-cart-key-expiry-20261125): never past the cart's 30 days.
 * Where the record has no cart (none made yet, or one the background check cleared, whose retry date is for
 * reconciling payments and never renews the key), the key's own 30 days from minting apply; a key minted before
 * keys had a date counts them from when it was made. The cart email's key also needs the cart and
 * the emailed checkout, so a cart made again under the same id never revives it. Checked against the very record an
 * operation reads, answers from and conditionally writes.
 */
export function fenceCartKey(capability: GuestCapabilityRecord, record: CheckoutRecord | undefined, now: number): void {
  if (!(now < +(record?.cart ? record.cartExpires! : capability.expiresAt ?? Date.parse(capability.createdAt) / 1e3 + CART_SECONDS)) ||
    capability.emailHash && !(record?.cart &&
    record.attempts.some(attempt => attempt.attemptId === capability.emailAttempt))) {
    throw new GuestCheckoutError("CAPABILITY_DENIED");
  }
}
