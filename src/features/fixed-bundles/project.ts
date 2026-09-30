import type { CatalogStorageRecord } from "../catalog/index.js";

import { FixedBundleError } from "./errors.js";
import type {
  FixedBundleCatalogRead,
  FixedBundleComponent,
  FixedBundleComponentSnapshot,
  FixedBundleDefinition,
  FixedBundleFulfillmentSnapshot,
} from "./types.js";

function requireNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new FixedBundleError("INVALID_DEFINITION", message);
  }
  return value.trim();
}

function requirePositiveSafeInteger(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new FixedBundleError("INVALID_QUANTITY", message);
  }
  return value;
}

function multiplySafe(quantityPerBundle: number, purchasedBundleQuantity: number): number {
  const totalQuantity = quantityPerBundle * purchasedBundleQuantity;
  if (!Number.isSafeInteger(totalQuantity)) {
    throw new FixedBundleError(
      "QUANTITY_OVERFLOW",
      "component total quantity exceeds a safe integer",
    );
  }
  return totalQuantity;
}

function readComponent(value: unknown, index: number): FixedBundleComponent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FixedBundleError(
      "INVALID_DEFINITION",
      `component ${index} must be an object`,
    );
  }
  const component = value as Record<string, unknown>;
  return {
    catalogItemId: requireNonEmptyString(
      component.catalogItemId,
      `component ${index} requires catalogItemId`,
    ),
    quantityPerBundle: requirePositiveSafeInteger(
      component.quantityPerBundle,
      `component ${index} quantityPerBundle must be a positive safe integer`,
    ),
  };
}

function readDefinition(value: unknown): FixedBundleDefinition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FixedBundleError("INVALID_DEFINITION", "definition must be an object");
  }
  const input = value as Record<string, unknown>;
  const definitionId = requireNonEmptyString(
    input.definitionId,
    "definitionId is required",
  );
  if (!Array.isArray(input.components) || input.components.length === 0) {
    throw new FixedBundleError(
      "INVALID_DEFINITION",
      "definition requires a non-empty components list",
    );
  }
  return {
    definitionId,
    components: input.components.map((component, index) => readComponent(component, index)),
  };
}

function assertCatalogItem(
  value: CatalogStorageRecord | null,
  catalogItemId: string,
): asserts value is Extract<CatalogStorageRecord, { recordKind: "catalog-item" }> {
  if (value === null) {
    throw new FixedBundleError("CATALOG_ITEM_NOT_FOUND", "catalog item was not found");
  }
  if (value.recordKind !== "catalog-item") {
    throw new FixedBundleError(
      "CATALOG_RECORD_MISMATCH",
      "catalog record is not a catalog item",
    );
  }
  if (value.itemId !== catalogItemId) {
    throw new FixedBundleError(
      "CATALOG_RECORD_MISMATCH",
      "stored catalog item identity does not match its key",
    );
  }
  if (typeof value.sku !== "string" || value.sku.trim().length === 0) {
    throw new FixedBundleError("CATALOG_RECORD_MISMATCH", "catalog item sku is missing");
  }
  if (typeof value.name !== "string" || value.name.trim().length === 0) {
    throw new FixedBundleError("CATALOG_RECORD_MISMATCH", "catalog item name is missing");
  }
}

async function loadCatalogItem(
  catalog: FixedBundleCatalogRead,
  catalogItemId: string,
): Promise<Extract<CatalogStorageRecord, { recordKind: "catalog-item" }>> {
  let record: CatalogStorageRecord | null;
  try {
    record = await catalog.get(catalogItemId);
  } catch (error) {
    throw new FixedBundleError("STORAGE_UNAVAILABLE", "catalog item lookup failed", {
      cause: error,
    });
  }
  assertCatalogItem(record, catalogItemId);
  return record;
}

export async function projectFixedBundleFulfillment(
  definition: FixedBundleDefinition,
  catalog: FixedBundleCatalogRead,
  purchasedBundleQuantity: number,
): Promise<FixedBundleFulfillmentSnapshot> {
  const trusted = readDefinition(definition);
  const purchased = requirePositiveSafeInteger(
    purchasedBundleQuantity,
    "purchasedBundleQuantity must be a positive safe integer",
  );

  const components: FixedBundleComponentSnapshot[] = [];
  for (const component of trusted.components) {
    const item = await loadCatalogItem(catalog, component.catalogItemId);
    components.push({
      catalogItemId: item.itemId,
      sku: item.sku,
      name: item.name,
      quantityPerBundle: component.quantityPerBundle,
      totalQuantity: multiplySafe(component.quantityPerBundle, purchased),
    });
  }

  return {
    definitionId: trusted.definitionId,
    purchasedBundleQuantity: purchased,
    components,
  };
}
