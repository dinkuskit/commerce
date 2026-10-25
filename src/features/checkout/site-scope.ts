const TRUSTED_SCHEMES = new Set(["http:", "https:"]);

export function presentSiteUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Canonical HTTP(S) origin. Rejects credentials, non-http(s) schemes,
 * empty/ambiguous hosts, and unparseable syntax. Path/query/hash are
 * discarded; default ports are normalized by `URL.origin``.
 */
export function canonicalizeHttpOrigin(value: string | undefined): string | null {
  const trimmed = presentSiteUrl(value);
  if (trimmed === undefined) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (!TRUSTED_SCHEMES.has(parsed.protocol)) return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  if (trimmed.includes("@")) return null;
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "." || hostname.includes(" ") || hostname.includes("\t")) {
    return null;
  }
  if (parsed.origin === "null") return null;
  return parsed.origin;
}

export interface ResolveTrustedSiteOriginInput {
  constructorSiteUrl?: string;
  runtimeSiteUrl?: string;
  topLevelSiteUrl?: string;
  checkoutSiteUrl?: string;
}

export function resolveTrustedSiteOrigin(
  input: ResolveTrustedSiteOriginInput,
): { ok: true; origin: string } | { ok: false } {
  let configuredOrigin: string | undefined;
  for (const candidate of [input.checkoutSiteUrl, input.topLevelSiteUrl, input.constructorSiteUrl]) {
    if (candidate === undefined) continue;
    const origin = canonicalizeHttpOrigin(candidate);
    if (origin === null || (configuredOrigin !== undefined && configuredOrigin !== origin)) {
      return { ok: false };
    }
    configuredOrigin = origin;
  }

  if (presentSiteUrl(input.runtimeSiteUrl) !== undefined) {
    const runtimeOrigin = canonicalizeHttpOrigin(input.runtimeSiteUrl);
    if (runtimeOrigin === null || (configuredOrigin !== undefined && configuredOrigin !== runtimeOrigin)) {
      return { ok: false };
    }
    return { ok: true, origin: runtimeOrigin };
  }

  return configuredOrigin !== undefined ? { ok: true, origin: configuredOrigin } : { ok: false };
}
