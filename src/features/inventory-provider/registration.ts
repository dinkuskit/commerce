import { normalizeInventoryProviderBinding } from "./binding.js";
import { ManagedSkuRegistrationError } from "./errors.js";
import type {
  InventoryProviderBinding,
  InventorySkuIdentity,
  ManagedSkuRegistrationInput,
  ManagedSkuRegistrationRequest,
  ManagedSkuRegistrationResult,
  ManagedStockManagement,
  StockManagement,
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

function normalizeInventorySkuIdentity(value: unknown): InventorySkuIdentity {
  const candidate = asRecord(value, "inventorySku");
  return {
    inventorySkuId: asNonEmptyString(candidate.inventorySkuId, "inventorySku.inventorySkuId"),
    sku: asNonEmptyString(candidate.sku, "inventorySku.sku"),
    displayName: asNonEmptyString(candidate.displayName, "inventorySku.displayName"),
  };
}

export function createManagedSkuRegistrationRequest(
  binding: InventoryProviderBinding,
  input: ManagedSkuRegistrationInput,
): ManagedSkuRegistrationRequest {
  const normalizedBinding = normalizeInventoryProviderBinding(binding);
  const candidate = asRecord(input, "managed SKU registration input") as Partial<
    ManagedSkuRegistrationInput
  >;
  const sku = asNonEmptyString(candidate.sku, "sku");

  if (
    candidate.productTitle !== undefined &&
    candidate.productTitle !== null &&
    typeof candidate.productTitle !== "string"
  ) {
    throw new ManagedSkuRegistrationError(
      "INVALID_REGISTRATION",
      "productTitle must be a string, null, or omitted",
    );
  }

  const productTitle = candidate.productTitle?.trim();
  return {
    poolId: normalizedBinding.poolId,
    sku,
    displayNameIfNew: productTitle || sku,
  };
}

export function normalizeManagedSkuRegistrationResult(
  value: unknown,
): ManagedSkuRegistrationResult {
  const candidate = asRecord(value, "managed SKU registration result");
  if (candidate.outcome !== "registered" && candidate.outcome !== "existing") {
    throw new ManagedSkuRegistrationError(
      "INVALID_REGISTRATION",
      "registration outcome must be registered or existing",
    );
  }

  return {
    outcome: candidate.outcome,
    inventorySku: normalizeInventorySkuIdentity(candidate.inventorySku),
  };
}

export function applyManagedSkuRegistrationResult(
  current: StockManagement,
  expectedSku: string,
  result: ManagedSkuRegistrationResult,
): ManagedStockManagement {
  if (current.mode !== "managed" || current.status !== "setup-required") {
    throw new ManagedSkuRegistrationError(
      "INVALID_TRANSITION",
      "managed SKU registration requires setup-required stock state",
    );
  }

  let normalizedExpectedSku: string;
  try {
    normalizedExpectedSku = asNonEmptyString(expectedSku, "expectedSku");
  } catch {
    throw new ManagedSkuRegistrationError(
      "INVALID_TRANSITION",
      "managed SKU registration requires the expected Commerce SKU",
    );
  }

  const normalizedResult = normalizeManagedSkuRegistrationResult(result);
  if (normalizedResult.inventorySku.sku !== normalizedExpectedSku) {
    throw new ManagedSkuRegistrationError(
      "INVALID_TRANSITION",
      "Inventory returned a different SKU than Commerce requested",
    );
  }

  if (normalizedResult.outcome === "registered") {
    return {
      mode: "managed",
      status: "active",
      inventorySkuId: normalizedResult.inventorySku.inventorySkuId,
    };
  }

  return {
    mode: "managed",
    status: "needs-review",
    candidate: normalizedResult.inventorySku,
  };
}

export function confirmExistingManagedSku(
  current: StockManagement,
): ManagedStockManagement {
  if (current.mode !== "managed" || current.status !== "needs-review") {
    throw new ManagedSkuRegistrationError(
      "INVALID_TRANSITION",
      "existing SKU confirmation requires needs-review stock state",
    );
  }

  return {
    mode: "managed",
    status: "active",
    inventorySkuId: current.candidate.inventorySkuId,
  };
}
