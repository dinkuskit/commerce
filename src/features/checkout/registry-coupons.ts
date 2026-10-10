import { resolveCatalogItemPrice } from "../catalog/kernel/index.js";
import {
  CouponRedemptionError,
  type CheckoutCouponPort,
  type CouponAttempt,
  type CouponQuote,
  type CouponRedemptionErrorCode,
} from "../coupons/index.js";
import { readBoundedPaymentsJson } from "./test-payments.js";

export interface HostedCouponServiceConfig {
  /** The coupon service origin, such as https://coupons.dinkuskit.com. */
  origin: string;
  siteId: string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** A current coupons:checkout pass for this site. */
  credential: () => Promise<string>;
}

/** Answers that end an attempt's hold for good; checkout releases on them, as it does in process. */
const FINAL: readonly string[] = ["CAPACITY_EXHAUSTED", "INVALID_INPUT", "CONFLICTING_ATTEMPT", "TERMINAL_CONFLICT"];

class CouponServiceError extends Error {
  constructor(readonly code: string, readonly notApplicable?: Record<string, unknown>) {
    super(`Coupon service answered ${code || "without a code"}`);
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Checkout's coupon port over the hosted coupon service (dinkuskit/coupons
 * HTTP contract v1). Commerce still prices the cart: it sends each line's
 * catalog price, and the service evaluates the coupon and holds or settles
 * its capped uses with its own clock.
 */
export function createHostedCouponPort(config: HostedCouponServiceConfig): CheckoutCouponPort {
  const base = `${new URL(config.origin).origin}/v1/stores/${encodeURIComponent(config.siteId)}`;

  async function call(path: string, body: unknown): Promise<Record<string, unknown>> {
    const response = await config.fetch(base + path, {
      method: "POST", cache: "no-store", redirect: "error",
      headers: { accept: "application/json", authorization: `Bearer ${await config.credential()}`,
        "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    let value: unknown;
    try { value = await readBoundedPaymentsJson(response); } catch { /* reported below */ }
    if (response.ok && object(value)) return value;
    const error = object(value) && object(value.error) ? value.error : {};
    // NOT_APPLICABLE may say why; checkout checks the reason and minimum it uses.
    throw new CouponServiceError(response.ok || typeof error.code !== "string" ? "" : error.code,
      { reason: error.reason, minimum: error.minimum });
  }

  async function attempt(path: string, body: unknown, unissued?: CouponAttempt): Promise<CouponAttempt> {
    try {
      const result = await call(path, body);
      if (!object(result.attempt)) throw new Error("Malformed coupon service response");
      return result.attempt as unknown as CouponAttempt;
    } catch (error) {
      if (!(error instanceof CouponServiceError)) throw error;
      // The service keeps an issued quote for 24 hours. Past that, no hold
      // exists for a new attempt and none can be taken.
      if (error.code === "QUOTE_NOT_ISSUED" && unissued) return unissued;
      const code = error.code === "QUOTE_NOT_ISSUED" ? "CONFLICTING_ATTEMPT" : error.code;
      if (FINAL.includes(code)) throw new CouponRedemptionError(code as CouponRedemptionErrorCode, error.message);
      throw error;
    }
  }

  // Checkout freezes the quote with its overall total added; the service
  // accepts only the quote exactly as it issued it.
  function issued(quote: CouponQuote): CouponQuote {
    const { overallPayableTotal: _total, ...rest } = quote as CouponQuote & { overallPayableTotal?: unknown };
    return rest;
  }

  const path = (attemptId: string, action: string) => `/redemptions/${encodeURIComponent(attemptId)}/${action}`;

  return {
    async quote(code, storage, input) {
      const lines = [];
      for (const { productId, quantity } of input.lines) {
        const price = await resolveCatalogItemPrice(storage.prices, productId);
        if (!price.listable) throw new Error("Product unpriced");
        lines.push({ productId, quantity, regular: price.regular, ...(price.sale ? { sale: price.sale } : {}) });
      }
      let result;
      try {
        result = await call("/quotes", { quoteId: input.quoteId, code, lines });
      } catch (error) {
        if (error instanceof CouponServiceError && error.code === "NOT_FOUND") return null;
        throw error;
      }
      const quote = result.quote;
      if (typeof result.couponId !== "string" || !object(quote) || quote.couponId !== result.couponId ||
          quote.quoteId !== input.quoteId) throw new Error("Malformed coupon service response");
      return { couponId: result.couponId, quote: quote as unknown as CouponQuote };
    },
    owner: () => ({
      reserve: ({ couponId, attemptId, quote, overallPayableTotal }) =>
        attempt("/redemptions", { couponId, attemptId, quote: issued(quote), overallPayableTotal }),
      releaseUnstarted: ({ couponId, attemptId, quote, overallPayableTotal }) =>
        attempt(path(attemptId, "release-unstarted"), { couponId, quote: issued(quote), overallPayableTotal }, {
          attemptId, couponId, ruleId: quote.ruleId, ruleVersion: quote.ruleVersion, quoteId: quote.quoteId,
          quote: { ...quote, overallPayableTotal }, state: "released",
        } as CouponAttempt),
      attachProviderSession: (couponId, attemptId, providerSessionId) =>
        attempt(path(attemptId, "provider-session"), { couponId, providerSessionId }),
      reconcile: (couponId, attemptId, reconciliation) =>
        attempt(path(attemptId, "reconcile"), { couponId, reconciliation }),
      reconcileFreeOrder: ({ couponId, attemptId, proof }) =>
        attempt(path(attemptId, "free-order"), { couponId, proof }),
    }),
  };
}
