export type CheckoutContactErrorCode =
  | "INVALID_INPUT"
  | "EMAIL_REQUIRED"
  | "EMAIL_INVALID"
  | "PHONE_REQUIRED"
  | "DELIVERY_REQUIRED"
  | "DELIVERY_INVALID"
  | "DELIVERY_COUNTRY_UNAVAILABLE"
  | "REQUIREMENTS_UNAVAILABLE";

const MESSAGE_BY_CODE: Record<CheckoutContactErrorCode, string> = {
  INVALID_INPUT: "Checkout contact is invalid",
  EMAIL_REQUIRED: "Checkout email is required",
  EMAIL_INVALID: "Checkout email is invalid",
  PHONE_REQUIRED: "Checkout phone number is required",
  DELIVERY_REQUIRED: "Delivery address is required",
  DELIVERY_INVALID: "Delivery address is invalid",
  DELIVERY_COUNTRY_UNAVAILABLE: "The store does not ship to this country",
  REQUIREMENTS_UNAVAILABLE: "Checkout contact requirements are unavailable",
};

export class CheckoutContactError extends Error {
  readonly code: CheckoutContactErrorCode;

  constructor(code: CheckoutContactErrorCode) {
    super(MESSAGE_BY_CODE[code]);
    this.name = "CheckoutContactError";
    this.code = code;
  }
}

export function checkoutContactErrorMessage(code: CheckoutContactErrorCode): string {
  return MESSAGE_BY_CODE[code];
}
