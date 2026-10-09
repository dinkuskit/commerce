export type ManagedSkuRegistrationErrorCode =
  | "INVALID_REGISTRATION"
  | "INVALID_TRANSITION"
  | "REGISTRATION_CLAIM_UNAVAILABLE";

export class ManagedSkuRegistrationError extends Error {
  readonly code: ManagedSkuRegistrationErrorCode;

  constructor(code: ManagedSkuRegistrationErrorCode, message: string) {
    super(message);
    this.name = "ManagedSkuRegistrationError";
    this.code = code;
  }
}
