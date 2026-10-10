import { isRecord } from "../../shared/record.js";
import { normalizeInventoryProviderBinding } from "../inventory-provider/kernel/index.js";
import { InventorySetupError } from "./errors.js";
import type {
  StoreInventoryConfigurationRecord,
  StoreInventoryConfigurationStorage,
} from "./types.js";

const CONFIGURATION_KEY = "active" as const;
const INVALID_CONFIG = "stored inventory config invalid";

function fail(
  code: "STORAGE_CONSTRAINTS_UNAVAILABLE" | "STORAGE_UNAVAILABLE",
  message: string,
  cause?: unknown,
): InventorySetupError {
  return new InventorySetupError(code, message, cause === undefined ? undefined : { cause });
}

function asStoredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw fail("STORAGE_UNAVAILABLE", `inventory configuration ${field} invalid`);
  }
  return value.trim();
}

function normalizeConfigurationRecord(
  value: unknown,
): StoreInventoryConfigurationRecord {
  if (!isRecord(value)) {
    throw fail("STORAGE_UNAVAILABLE", INVALID_CONFIG);
  }
  const record = value as Record<string, unknown>;
  if (
    record.recordKind !== "store-inventory-configuration" ||
    record.configurationKey !== CONFIGURATION_KEY
  ) {
    throw fail("STORAGE_UNAVAILABLE", INVALID_CONFIG);
  }
  let binding;
  try {
    binding = normalizeInventoryProviderBinding(record.binding);
  } catch (error) {
    throw fail("STORAGE_UNAVAILABLE", INVALID_CONFIG, error);
  }
  return {
    recordKind: "store-inventory-configuration",
    recordId: asStoredString(record.recordId, "recordId"),
    configurationKey: CONFIGURATION_KEY,
    siteId: asStoredString(record.siteId, "siteId"),
    binding,
    configuredAt: asStoredString(record.configuredAt, "configuredAt"),
    updatedAt: asStoredString(record.updatedAt, "updatedAt"),
  };
}

export async function loadStoreInventoryConfiguration(
  storage: StoreInventoryConfigurationStorage,
): Promise<StoreInventoryConfigurationRecord | null> {
  let result;
  try {
    result = await storage.query({ where: { configurationKey: CONFIGURATION_KEY }, limit: 2 });
  } catch (error) {
    throw fail("STORAGE_UNAVAILABLE", "inventory configuration lookup failed", error);
  }
  if (result.hasMore || result.items.length > 1) {
    throw fail(
      "STORAGE_CONSTRAINTS_UNAVAILABLE",
      "inventory configuration is ambiguous",
    );
  }
  if (result.items.length === 0) return null;
  try {
    return normalizeConfigurationRecord(result.items[0]?.data);
  } catch (error) {
    if (error instanceof InventorySetupError) return null;
    throw error;
  }
}
