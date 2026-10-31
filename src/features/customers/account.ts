import { isRecord, sortedKeys } from "../../shared/record.js";
import { randomSecret, sha256Hex, timingSafeEqual } from "../../shared/secret.js";
import {
  CheckoutContactError,
  normalizeCheckoutContactInput,
  normalizeCheckoutDelivery,
  type CheckoutDeliveryAddress,
} from "../checkout-contact/index.js";
import { admitSameOriginWrite, headerValue, resolveTrustedSiteOrigin } from "../checkout/kernel/index.js";
import { ShopperAccountError, shopperAccountFailure } from "./errors.js";
import {
  CUSTOMER_SESSION_HEADER,
  CUSTOMER_SESSION_TTL_SECONDS,
  LOGIN_CODE_COOLDOWN_SECONDS,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_TTL_SECONDS,
  type CustomerLoginCodeRecord,
  type CustomerRecord,
  type CustomerSessionPresentation,
  type CustomerSessionRecord,
  type ShopperAccountOrdersResult,
  type ShopperAccountProfileResult,
  type ShopperAccountRuntime,
  type ShopperProfileProjection,
  type ShopperSignInStartResult,
  type ShopperSignInVerifyResult,
  type ShopperSignOutResult,
} from "./types.js";

function fail(code: ShopperAccountError["code"]): never {
  throw new ShopperAccountError(code);
}

function nowSeconds(runtime: ShopperAccountRuntime): number {
  return runtime.host.now?.() ?? Math.floor(Date.now() / 1000);
}

/** Epoch seconds as an ISO timestamp. */
function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

export const hashCustomerSecret = sha256Hex;

function randomSixDigitCode(): string {
  const array = new Uint32Array(1);
  // Rejection-sample < 4_294_000_000 to avoid modulo bias on 1_000_000.
  for (;;) {
    crypto.getRandomValues(array);
    if (array[0]! < 4_294_000_000) {
      return String(array[0]! % 1_000_000).padStart(6, "0");
    }
  }
}

export function requireCustomerSiteOrigin(runtime: ShopperAccountRuntime): string {
  const resolved = resolveTrustedSiteOrigin({
    constructorSiteUrl: runtime.constructorSiteUrl ?? runtime.host.siteUrl,
    runtimeSiteUrl: runtime.runtimeSiteUrl,
    topLevelSiteUrl: runtime.topLevelSiteUrl ?? runtime.host.topLevelSiteUrl,
  });
  if (!resolved.ok) fail("UNAVAILABLE");
  return resolved.origin;
}

export function admitShopperAccountOrigin(input: {
  requestUrl: string;
  headers?: Headers | Record<string, string>;
  siteOrigin: string;
}): void {
  admitSameOriginWrite(input, () => fail("ORIGIN_DENIED"));
}

export function readCustomerSessionHeader(
  headers: Headers | Record<string, string> | undefined,
): string | undefined {
  return headerValue(headers, CUSTOMER_SESSION_HEADER);
}

export function normalizeCustomerEmail(raw: unknown): { email: string; emailKey: string } {
  try {
    const normalized = normalizeCheckoutContactInput({ email: raw });
    return { email: normalized.email, emailKey: normalized.email.toLowerCase() };
  } catch (error) {
    if (error instanceof CheckoutContactError) {
      if (error.code === "EMAIL_REQUIRED") fail("EMAIL_REQUIRED");
      if (error.code === "EMAIL_INVALID") fail("EMAIL_INVALID");
    }
    fail("INVALID_INPUT");
  }
}

function normalizeSixDigitCode(raw: unknown): string {
  if (typeof raw !== "string") fail("CODE_INVALID");
  const trimmed = raw.trim();
  if (!/^[0-9]{6}$/.test(trimmed)) fail("CODE_INVALID");
  return trimmed;
}

function parseSessionToken(token: string): { sessionId: string; secret: string } {
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) {
    fail("SESSION_DENIED");
  }
  return { sessionId: token.slice(0, separator), secret: token.slice(separator + 1) };
}

export async function authorizeCustomerSession(
  runtime: ShopperAccountRuntime,
  headers: Headers | Record<string, string> | undefined,
): Promise<CustomerSessionRecord> {
  const requestSite = requireCustomerSiteOrigin(runtime);
  const presented = readCustomerSessionHeader(headers);
  if (!presented) fail("SESSION_DENIED");
  const { sessionId, secret } = parseSessionToken(presented);
  const stored = await runtime.sessions.get(sessionId);
  const now = nowSeconds(runtime);
  if (
    !stored ||
    stored.recordKind !== "commerce-customer-session" ||
    stored.sessionId !== sessionId ||
    !stored.emailKey ||
    !stored.verifier ||
    stored.siteBinding !== requestSite ||
    !Number.isSafeInteger(stored.expiresAt) ||
    now >= stored.expiresAt
  ) {
    fail("SESSION_DENIED");
  }
  const expected = await hashCustomerSecret(`${sessionId}:${stored.emailKey}:${secret}`);
  if (!timingSafeEqual(stored.verifier, expected)) {
    fail("SESSION_DENIED");
  }
  return stored;
}

function projectProfile(record: CustomerRecord): ShopperProfileProjection {
  return {
    email: record.email,
    phone: record.phone ?? null,
    delivery: record.delivery ? structuredClone(record.delivery) : null,
  };
}

function isValidCustomerRecord(record: unknown, emailKey: string): record is CustomerRecord {
  if (!isRecord(record) || record.recordKind !== "commerce-customer") return false;
  if (record.emailKey !== emailKey || typeof record.email !== "string" || record.email.toLowerCase() !== emailKey) {
    return false;
  }
  if (typeof record.createdAt !== "string" || typeof record.updatedAt !== "string") return false;
  if (
    record.phone !== undefined &&
    record.phone !== null &&
    (typeof record.phone !== "string" || !record.phone.trim())
  ) {
    return false;
  }
  if (record.delivery !== undefined && record.delivery !== null) {
    try {
      normalizeCheckoutDelivery(record.delivery);
    } catch {
      return false;
    }
  }
  return true;
}

async function ensureCustomerProfile(
  runtime: ShopperAccountRuntime,
  emailKey: string,
  preferredEmail?: string,
  preloadedOrders?: Awaited<ReturnType<NonNullable<ShopperAccountRuntime["host"]["loadOrdersForEmail"]>>>,
): Promise<CustomerRecord> {
  const nowIso = iso(nowSeconds(runtime));
  const existing = await runtime.customers.getVersioned(emailKey);
  if (existing && !isValidCustomerRecord(existing.value, emailKey)) {
    fail("UNAVAILABLE");
  }
  const current = existing?.value;
  if (current && current.delivery !== undefined && current.phone !== undefined) {
    return current;
  }
  const orders = preloadedOrders ?? (await runtime.host.loadOrdersForEmail?.(emailKey)) ?? [];
  const latestWithDelivery = orders.find((order) => order.delivery !== null);
  const latestWithPhone = orders.find((order) => order.phone !== null);
  const seededDelivery =
    current?.delivery !== undefined
      ? current.delivery
      : latestWithDelivery?.delivery
        ? structuredClone(latestWithDelivery.delivery)
        : undefined;
  const seededPhone =
    current?.phone !== undefined ? current.phone : (latestWithPhone?.phone ?? undefined);
  const changed = !current || seededDelivery !== current.delivery || seededPhone !== current.phone;
  if (!changed) {
    return current;
  }
  const nextRecord: CustomerRecord = {
    recordKind: "commerce-customer",
    emailKey,
    email: current?.email ?? preferredEmail ?? emailKey,
    ...(seededPhone !== undefined ? { phone: seededPhone } : {}),
    ...(seededDelivery !== undefined ? { delivery: seededDelivery } : {}),
    createdAt: current?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
  const saved = await runtime.customers.compareAndSet(emailKey, existing?.revision ?? null, nextRecord);
  if (saved.applied) return nextRecord;
  const reread = await runtime.customers.get(emailKey);
  if (reread && isValidCustomerRecord(reread, emailKey)) return reread;
  fail("CONTENTION");
}

function safeResult<T>(
  error: unknown,
): T | { ok: false; error: { code: ShopperAccountError["code"]; message: string } } {
  if (error instanceof ShopperAccountError) {
    return shopperAccountFailure(error.code);
  }
  return shopperAccountFailure("UNAVAILABLE");
}

export async function startShopperSignIn(
  runtime: ShopperAccountRuntime,
  input: unknown,
): Promise<ShopperSignInStartResult> {
  try {
    requireCustomerSiteOrigin(runtime);
    if (!runtime.host.sendEmail) fail("EMAIL_UNAVAILABLE");
    if (!isRecord(input) || sortedKeys(input) !== "email") fail("INVALID_INPUT");
    const { email, emailKey } = normalizeCustomerEmail(input.email);
    const now = nowSeconds(runtime);
    const existing = await runtime.loginCodes.getVersioned(emailKey);
    if (existing) {
      const prior = existing.value;
      if (
        !isRecord(prior) ||
        prior.recordKind !== "commerce-customer-login-code" ||
        !Number.isSafeInteger(prior.issuedAt)
      ) {
        fail("UNAVAILABLE");
      }
      if (now - prior.issuedAt < LOGIN_CODE_COOLDOWN_SECONDS) {
        fail("RATE_LIMITED");
      }
    }
    const code = (runtime.host.createLoginCode ?? randomSixDigitCode)();
    if (!/^[0-9]{6}$/.test(code)) fail("UNAVAILABLE");
    const expiresAt = now + LOGIN_CODE_TTL_SECONDS;
    const record: CustomerLoginCodeRecord = {
      recordKind: "commerce-customer-login-code",
      emailKey,
      verifier: await hashCustomerSecret(`${emailKey}:${code}`),
      attempts: 0,
      issuedAt: now,
      expiresAt,
      consumed: false,
    };
    const cas = await runtime.loginCodes.compareAndSet(emailKey, existing?.revision ?? null, record);
    if (!cas.applied) fail("CONTENTION");
    const storeLabel = runtime.host.storeName?.trim() || "Store";
    try {
      await runtime.host.sendEmail({
        to: email,
        subject: `Your ${storeLabel} sign-in code: ${code}`,
        text: `Your ${storeLabel} verification code is ${code}. It expires in 10 minutes.`,
      });
    } catch {
      const rollback: CustomerLoginCodeRecord = existing
        ? existing.value
        : { ...record, issuedAt: 0, expiresAt: 0, consumed: true };
      await runtime.loginCodes.compareAndSet(emailKey, cas.revision, rollback).catch(() => {});
      fail("EMAIL_UNAVAILABLE");
    }
    return {
      ok: true,
      email,
      expiresAt: iso(expiresAt),
    };
  } catch (error) {
    return safeResult(error);
  }
}

export async function verifyShopperSignIn(
  runtime: ShopperAccountRuntime,
  input: unknown,
): Promise<ShopperSignInVerifyResult> {
  try {
    const siteBinding = requireCustomerSiteOrigin(runtime);
    if (!isRecord(input) || sortedKeys(input) !== "code,email") fail("INVALID_INPUT");
    const { email, emailKey } = normalizeCustomerEmail(input.email);
    const code = normalizeSixDigitCode(input.code);
    const now = nowSeconds(runtime);
    const stored = await runtime.loginCodes.getVersioned(emailKey);
    if (!stored || !isRecord(stored.value) || stored.value.recordKind !== "commerce-customer-login-code") {
      fail("CODE_INVALID");
    }
    const challenge = stored.value;
    if (challenge.consumed === true || challenge.attempts >= LOGIN_CODE_MAX_ATTEMPTS) {
      fail("CODE_INVALID");
    }
    if (now >= challenge.expiresAt) {
      fail("CODE_EXPIRED");
    }
    const expected = await hashCustomerSecret(`${emailKey}:${code}`);
    const matches = timingSafeEqual(challenge.verifier, expected);
    const claim = async () => {
      const claimed = await runtime.loginCodes.compareAndSet(emailKey, stored.revision, {
        ...challenge,
        attempts: challenge.attempts + 1,
        consumed: matches,
      });
      if (!claimed.applied) fail("CONTENTION");
      return claimed.revision;
    };
    if (!matches) {
      await claim();
      fail("CODE_INVALID");
    }
    const sessionId = (runtime.host.createSessionId ?? (() => crypto.randomUUID()))();
    const secret = (runtime.host.createSessionSecret ?? randomSecret)();
    if (!sessionId.trim() || !secret.trim()) fail("UNAVAILABLE");
    // Ensure the customer profile before consuming the OTP or writing a session row so a seeding failure leaves neither behind.
    const customer = await ensureCustomerProfile(runtime, emailKey, email);
    const claimedRevision = await claim();
    const expiresAt = now + CUSTOMER_SESSION_TTL_SECONDS;
    const sessionRecord: CustomerSessionRecord = {
      recordKind: "commerce-customer-session",
      sessionId,
      emailKey,
      verifier: await hashCustomerSecret(`${sessionId}:${emailKey}:${secret}`),
      siteBinding,
      createdAt: now,
      expiresAt,
    };
    try {
      if (!(await runtime.sessions.compareAndSet(sessionId, null, sessionRecord)).applied) {
        fail("CONTENTION");
      }
    } catch (error) {
      await runtime.loginCodes.compareAndSet(emailKey, claimedRevision, challenge).catch(() => {});
      throw error;
    }
    const capability: CustomerSessionPresentation = {
      sessionId,
      session: `${sessionId}.${secret}`,
      retention: "json-body",
      header: CUSTOMER_SESSION_HEADER,
      expiresAt: iso(expiresAt),
    };
    return {
      ok: true,
      capability,
      profile: projectProfile(customer),
    };
  } catch (error) {
    return safeResult(error);
  }
}

export async function signOutShopperSession(
  runtime: ShopperAccountRuntime,
  input: unknown,
  headers?: Headers | Record<string, string>,
): Promise<ShopperSignOutResult> {
  try {
    if (input !== undefined && (!isRecord(input) || Object.keys(input).length !== 0)) {
      fail("INVALID_INPUT");
    }
    const authorized = await authorizeCustomerSession(runtime, headers);
    await runtime.sessions.delete(authorized.sessionId);
    return { ok: true, signedOut: true };
  } catch (error) {
    return safeResult(error);
  }
}

export async function readShopperAccountOrders(
  runtime: ShopperAccountRuntime,
  headers?: Headers | Record<string, string>,
): Promise<ShopperAccountOrdersResult> {
  try {
    const authorized = await authorizeCustomerSession(runtime, headers);
    if (!runtime.host.loadOrdersForEmail) fail("UNAVAILABLE");
    const orders = await runtime.host.loadOrdersForEmail(authorized.emailKey);
    const customer = await ensureCustomerProfile(runtime, authorized.emailKey, undefined, orders);
    return {
      ok: true,
      profile: projectProfile(customer),
      orders,
    };
  } catch (error) {
    return safeResult(error);
  }
}

export async function readShopperAccountProfile(
  runtime: ShopperAccountRuntime,
  headers?: Headers | Record<string, string>,
): Promise<ShopperAccountProfileResult> {
  try {
    const authorized = await authorizeCustomerSession(runtime, headers);
    const customer = await ensureCustomerProfile(runtime, authorized.emailKey);
    return {
      ok: true,
      profile: projectProfile(customer),
    };
  } catch (error) {
    return safeResult(error);
  }
}

function normalizeProfilePatch(
  raw: unknown,
  requirements: { requirePhoneNumber: boolean; shippingCountries: readonly string[] } | undefined,
): { phone?: string | null; delivery?: CheckoutDeliveryAddress | null } {
  if (!isRecord(raw)) fail("INVALID_INPUT");
  const keys = Object.keys(raw);
  if (keys.length === 0 || keys.some((key) => key !== "phone" && key !== "delivery")) {
    fail("INVALID_INPUT");
  }
  const result: { phone?: string | null; delivery?: CheckoutDeliveryAddress | null } = {};
  if (Object.hasOwn(raw, "phone")) {
    if (raw.phone === null || raw.phone === "") {
      if (requirements?.requirePhoneNumber) fail("PHONE_REQUIRED");
      result.phone = null;
    } else {
      try {
        const contact = normalizeCheckoutContactInput({ email: "check@example.com", phone: raw.phone });
        if (!contact.phone) {
          if (requirements?.requirePhoneNumber) fail("PHONE_REQUIRED");
          result.phone = null;
        } else {
          result.phone = contact.phone;
        }
      } catch {
        fail("INVALID_INPUT");
      }
    }
  }
  if (Object.hasOwn(raw, "delivery")) {
    if (raw.delivery === null) {
      result.delivery = null;
    } else {
      let delivery: CheckoutDeliveryAddress;
      try {
        delivery = normalizeCheckoutDelivery(raw.delivery);
      } catch {
        fail("DELIVERY_INVALID");
      }
      if (requirements && !requirements.shippingCountries.includes(delivery.country)) {
        fail("DELIVERY_COUNTRY_UNAVAILABLE");
      }
      result.delivery = delivery;
    }
  }
  return result;
}

export async function updateShopperAccountProfile(
  runtime: ShopperAccountRuntime,
  input: unknown,
  headers?: Headers | Record<string, string>,
): Promise<ShopperAccountProfileResult> {
  try {
    const authorized = await authorizeCustomerSession(runtime, headers);
    const requirements = await runtime.host.loadShippingCountries?.();
    const patch = normalizeProfilePatch(input, requirements);
    const nowIso = iso(nowSeconds(runtime));
    await ensureCustomerProfile(runtime, authorized.emailKey);
    const freshVersion = await runtime.customers.getVersioned(authorized.emailKey);
    if (!freshVersion || !isValidCustomerRecord(freshVersion.value, authorized.emailKey)) {
      fail("UNAVAILABLE");
    }
    const base = freshVersion.value;
    const nextPhone = patch.phone === undefined ? base.phone : patch.phone;
    if (requirements?.requirePhoneNumber && !nextPhone) {
      fail("PHONE_REQUIRED");
    }
    const nextDelivery = patch.delivery === undefined ? base.delivery : patch.delivery;
    const nextRecord: CustomerRecord = {
      recordKind: "commerce-customer",
      emailKey: authorized.emailKey,
      email: base.email,
      ...(nextPhone !== undefined ? { phone: nextPhone } : {}),
      ...(nextDelivery !== undefined ? { delivery: nextDelivery } : {}),
      createdAt: base.createdAt,
      updatedAt: nowIso,
    };
    const saved = await runtime.customers.compareAndSet(
      authorized.emailKey,
      freshVersion?.revision ?? null,
      nextRecord,
    );
    if (!saved.applied) fail("CONTENTION");
    return {
      ok: true,
      profile: projectProfile(nextRecord),
    };
  } catch (error) {
    return safeResult(error);
  }
}
