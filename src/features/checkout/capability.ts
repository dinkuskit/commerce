import { GuestCheckoutError } from "./errors.js";
import { randomSecret, sha256Hex, timingSafeEqual } from "../../shared/secret.js";
import { headerValue } from "./origin-admission.js";
import { canonicalizeHttpOrigin, resolveTrustedSiteOrigin } from "./site-scope.js";
import {
  GUEST_CAPABILITY_HEADER,
  type GuestCapabilityPresentation,
  type GuestCapabilityRecord,
  type GuestCheckoutRuntime,
} from "./types.js";

export const hashGuestCapabilitySecret = sha256Hex;

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

export function requireTrustedSiteOrigin(runtime: GuestCheckoutRuntime): string {
  const resolved = resolveTrustedSiteOrigin({
    constructorSiteUrl: knownSiteSource(runtime.constructorSiteUrl, runtime.host.siteUrl),
    runtimeSiteUrl: runtime.runtimeSiteUrl,
    topLevelSiteUrl: knownSiteSource(runtime.topLevelSiteUrl, runtime.host.topLevelSiteUrl),
    checkoutSiteUrl: knownSiteSource(runtime.checkoutSiteUrl, runtime.host.checkoutSiteUrl),
  });
  if (!resolved.ok) throw new GuestCheckoutError("UNAVAILABLE");
  return resolved.origin;
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
): Promise<{ record: GuestCapabilityRecord; presentation: GuestCapabilityPresentation }> {
  const siteBinding = requireTrustedSiteOrigin(runtime);
  const capabilityId = (runtime.host.createCapabilityId ?? (() => crypto.randomUUID()))();
  const cartId = (runtime.host.createCartId ?? (() => crypto.randomUUID()))();
  const secret = (runtime.host.createCapabilitySecret ?? randomSecret)();
  if (!capabilityId.trim() || !cartId.trim() || !secret.trim()) {
    throw new GuestCheckoutError("UNAVAILABLE");
  }
  const record: GuestCapabilityRecord = {
    recordKind: "guest-checkout-capability",
    capabilityId,
    cartId,
    verifier: await hashGuestCapabilitySecret(secret),
    siteBinding,
    createdAt: new Date((runtime.host.now ?? (() => Date.now() / 1000))() * 1000).toISOString(),
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
  if (
    !stored ||
    stored.recordKind !== "guest-checkout-capability" ||
    stored.capabilityId !== capabilityId ||
    !stored.cartId ||
    !stored.verifier ||
    !stored.siteBinding
  ) {
    throw new GuestCheckoutError("CAPABILITY_DENIED");
  }
  if (stored.siteBinding !== requestSite) {
    throw new GuestCheckoutError("CAPABILITY_DENIED");
  }
  if (!timingSafeEqual(stored.verifier, await hashGuestCapabilitySecret(secret))) {
    throw new GuestCheckoutError("CAPABILITY_DENIED");
  }
  return stored;
}
