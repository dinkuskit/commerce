export type StorePoliciesErrorCode = "INVALID_INPUT" | "STORAGE_UNAVAILABLE";

export class StorePoliciesError extends Error {
  readonly code: StorePoliciesErrorCode;
  readonly status: number;

  constructor(code: StorePoliciesErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorePoliciesError";
    this.code = code;
    this.status = code === "INVALID_INPUT" ? 400 : 503;
  }
}
