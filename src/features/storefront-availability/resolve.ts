import {
  loadCatalogItemBackorderPolicy,
  type CatalogItemRecord,
  type CatalogStorageRecord,
} from "../catalog/index.js";
import { normalizeStoredStockManagement } from "../inventory-provider/index.js";
import { loadStoreInventoryConfiguration } from "../inventory-setup/index.js";
import { StorefrontAvailabilityError } from "./errors.js";
import {
  exactQuantitySign,
  normalizeExactQuantity,
  positiveQuantityAtOrBelowInteger,
} from "./quantity.js";
import { loadStorefrontAvailabilityPolicy } from "./settings.js";
import {
  INVENTORY_SKU_STOCK_READ_RESULT_SCHEMA,
  STOREFRONT_AVAILABILITY_RESULT_SCHEMA,
  type ExactQuantity,
  type InventorySkuStockReadInput,
  type InventoryStockQuantities,
  type ResolveManagedStorefrontAvailabilityExecution,
  type ResolveManagedStorefrontAvailabilityInput,
  type StorefrontAvailabilityResult,
  type StorefrontAvailabilityDisplayPolicy,
  type StorefrontAvailabilityStorage,
} from "./types.js";

function normalizeInput(value: unknown): ResolveManagedStorefrontAvailabilityInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StorefrontAvailabilityError(
      "INVALID_INPUT",
      "storefront availability input must be an object",
    );
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).length !== 1 ||
    typeof input.catalogItemId !== "string" ||
    input.catalogItemId.trim().length === 0
  ) {
    throw new StorefrontAvailabilityError(
      "INVALID_INPUT",
      "storefront availability accepts only catalogItemId",
    );
  }
  return { catalogItemId: input.catalogItemId.trim() };
}

function unavailable(catalogItemId: string): StorefrontAvailabilityResult {
  return {
    schema: STOREFRONT_AVAILABILITY_RESULT_SCHEMA,
    catalogItemId,
    status: "availability-unavailable",
    sellable: false,
  };
}

function normalizeCatalogItem(
  stored: CatalogStorageRecord | null,
  catalogItemId: string,
): CatalogItemRecord | null {
  if (stored === null || stored.recordKind !== "catalog-item") return null;
  if (stored.itemId !== catalogItemId) return null;
  return {
    ...stored,
    creationIntent: stored.creationIntent ?? { manageStock: false },
    stockManagement: normalizeStoredStockManagement(stored.stockManagement),
  };
}

function sameScope(
  value: unknown,
  expected: InventorySkuStockReadInput["scope"],
): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const scope = value as Record<string, unknown>;
  return (
    scope.kind === "location" &&
    scope.locationId === expected.locationId &&
    Object.keys(scope).length === 2
  );
}

function foundAvailableQuantity(
  value: unknown,
  expected: InventorySkuStockReadInput,
): ExactQuantity | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (
    result.schema !== INVENTORY_SKU_STOCK_READ_RESULT_SCHEMA ||
    result.outcome !== "found" ||
    result.poolId !== expected.poolId ||
    result.skuId !== expected.skuId ||
    !sameScope(result.scope, expected.scope)
  ) {
    return null;
  }
  const stock = normalizeStockQuantities(result.stock);
  if (!stock || !Array.isArray(result.locations) || result.locations.length !== 1) {
    return null;
  }
  const [location] = result.locations;
  if (typeof location !== "object" || location === null || Array.isArray(location)) {
    return null;
  }
  const locationRecord = location as Record<string, unknown>;
  const locationStock = normalizeStockQuantities(locationRecord.stock);
  if (
    locationRecord.locationId !== expected.scope.locationId ||
    typeof locationRecord.name !== "string" ||
    locationRecord.name.trim().length === 0 ||
    !locationStock ||
    !sameStock(stock, locationStock)
  ) {
    return null;
  }
  return stock.available;
}

const STOCK_QUANTITY_FIELDS = [
  "onHand",
  "reserved",
  "outgoingTransferCommitted",
  "available",
  "expected",
  "inTransit",
] as const satisfies readonly (keyof InventoryStockQuantities)[];

function normalizeStockQuantities(value: unknown): InventoryStockQuantities | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const quantities = Object.fromEntries(
    STOCK_QUANTITY_FIELDS.map((field) => [field, normalizeExactQuantity(source[field])]),
  ) as Record<(typeof STOCK_QUANTITY_FIELDS)[number], ExactQuantity | null>;
  if (STOCK_QUANTITY_FIELDS.some((field) => quantities[field] === null)) return null;
  const normalized = quantities as InventoryStockQuantities;
  if (STOCK_QUANTITY_FIELDS.some((field) => normalized[field].unit !== normalized.onHand.unit)) {
    return null;
  }
  return normalized;
}

function sameStock(
  left: InventoryStockQuantities,
  right: InventoryStockQuantities,
): boolean {
  return STOCK_QUANTITY_FIELDS.every(
    (field) =>
      left[field].value === right[field].value &&
      left[field].unit === right[field].unit,
  );
}

function availableResult(
  item: CatalogItemRecord,
  allowBackorders: boolean,
  quantity: ExactQuantity,
  policy: StorefrontAvailabilityDisplayPolicy,
): StorefrontAvailabilityResult {
  if (exactQuantitySign(quantity.value) !== 1) {
    return {
      schema: STOREFRONT_AVAILABILITY_RESULT_SCHEMA,
      catalogItemId: item.itemId,
      status: allowBackorders ? "available-on-backorder" : "out-of-stock",
      sellable: allowBackorders,
    };
  }
  if (policy.mode === "exact") {
    return {
      schema: STOREFRONT_AVAILABILITY_RESULT_SCHEMA,
      catalogItemId: item.itemId,
      status: "in-stock",
      sellable: true,
      displayQuantity: quantity,
    };
  }
  if (
    policy.mode === "threshold" &&
    positiveQuantityAtOrBelowInteger(quantity.value, policy.threshold)
  ) {
    return {
      schema: STOREFRONT_AVAILABILITY_RESULT_SCHEMA,
      catalogItemId: item.itemId,
      status: "low-stock",
      sellable: true,
      displayQuantity: quantity,
    };
  }
  return {
    schema: STOREFRONT_AVAILABILITY_RESULT_SCHEMA,
    catalogItemId: item.itemId,
    status: "in-stock",
    sellable: true,
  };
}

export async function resolveManagedStorefrontAvailability(
  storage: StorefrontAvailabilityStorage,
  rawInput: unknown,
  execution: ResolveManagedStorefrontAvailabilityExecution,
): Promise<StorefrontAvailabilityResult> {
  const input = normalizeInput(rawInput);
  let stored: CatalogStorageRecord | null;
  try {
    stored = await storage.catalog.get(input.catalogItemId);
  } catch {
    return unavailable(input.catalogItemId);
  }
  if (stored === null || stored.recordKind !== "catalog-item") {
    throw new StorefrontAvailabilityError(
      "CATALOG_ITEM_NOT_FOUND",
      "catalog item was not found",
    );
  }
  const item = normalizeCatalogItem(stored, input.catalogItemId);
  if (!item) return unavailable(input.catalogItemId);
  if (item.stockManagement.mode !== "managed") {
    throw new StorefrontAvailabilityError(
      "MANAGE_STOCK_REQUIRED",
      "catalog item does not use managed stock",
    );
  }
  if (item.stockManagement.status !== "active") return unavailable(item.itemId);

  let configuration;
  let displayPolicy;
  let backorderPolicy;
  try {
    [configuration, displayPolicy, backorderPolicy] = await Promise.all([
      loadStoreInventoryConfiguration(storage.configurations),
      loadStorefrontAvailabilityPolicy(storage.settings),
      loadCatalogItemBackorderPolicy(storage.backorderPolicies, item.itemId),
    ]);
  } catch {
    return unavailable(item.itemId);
  }
  if (!configuration || typeof execution.resolveProvider !== "function") {
    return unavailable(item.itemId);
  }

  const readInput: InventorySkuStockReadInput = {
    poolId: configuration.binding.poolId,
    skuId: item.stockManagement.inventorySkuId,
    scope: {
      kind: "location",
      locationId: configuration.binding.defaultFulfillmentLocationId,
    },
  };
  try {
    const provider = await execution.resolveProvider(configuration);
    if (!provider || typeof provider.readSkuStock !== "function") {
      return unavailable(item.itemId);
    }
    const result = await provider.readSkuStock(readInput);
    const quantity = foundAvailableQuantity(result, readInput);
    if (!quantity) return unavailable(item.itemId);
    return availableResult(
      item,
      backorderPolicy.allowBackorders,
      quantity,
      displayPolicy,
    );
  } catch {
    return unavailable(item.itemId);
  }
}
