export type FixedBundleErrorCode =
  | "CATALOG_ITEM_NOT_FOUND"
  | "CATALOG_RECORD_MISMATCH"
  | "INVALID_DEFINITION"
  | "INVALID_QUANTITY"
  | "QUANTITY_OVERFLOW"
  | "STORAGE_UNAVAILABLE";

const STATUS_BY_CODE: Record<FixedBundleErrorCode, number> = {
  CATALOG_ITEM_NOT_FOUND: 404,
  CATALOG_RECORD_MISMATCH: 409,
  INVALID_DEFINITION: 400,
  INVALID_QUANTITY: 400,
  QUANTITY_OVERFLOW: 400,
  STORAGE_UNAVAILABLE: 503,
};

export class FixedBundleError extends Error {
  readonly code: FixedBundleErrorCode;
  readonly status: number;

  constructor(code: FixedBundleErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FixedBundleError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}
