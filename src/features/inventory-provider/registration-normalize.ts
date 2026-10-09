import { ManagedSkuRegistrationError } from "./registration-errors.js";
import type {
  ManagedSkuRegistration,
  ManagedSkuRegistrationRejection,
} from "./types.js";

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManagedSkuRegistrationError(
      "INVALID_REGISTRATION",
      `${field} must be an object`,
    );
  }
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ManagedSkuRegistrationError(
      "INVALID_REGISTRATION",
      `${field} must be a non-empty string`,
    );
  }
  return value.trim();
}

export function normalizeManagedSkuRegistration(
  value: unknown,
): ManagedSkuRegistration {
  const candidate = asRecord(value, "managed SKU registration");
  const request = asRecord(
    candidate.request,
    "managed SKU registration request",
  );

  return {
    operationId: asNonEmptyString(candidate.operationId, "operationId"),
    request: {
      poolId: asNonEmptyString(request.poolId, "request.poolId"),
      sku: asNonEmptyString(request.sku, "request.sku"),
      displayNameIfNew: asNonEmptyString(
        request.displayNameIfNew,
        "request.displayNameIfNew",
      ),
    },
  };
}

export function normalizeManagedSkuRegistrationRejection(
  value: unknown,
): ManagedSkuRegistrationRejection {
  const candidate = asRecord(value, "managed SKU registration rejection");
  return {
    code: asNonEmptyString(candidate.code, "rejection.code"),
    message: asNonEmptyString(candidate.message, "rejection.message"),
  };
}
