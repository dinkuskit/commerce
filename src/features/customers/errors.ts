import type { ShopperAccountErrorCode } from "./types.js";

// Each code's HTTP status and the message shoppers see.
const ERRORS: Record<ShopperAccountErrorCode, [number, string]> = {
  CODE_EXPIRED: [400, "Sign-in code has expired; request a new code"],
  CODE_INVALID: [400, "Sign-in code is invalid"],
  CONTENTION: [409, "Account update contention; retry"],
  DELIVERY_COUNTRY_UNAVAILABLE: [400, "The store does not ship to this country"],
  DELIVERY_INVALID: [400, "Delivery address is invalid"],
  EMAIL_INVALID: [400, "Email address is invalid"],
  EMAIL_REQUIRED: [400, "Email address is required"],
  EMAIL_UNAVAILABLE: [503, "Sign-in email delivery is unavailable"],
  INVALID_INPUT: [400, "Invalid account request"],
  ORIGIN_DENIED: [403, "Account request origin is missing or invalid"],
  PHONE_REQUIRED: [400, "Phone number is required"],
  RATE_LIMITED: [429, "Please wait before requesting another sign-in code"],
  SESSION_DENIED: [401, "Customer session is missing or invalid"],
  UNAVAILABLE: [503, "Customer accounts are unavailable"],
};

export class ShopperAccountError extends Error {
  readonly code: ShopperAccountErrorCode;
  readonly status: number;

  constructor(code: ShopperAccountErrorCode, message = ERRORS[code][1]) {
    super(message);
    this.name = "ShopperAccountError";
    this.code = code;
    this.status = ERRORS[code][0];
  }
}

export function shopperAccountErrorMessage(code: ShopperAccountErrorCode): string {
  return ERRORS[code][1];
}

export function shopperAccountFailure(code: ShopperAccountErrorCode): {
  ok: false;
  error: { code: ShopperAccountErrorCode; message: string };
} {
  return { ok: false, error: { code, message: shopperAccountErrorMessage(code) } };
}
