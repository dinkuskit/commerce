import {
  normalizeStoredStockManagement,
  releaseManagedSkuRegistrationClaims,
  setManageStock,
  type StockManagement,
} from "../inventory-provider/index.js";
import { CatalogError } from "./errors.js";
import type {
  CatalogItemRecord,
  SetCatalogItemManageStockInput,
  SetCatalogItemManageStockResult,
  SetCatalogItemManageStockStorage,
} from "./types.js";

export function currentManageStockRevision(item: CatalogItemRecord): number {
  if (item.manageStockRevision === undefined) return 0;
  if (
    typeof item.manageStockRevision !== "number" ||
    !Number.isInteger(item.manageStockRevision) ||
    item.manageStockRevision < 0
  ) {
    throw new CatalogError(
      "STORAGE_UNAVAILABLE",
      "stored manageStockRevision is invalid",
    );
  }
  return item.manageStockRevision;
}

function normalizeInput(value: unknown): SetCatalogItemManageStockInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CatalogError(
      "INVALID_INPUT",
      "Manage Stock input must be an object",
    );
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).length !== 2 ||
    typeof input.catalogItemId !== "string" ||
    input.catalogItemId.trim().length === 0 ||
    typeof input.manageStock !== "boolean"
  ) {
    throw new CatalogError(
      "INVALID_INPUT",
      "Manage Stock accepts only catalogItemId and boolean manageStock",
    );
  }
  return {
    catalogItemId: input.catalogItemId.trim(),
    manageStock: input.manageStock,
  };
}

function sameStockManagement(left: StockManagement, right: StockManagement): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function loadCatalogItem(
  storage: SetCatalogItemManageStockStorage,
  catalogItemId: string,
): Promise<CatalogItemRecord> {
  let stored;
  try {
    stored = await storage.catalog.get(catalogItemId);
  } catch (error) {
    throw new CatalogError("STORAGE_UNAVAILABLE", "catalog item lookup failed", {
      cause: error,
    });
  }
  if (stored === null || stored.recordKind !== "catalog-item") {
    throw new CatalogError("CATALOG_ITEM_NOT_FOUND", "catalog item was not found");
  }
  if (stored.itemId !== catalogItemId) {
    throw new CatalogError(
      "STORAGE_UNAVAILABLE",
      "stored catalog item identity does not match its key",
    );
  }
  return {
    ...stored,
    creationIntent: stored.creationIntent ?? { manageStock: false },
    stockManagement: normalizeStoredStockManagement(stored.stockManagement),
  };
}

export async function setCatalogItemManageStock(
  storage: SetCatalogItemManageStockStorage,
  rawInput: unknown,
): Promise<SetCatalogItemManageStockResult> {
  const input = normalizeInput(rawInput);
  const item = await loadCatalogItem(storage, input.catalogItemId);
  const currentRevision = currentManageStockRevision(item);
  const nextStockManagement = setManageStock(item.stockManagement, input.manageStock);
  const enabling = item.stockManagement.mode === "unmanaged" && input.manageStock;
  const nextRevision = enabling ? currentRevision + 1 : currentRevision;
  const nextItem: CatalogItemRecord = {
    ...item,
    manageStockRevision: nextRevision,
    stockManagement: nextStockManagement,
  };
  const changed =
    !sameStockManagement(item.stockManagement, nextStockManagement) ||
    currentRevision !== nextRevision;

  if (changed) {
    try {
      await storage.catalog.put(nextItem.itemId, nextItem);
    } catch (error) {
      throw new CatalogError(
        "STORAGE_UNAVAILABLE",
        "Manage Stock update failed",
        { cause: error },
      );
    }
  }

  if (!input.manageStock) {
    try {
      await releaseManagedSkuRegistrationClaims(storage.claims, {
        catalogItemId: item.itemId,
        stockManagement: item.stockManagement,
      });
    } catch (error) {
      throw new CatalogError(
        "STORAGE_UNAVAILABLE",
        "managed SKU registration claim release failed",
        { cause: error },
      );
    }
  }

  return { changed, item: changed ? nextItem : item };
}
