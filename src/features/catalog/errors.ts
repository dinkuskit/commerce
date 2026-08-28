export type CatalogErrorCode =
  | "COMMAND_CONFLICT"
  | "INVALID_INPUT"
  | "SKU_CONFLICT"
  | "STORAGE_CONSTRAINTS_UNAVAILABLE"
  | "STORAGE_UNAVAILABLE";

const STATUS_BY_CODE: Record<CatalogErrorCode, number> = {
  COMMAND_CONFLICT: 409,
  INVALID_INPUT: 400,
  SKU_CONFLICT: 409,
  STORAGE_CONSTRAINTS_UNAVAILABLE: 503,
  STORAGE_UNAVAILABLE: 503,
};

export class CatalogError extends Error {
  readonly code: CatalogErrorCode;
  readonly status: number;

  constructor(code: CatalogErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CatalogError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}
