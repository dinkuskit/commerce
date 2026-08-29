import { normalizeInventoryProviderBinding } from "./binding.js";
import { ManagedSkuRegistrationError } from "./errors.js";
import type {
  InventoryProviderBinding,
  InventorySkuIdentity,
  ManagedSkuRegistration,
  ManagedSkuRegistrationExecution,
  ManagedSkuRegistrationInput,
  ManagedSkuRegistrationRequest,
  ManagedSkuRegistrationRejection,
  ManagedSkuRegistrationResult,
  ManagedStockManagement,
  SetupPendingManagedStockManagement,
  StartManagedSkuRegistrationExecution,
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

export function normalizeManagedSkuRegistrationResult(
  value: unknown,
): ManagedSkuRegistrationResult {
  const candidate = asRecord(value, "managed SKU registration result");
  if (candidate.outcome === "rejected") {
    return {
      outcome: "rejected",
      ...normalizeManagedSkuRegistrationRejection(candidate),
    };
  }

  if (candidate.outcome !== "registered" && candidate.outcome !== "existing") {
    throw new ManagedSkuRegistrationError(
      "INVALID_REGISTRATION",
      "registration outcome must be registered, existing, or rejected",
    );
  }

  return {
    outcome: candidate.outcome,
    inventorySku: normalizeInventorySkuIdentity(candidate.inventorySku),
  };
}

export function applyManagedSkuRegistrationResult(
  current: StockManagement,
  result: ManagedSkuRegistrationResult,
): ManagedStockManagement {
  if (current.mode !== "managed" || current.status !== "setup-pending") {
    throw new ManagedSkuRegistrationError(
      "INVALID_TRANSITION",
      "managed SKU registration result requires setup-pending stock state",
    );
  }

  const registration = normalizeManagedSkuRegistration(current.registration);
  const normalizedResult = normalizeManagedSkuRegistrationResult(result);
  if (normalizedResult.outcome === "rejected") {
    return {
      mode: "managed",
      status: "setup-needs-attention",
      registration,
      rejection: {
        code: normalizedResult.code,
        message: normalizedResult.message,
      },
    };
  }

  if (normalizedResult.inventorySku.sku !== registration.request.sku) {
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

function normalizeExecution(
  value: ManagedSkuRegistrationExecution,
): ManagedSkuRegistrationExecution {
  const candidate = asRecord(value, "managed SKU registration execution");
  const provider = asRecord(candidate.provider, "inventory provider");
  if (typeof provider.registerManagedSku !== "function") {
    throw new ManagedSkuRegistrationError(
      "INVALID_REGISTRATION",
      "inventory provider must implement registerManagedSku",
    );
  }
  if (typeof candidate.persist !== "function") {
    throw new ManagedSkuRegistrationError(
      "INVALID_REGISTRATION",
      "persist must be a function",
    );
  }
  return value;
}

function createOperationId(
  execution: StartManagedSkuRegistrationExecution,
): string {
  if (
    execution.createOperationId !== undefined &&
    typeof execution.createOperationId !== "function"
  ) {
    throw new ManagedSkuRegistrationError(
      "INVALID_REGISTRATION",
      "createOperationId must be a function when supplied",
    );
  }
  const createId =
    execution.createOperationId ?? (() => globalThis.crypto.randomUUID());
  return asNonEmptyString(createId(), "operationId");
}

async function executePendingRegistration(
  pending: SetupPendingManagedStockManagement,
  rawExecution: ManagedSkuRegistrationExecution,
): Promise<ManagedStockManagement> {
  const execution = normalizeExecution(rawExecution);
  await execution.persist(pending);
  const result = await execution.provider.registerManagedSku(
    pending.registration,
  );
  const next = applyManagedSkuRegistrationResult(pending, result);
  await execution.persist(next);
  return next;
}

export async function startManagedSkuRegistration(
  current: StockManagement,
  binding: InventoryProviderBinding,
  input: ManagedSkuRegistrationInput,
  rawExecution: StartManagedSkuRegistrationExecution,
): Promise<ManagedStockManagement> {
  if (
    current.mode !== "managed" ||
    (current.status !== "setup-required" &&
      current.status !== "setup-needs-attention")
  ) {
    throw new ManagedSkuRegistrationError(
      "INVALID_TRANSITION",
      "managed SKU registration can start only from setup-required or setup-needs-attention",
    );
  }

  const execution = normalizeExecution(
    rawExecution,
  ) as StartManagedSkuRegistrationExecution;
  const operationId = createOperationId(execution);
  if (
    current.status === "setup-needs-attention" &&
    normalizeManagedSkuRegistration(current.registration).operationId === operationId
  ) {
    throw new ManagedSkuRegistrationError(
      "INVALID_TRANSITION",
      "corrected registration requires a new operationId",
    );
  }

  const pending: SetupPendingManagedStockManagement = {
    mode: "managed",
    status: "setup-pending",
    registration: {
      operationId,
      request: createManagedSkuRegistrationRequest(binding, input),
    },
  };

  return executePendingRegistration(pending, execution);
}

export async function retryManagedSkuRegistration(
  current: StockManagement,
  execution: ManagedSkuRegistrationExecution,
): Promise<ManagedStockManagement> {
  if (current.mode !== "managed" || current.status !== "setup-pending") {
    throw new ManagedSkuRegistrationError(
      "INVALID_TRANSITION",
      "managed SKU registration retry requires setup-pending stock state",
    );
  }

  return executePendingRegistration(
    {
      mode: "managed",
      status: "setup-pending",
      registration: normalizeManagedSkuRegistration(current.registration),
    },
    execution,
  );
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

  const candidate = normalizeInventorySkuIdentity(current.candidate);

  return {
    mode: "managed",
    status: "active",
    inventorySkuId: candidate.inventorySkuId,
  };
}
