import { catalogValue, saveProductData, type CatalogReader } from "./product-state.js";
import { isRecord } from "../../shared/record.js";
import { normalizeStoredStockManagement } from "../inventory-provider/kernel/index.js";
import { CatalogError, catalogStorage } from "./errors.js";
import {
  DEFAULT_CATALOG_MANUAL_AVAILABILITY,
  type CatalogManualAvailabilityRecord,
  type CatalogManualAvailabilityStatus,
  type SetCatalogItemManualAvailabilityInput,
  type SetCatalogItemManualAvailabilityResult,
  type SetCatalogItemManualAvailabilityStorage,
} from "./types.js";

const MANUAL_AVAILABILITY_STATUSES = new Set<CatalogManualAvailabilityStatus>([
  "in-stock",
  "out-of-stock",
  "available-on-backorder",
]);

function normalizeInput(value: unknown): SetCatalogItemManualAvailabilityInput {
  if (!isRecord(value)) {
    throw new CatalogError(
      "INVALID_INPUT",
      "manual availability input must be an object",
    );
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).length !== 2 ||
    typeof input.catalogItemId !== "string" ||
    input.catalogItemId.trim().length === 0 ||
    typeof input.status !== "string" ||
    !MANUAL_AVAILABILITY_STATUSES.has(
      input.status as CatalogManualAvailabilityStatus,
    )
  ) {
    throw new CatalogError(
      "INVALID_INPUT",
      "manual availability accepts catalogItemId and status only",
    );
  }
  return {
    catalogItemId: input.catalogItemId.trim(),
    status: input.status as CatalogManualAvailabilityStatus,
  };
}

function normalizeStoredAvailability(
  value: CatalogManualAvailabilityRecord | null,
  catalogItemId: string,
): CatalogManualAvailabilityRecord {
  if (value === null) {
    return {
      recordKind: "catalog-manual-availability",
      recordId: catalogItemId,
      catalogItemId,
      status: DEFAULT_CATALOG_MANUAL_AVAILABILITY,
    };
  }
  if (
    value.recordKind !== "catalog-manual-availability" ||
    value.recordId !== catalogItemId ||
    value.catalogItemId !== catalogItemId ||
    !MANUAL_AVAILABILITY_STATUSES.has(value.status)
  ) {
    throw new CatalogError(
      "STORAGE_UNAVAILABLE",
      "stored manual availability is invalid",
    );
  }
  return value;
}

export async function loadCatalogItemManualAvailability(
  storage: SetCatalogItemManualAvailabilityStorage["availability"],
  catalogItemId: string,
  catalog: CatalogReader,
): Promise<CatalogManualAvailabilityRecord> {
  const saved = await catalogValue(catalog, catalogItemId, "availability");
  const stored = saved !== undefined ? saved : await catalogStorage(() => storage.get(catalogItemId), "manual availability lookup failed");
  return normalizeStoredAvailability(stored, catalogItemId);
}

export async function setCatalogItemManualAvailability(
  storage: SetCatalogItemManualAvailabilityStorage,
  rawInput: unknown,
): Promise<SetCatalogItemManualAvailabilityResult> {
  const input = normalizeInput(rawInput);
  return saveProductData(storage.catalog, input.catalogItemId, async (data, item) => {
    if (normalizeStoredStockManagement(item.stockManagement).mode === "managed")
      throw new CatalogError("MANAGE_STOCK_ENABLED", "manual availability requires Manage Stock off");
    const values = data.items[input.catalogItemId] ?? {};
    const availability = values.availability ?? await loadCatalogItemManualAvailability(storage.availability, input.catalogItemId, storage.catalog);
    if (availability.status === input.status) return { changed: false, availability };
    const updated = { ...availability, status: input.status };
    data.items[input.catalogItemId] = { ...values, availability: updated };
    return { changed: true, availability: updated };
  });
}
