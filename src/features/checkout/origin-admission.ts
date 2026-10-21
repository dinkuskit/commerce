import { GuestCheckoutError } from "./errors.js";
import { canonicalizeHttpOrigin } from "./site-scope.js";
import {
  GUEST_ORIGIN_HEADER,
  GUEST_SEC_FETCH_SITE_HEADER,
} from "./types.js";

export function headerValue(
  headers: Headers | Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const want = name.toLowerCase();
  if (typeof (headers as Headers).get === "function") {
    const value = (headers as Headers).get(name) ?? (headers as Headers).get(want);
    return value?.trim() || undefined;
  }
  for (const [key, value] of Object.entries(headers as Record<string, string>)) {
    if (key.toLowerCase() === want && typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * Portable same-origin write admission for public guest routes.
 * Trusted site origin is already resolved from host constructor/runtime
 * config — never from Host, query, or body. request.url origin must
 * cohere with that site. Browsers send Origin and/or Sec-Fetch-Site.
 * Trusted same-origin server wrappers must send Origin matching the
 * site origin. Missing both Origin and Sec-Fetch-Site:same-origin fails
 * closed.
 */
export function admitGuestCheckoutWrite(input: {
  requestUrl: string;
  headers?: Headers | Record<string, string>;
  siteOrigin: string;
}): void {
  admitSameOriginWrite(input, () => { throw new GuestCheckoutError("ORIGIN_DENIED"); });
}

/** The same-origin write check above, failing through the caller's own error. */
export function admitSameOriginWrite(input: {
  requestUrl: string;
  headers?: Headers | Record<string, string>;
  siteOrigin: string;
}, deny: () => never): void {
  const requestOrigin = canonicalizeHttpOrigin(input.requestUrl);
  if (requestOrigin === null || requestOrigin !== input.siteOrigin) {
    deny();
  }
  const originHeader = headerValue(input.headers, GUEST_ORIGIN_HEADER);
  const fetchSite = headerValue(input.headers, GUEST_SEC_FETCH_SITE_HEADER)?.toLowerCase();
  if (originHeader !== undefined) {
    const presented = canonicalizeHttpOrigin(originHeader);
    if (presented === null || presented !== input.siteOrigin) {
      deny();
    }
    if (fetchSite !== undefined && fetchSite !== "same-origin") {
      deny();
    }
    return;
  }
  if (fetchSite === "same-origin") return;
  deny();
}
