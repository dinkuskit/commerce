import { GuestCheckoutError } from "./errors.js";
import type { RegistryCheckoutConfig } from "./registry-provider-admission.js";

function unavailable(): never { throw new GuestCheckoutError("UNAVAILABLE"); }
function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, limit = 200): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= limit && value.trim() === value;
}

function jwtPart(encoded: string): unknown {
  const binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, c => c.charCodeAt(0))));
}

/** Admits a pass for Payments, or with a scope and audience, for the coupon service. */
export function admitCredential(
  token: unknown,
  config: RegistryCheckoutConfig,
  scope = "payments:checkout",
  audience = config.audience,
): string {
  if (!text(token, 16384)) unavailable();
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) unavailable();
    const header = jwtPart(parts[0]), payload = jwtPart(parts[1]);
    if (!object(header) || !["RS256", "ES256"].includes(header.alg as string) || !object(payload) ||
        payload.iss !== config.issuer ||
        !(payload.aud === audience || Array.isArray(payload.aud) && payload.aud.includes(audience)) ||
        !text(payload.sub) || payload.site_id !== config.siteId || typeof payload.scope !== "string" ||
        !payload.scope.split(" ").includes(scope) ||
        !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)) unavailable();
    const now = Math.floor(Date.now() / 1000), issued = payload.iat as number, expires = payload.exp as number;
    if (issued < 0 || issued > now || expires <= now || expires <= issued || now - issued > 3600 ||
        payload.nbf !== undefined && (!Number.isSafeInteger(payload.nbf) || (payload.nbf as number) > now)) unavailable();
    return token;
  } catch { return unavailable(); }
}

