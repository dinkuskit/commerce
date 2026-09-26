import { normalizeStoredStockManagement } from "../inventory-provider/index.js";
import { CatalogError } from "./errors.js";
import {
  CLERK_DOLLAR_MESSAGE,
  CLERK_END_SALE_MESSAGE,
  CLERK_SALE_LOWER_MESSAGE,
  CLERK_SALE_NEEDS_REGULAR_MESSAGE,
  formatClerkDollar,
  parseClerkDollar,
  type ParsedClerkDollar,
} from "./clerk-price.js";
import {
  CLERK_STOCK_STATUSES,
  CLERK_STOCK_STATUS_MESSAGE,
  MANAGED_STOCK_STATUS_MESSAGE,
  type ClerkStockStatus,
} from "./clerk-stock.js";
import {
  loadCatalogItemManualAvailability,
  setCatalogItemManualAvailability,
} from "./manual-availability.js";
import { moneyEquals, saleIsStrictlyLower } from "./money.js";
import { commitCatalogItemPrice, resolveCatalogItemPrice } from "./price.js";
import type {
  CatalogItemReadStorage,
  CatalogManualAvailabilityStatus,
  CatalogManualAvailabilityStorage,
  CatalogPriceRecord,
  CatalogPriceStorage,
  CatalogStorageRecord,
  Money,
} from "./types.js";

export { CLERK_STOCK_STATUSES, type ClerkStockStatus } from "./clerk-stock.js";

const LIST_PAGE_LIMIT = 100;
const LIST_PAGE_CAP = 100;

interface PageResult<T> {
  items: Array<{ id: string; data: T }>;
  cursor?: string;
  hasMore: boolean;
}

export interface CatalogProductListStorage {
  catalog: {
    query(options?: {
      limit?: number;
      cursor?: string;
    }): Promise<PageResult<CatalogStorageRecord>>;
  };
  prices: CatalogPriceStorage;
  availability: CatalogManualAvailabilityStorage;
}

export interface CatalogProductListItem {
  catalogItemId: string;
  name: string;
  sku: string;
  regular: string | null;
  sale: string | null;
  manageStock: boolean;
  stockStatus: ClerkStockStatus | null;
}

export interface SaveCatalogProductPricesInput {
  catalogItemId: string;
  regular: string;
  sale: string;
  stockStatus?: string;
}

export interface CatalogProductPriceForm {
  saved: boolean;
  regular: string;
  sale: string;
  manageStock: boolean;
  stockStatus: ClerkStockStatus | null;
  message: string | null;
}

interface SaveStorage {
  catalog: CatalogItemReadStorage;
  prices: CatalogPriceStorage;
  availability: CatalogManualAvailabilityStorage;
}

function isClerkStockStatus(value: string): value is ClerkStockStatus {
  return (CLERK_STOCK_STATUSES as readonly string[]).includes(value);
}

function toClerkStockStatus(
  status: CatalogManualAvailabilityStatus,
): ClerkStockStatus {
  return status === "available-on-backorder" ? "on-backorder" : status;
}

function toStoredStockStatus(
  status: ClerkStockStatus,
): CatalogManualAvailabilityStatus {
  return status === "on-backorder" ? "available-on-backorder" : status;
}

async function readPages<T>(
  query: (options?: { limit?: number; cursor?: string }) => Promise<PageResult<T>>,
  failure: string,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < LIST_PAGE_CAP; page += 1) {
    let result: PageResult<T>;
    try {
      result = await query({ limit: LIST_PAGE_LIMIT, cursor });
    } catch (error) {
      throw new CatalogError("STORAGE_UNAVAILABLE", failure, { cause: error });
    }
    for (const item of result.items) rows.push(item.data);
    if (!result.hasMore) return rows;
    if (result.cursor === undefined || result.cursor === cursor) {
      throw new CatalogError("STORAGE_UNAVAILABLE", failure);
    }
    cursor = result.cursor;
  }
  throw new CatalogError("STORAGE_UNAVAILABLE", failure);
}

export async function listCatalogProducts(
  storage: CatalogProductListStorage,
): Promise<{ products: CatalogProductListItem[] }> {
  const records = await readPages(
    (options) => storage.catalog.query(options),
    "catalog product list failed",
  );
  const products: CatalogProductListItem[] = [];
  for (const record of records) {
    if (record.recordKind !== "catalog-item") continue;
    const price = await resolveCatalogItemPrice(storage.prices, record.itemId);
    const managed =
      normalizeStoredStockManagement(record.stockManagement).mode === "managed";
    const availability = managed
      ? null
      : await loadCatalogItemManualAvailability(storage.availability, record.itemId);
    products.push({
      catalogItemId: record.itemId,
      name: record.name,
      sku: record.sku,
      regular:
        price.listable && price.regular !== undefined
          ? formatClerkDollar(price.regular)
          : null,
      sale: price.sale === undefined ? null : formatClerkDollar(price.sale),
      manageStock: managed,
      stockStatus:
        availability === null ? null : toClerkStockStatus(availability.status),
    });
  }
  products.sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    return byName === 0 ? left.sku.localeCompare(right.sku) : byName;
  });
  return { products };
}

function invalidMessage(regular: ParsedClerkDollar, sale: ParsedClerkDollar): string | null {
  const parts: string[] = [];
  if (regular.status === "invalid") parts.push(`Regular: ${CLERK_DOLLAR_MESSAGE}`);
  if (sale.status === "invalid") parts.push(`Sale: ${CLERK_DOLLAR_MESSAGE}`);
  return parts.length === 0 ? null : parts.join(" ");
}

function refused(
  input: SaveCatalogProductPricesInput,
  message: string,
  manageStock: boolean,
  stockStatus: ClerkStockStatus | null,
): CatalogProductPriceForm {
  return {
    saved: false,
    regular: input.regular,
    sale: input.sale,
    manageStock,
    stockStatus,
    message,
  };
}

function displayForm(
  regular: Money | null,
  sale: Money | null,
  manageStock: boolean,
  stockStatus: ClerkStockStatus | null,
): CatalogProductPriceForm {
  return {
    saved: true,
    regular: regular === null ? "" : formatClerkDollar(regular),
    sale: sale === null ? "" : formatClerkDollar(sale),
    manageStock,
    stockStatus,
    message: null,
  };
}

function normalizeSaveInput(value: unknown): SaveCatalogProductPricesInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CatalogError("INVALID_INPUT", "price save input must be an object");
  }
  const input = value as Record<string, unknown>;
  if (typeof input.catalogItemId !== "string" || input.catalogItemId.trim().length === 0) {
    throw new CatalogError("INVALID_INPUT", "catalogItemId must be a non-empty string");
  }
  if (typeof input.regular !== "string" || typeof input.sale !== "string") {
    throw new CatalogError("INVALID_INPUT", "price fields must be strings");
  }
  if (input.stockStatus !== undefined && typeof input.stockStatus !== "string") {
    throw new CatalogError("INVALID_INPUT", "stock status must be a string");
  }
  return {
    catalogItemId: input.catalogItemId,
    regular: input.regular,
    sale: input.sale,
    stockStatus: input.stockStatus,
  };
}

export async function saveCatalogProductPrices(
  storage: SaveStorage,
  rawInput: unknown,
): Promise<CatalogProductPriceForm> {
  const input = normalizeSaveInput(rawInput);
  const catalogItemId = input.catalogItemId.trim();
  const item = await storage.catalog.get(catalogItemId);
  if (item === null || item.recordKind !== "catalog-item" || item.itemId !== catalogItemId) {
    throw new CatalogError("CATALOG_ITEM_NOT_FOUND", "catalog item was not found");
  }

  const managed =
    normalizeStoredStockManagement(item.stockManagement).mode === "managed";
  const currentAvailability = managed
    ? null
    : await loadCatalogItemManualAvailability(storage.availability, catalogItemId);
  const currentStockStatus =
    currentAvailability === null
      ? null
      : toClerkStockStatus(currentAvailability.status);

  let nextStockStatus = currentStockStatus;
  if (managed && input.stockStatus !== undefined) {
    return refused(input, MANAGED_STOCK_STATUS_MESSAGE, true, null);
  }
  if (!managed && input.stockStatus !== undefined) {
    if (!isClerkStockStatus(input.stockStatus)) {
      return refused(
        input,
        CLERK_STOCK_STATUS_MESSAGE,
        false,
        currentStockStatus,
      );
    }
    nextStockStatus = input.stockStatus;
  }

  const regular = parseClerkDollar(input.regular);
  const sale = parseClerkDollar(input.sale);
  const invalid = invalidMessage(regular, sale);
  if (invalid !== null) {
    return refused(input, invalid, managed, currentStockStatus);
  }

  const targetRegular = regular.status === "amount" ? regular.amount : null;
  const targetSale = sale.status === "amount" ? sale.amount : null;
  const current = await resolveCatalogItemPrice(storage.prices, catalogItemId);
  const currentRegular = current.regular ?? null;
  const currentSale = current.sale ?? null;

  if (targetSale !== null && targetRegular === null) {
    return refused(
      input,
      currentSale !== null || currentRegular !== null
        ? CLERK_END_SALE_MESSAGE
        : CLERK_SALE_NEEDS_REGULAR_MESSAGE,
      managed,
      currentStockStatus,
    );
  }
  if (
    targetSale !== null &&
    targetRegular !== null &&
    !saleIsStrictlyLower(targetSale, targetRegular)
  ) {
    return refused(input, CLERK_SALE_LOWER_MESSAGE, managed, currentStockStatus);
  }
  const priceUnchanged =
    moneySame(currentRegular, targetRegular) && moneySame(currentSale, targetSale);
  const stockUnchanged = nextStockStatus === currentStockStatus;
  if (priceUnchanged && stockUnchanged) {
    return displayForm(targetRegular, targetSale, managed, nextStockStatus);
  }

  let priceCommitted = false;
  try {
    if (!priceUnchanged) {
      await commitCatalogItemPrice(storage, {
        catalogItemId,
        regular: targetRegular,
        sale: targetSale,
      });
      priceCommitted = true;
    }
    if (!managed && nextStockStatus !== null && !stockUnchanged) {
      await setCatalogItemManualAvailability(
        { catalog: storage.catalog, availability: storage.availability },
        {
          catalogItemId,
          status: toStoredStockStatus(nextStockStatus),
        },
      );
    }
  } catch (error) {
    if (priceCommitted) {
      try {
        await restoreCommittedPrice(
          storage,
          catalogItemId,
          targetRegular,
          targetSale,
          currentRegular,
          currentSale,
        );
      } catch {
        // Keep the original stock-write error.
      }
    }
    throw error;
  }
  return displayForm(targetRegular, targetSale, managed, nextStockStatus);
}

function moneySame(left: Money | null, right: Money | null): boolean {
  if (left === null || right === null) return left === right;
  return moneyEquals(left, right);
}

async function restoreCommittedPrice(
  storage: SaveStorage,
  catalogItemId: string,
  committedRegular: Money | null,
  committedSale: Money | null,
  previousRegular: Money | null,
  previousSale: Money | null,
): Promise<void> {
  const latest = await storage.prices.getVersioned(catalogItemId);
  if (latest === null) return;
  if (
    !moneySame(latest.value.regular, committedRegular) ||
    !moneySame(latest.value.sale ?? null, committedSale)
  ) {
    return;
  }
  if (previousRegular === null) {
    await storage.prices.compareAndDelete(catalogItemId, latest.revision);
    return;
  }
  const record: CatalogPriceRecord = {
    recordKind: "catalog-price",
    recordId: catalogItemId,
    catalogItemId,
    regular: previousRegular,
    ...(previousSale === null ? {} : { sale: previousSale }),
  };
  await storage.prices.compareAndSet(catalogItemId, latest.revision, record);
}
