import type { ShopperAccountErrorCode } from "./types.js";

const STATUS_BY_CODE: Record<ShopperAccountErrorCode, number> = {
  CODE_EXPIRED: 400,
  CODE_INVALID: 400,
  CONTENTION: 409,
  DELIVERY_COUNTRY_UNAVAILABLE: 400,
  DELIVERY_INVALID: 400,
  EMAIL_INVALID: 400,
  EMAIL_REQUIRED: 400,
  EMAIL_UNAVAILABLE: 503,
  INVALID_INPUT: 400,
  ORIGIN_DENIED: 403,
  PHONE_REQUIRED: 400,
  RATE_LIMITED: 429,
  SESSION_DENIED: 401,
  UNAVAILABLE: 503,
};

const MESSAGE_BY_CODE: Record<ShopperAccountErrorCode, string> = {
  CODE_EXPIRED: "Sign-in code has expired; request a new code",
  CODE_INVALID: "Sign-in code is invalid",
  CONTENTION: "Account update contention; retry",
  DELIVERY_COUNTRY_UNAVAILABLE: "The store does not ship to this country",
  DELIVERY_INVALID: "Delivery address is invalid",
  EMAIL_INVALID: "Email address is invalid",
  EMAIL_REQUIRED: "Email address is required",
  EMAIL_UNAVAILABLE: "Sign-in email delivery is unavailable",
  INVALID_INPUT: "Invalid account request",
  ORIGIN_DENIED: "Account request origin is missing or invalid",
  PHONE_REQUIRED: "Phone number is required",
  RATE_LIMITED: "Please wait before requesting another sign-in code",
  SESSION_DENIED: "Customer session is missing or invalid",
  UNAVAILABLE: "Customer accounts are unavailable",
};

export class ShopperAccountError extends Error {
  readonly code: ShopperAccountErrorCode;
  readonly status: number;

  constructor(code: ShopperAccountErrorCode, message = MESSAGE_BY_CODE[code]) {
    super(message);
    this.name = "ShopperAccountError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}

export function shopperAccountErrorMessage(code: ShopperAccountErrorCode): string {
  return MESSAGE_BY_CODE[code];
}

export function shopperAccountFailure(code: ShopperAccountErrorCode): {
  ok: false;
  error: { code: ShopperAccountErrorCode; message: string };
} {
  return { ok: false, error: { code, message: shopperAccountErrorMessage(code) } };
}
