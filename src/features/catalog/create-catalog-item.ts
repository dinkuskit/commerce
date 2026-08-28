import { CatalogError } from "./errors.js";
import { normalizeCreateCatalogItemInput } from "./normalize.js";
import {
  assertCatalogStorageConstraints,
  identifyConfirmedUniqueViolation,
} from "./storage-constraints.js";
import type {
  CatalogItemRecord,
  CatalogStorage,
  CreateCatalogItemResult,
  NormalizedCreateCatalogItemInput,
} from "./types.js";
import {
  createInitialStockManagement,
  normalizeStoredStockManagement,
} from "../inventory-provider/index.js";

export interface CreateCatalogItemOptions {
  createId?: () => string;
  now?: () => Date;
}

function sameCommandPayload(
  item: CatalogItemRecord,
  input: NormalizedCreateCatalogItemInput,
): boolean {
  return (
    item.commandId === input.commandId &&
    item.kind === input.kind &&
    item.name === input.name &&
    item.sku === input.sku &&
    item.skuKey === input.skuKey &&
    (item.creationIntent?.manageStock ?? false) === input.creationIntent.manageStock
  );
}

async function findCommand(
  storage: CatalogStorage,
  commandId: string,
): Promise<CatalogItemRecord | null> {
  let result;
  try {
    result = await storage.query({ where: { commandId }, limit: 2 });
  } catch (error) {
    throw new CatalogError("STORAGE_UNAVAILABLE", "catalog command lookup failed", {
      cause: error,
    });
  }

  const items = result.items
    .map(({ data }) => data)
    .filter((record): record is CatalogItemRecord => record.recordKind === "catalog-item")
    .map((record) => ({
      ...record,
      creationIntent: record.creationIntent ?? { manageStock: false },
      stockManagement:
        record.stockManagement === undefined
          ? createInitialStockManagement(false)
          : normalizeStoredStockManagement(record.stockManagement),
    }));
  if (items.length > 1) {
    throw new CatalogError(
      "STORAGE_CONSTRAINTS_UNAVAILABLE",
      "catalog command uniqueness is not trustworthy",
    );
  }
  return items[0] ?? null;
}

function resolveExistingCommand(
  existing: CatalogItemRecord,
  input: NormalizedCreateCatalogItemInput,
): CreateCatalogItemResult {
  if (!sameCommandPayload(existing, input)) {
    throw new CatalogError(
      "COMMAND_CONFLICT",
      "commandId was already used with different catalog input",
    );
  }
  return { created: false, item: existing };
}

export async function createCatalogItem(
  storage: CatalogStorage,
  rawInput: unknown,
  options: CreateCatalogItemOptions = {},
): Promise<CreateCatalogItemResult> {
  const input = normalizeCreateCatalogItemInput(rawInput);
  await assertCatalogStorageConstraints(storage);

  const existing = await findCommand(storage, input.commandId);
  if (existing) return resolveExistingCommand(existing, input);

  const item: CatalogItemRecord = {
    recordKind: "catalog-item",
    itemId: (options.createId ?? (() => globalThis.crypto.randomUUID()))(),
    ...input,
    state: "draft",
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
  };

  try {
    await storage.put(item.itemId, item);
    return { created: true, item };
  } catch (error) {
    const uniqueField = identifyConfirmedUniqueViolation(error);
    if (!uniqueField) {
      throw new CatalogError("STORAGE_UNAVAILABLE", "catalog item creation failed", {
        cause: error,
      });
    }

    const concurrentCommand = await findCommand(storage, input.commandId);
    if (concurrentCommand) return resolveExistingCommand(concurrentCommand, input);
    if (uniqueField === "skuKey") {
      throw new CatalogError("SKU_CONFLICT", "sku is already assigned to another catalog item");
    }
    throw new CatalogError(
      "STORAGE_CONSTRAINTS_UNAVAILABLE",
      "catalog command conflict could not be resolved",
      { cause: error },
    );
  }
}
