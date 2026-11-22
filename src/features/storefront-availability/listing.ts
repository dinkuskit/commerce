import { isRecord } from "../../shared/record.js";
import { StorefrontAvailabilityError } from "./errors.js";
import {
  DEFAULT_HIDE_OUT_OF_STOCK,
  STOREFRONT_OUT_OF_STOCK_LISTING_RECORD_ID,
  type SetOutOfStockListingOptions,
  type SetOutOfStockListingResult,
  type StorefrontOutOfStockListingRecord,
  type StorefrontOutOfStockListingStorage,
} from "./types.js";

function defaultListing(): StorefrontOutOfStockListingRecord {
  return {
    recordKind: "storefront-out-of-stock-listing",
    recordId: STOREFRONT_OUT_OF_STOCK_LISTING_RECORD_ID,
    hideOutOfStock: DEFAULT_HIDE_OUT_OF_STOCK,
    updatedAt: "1970-01-01T00:00:00.000Z",
  };
}

function normalizeStoredListing(
  value: StorefrontOutOfStockListingRecord | null,
): StorefrontOutOfStockListingRecord {
  if (value === null) return defaultListing();
  if (
    value.recordKind !== "storefront-out-of-stock-listing" ||
    value.recordId !== STOREFRONT_OUT_OF_STOCK_LISTING_RECORD_ID ||
    typeof value.hideOutOfStock !== "boolean" ||
    typeof (value.offCatalog ?? false) !== "boolean" ||
    typeof value.updatedAt !== "string" ||
    value.updatedAt.trim().length === 0
  ) {
    throw new StorefrontAvailabilityError(
      "STORAGE_UNAVAILABLE",
      "stored out-of-stock listing is invalid",
    );
  }
  return {
    ...value,
    updatedAt: value.updatedAt.trim(),
  };
}

export async function loadOutOfStockListing(
  storage: StorefrontOutOfStockListingStorage,
): Promise<StorefrontOutOfStockListingRecord> {
  let stored: StorefrontOutOfStockListingRecord | null;
  try {
    stored = await storage.get(STOREFRONT_OUT_OF_STOCK_LISTING_RECORD_ID);
  } catch {
    throw new StorefrontAvailabilityError(
      "STORAGE_UNAVAILABLE",
      "out-of-stock listing lookup failed",
    );
  }
  return normalizeStoredListing(stored);
}

export async function setOutOfStockListing(
  storage: StorefrontOutOfStockListingStorage,
  rawInput: unknown,
  options: SetOutOfStockListingOptions = {},
): Promise<SetOutOfStockListingResult> {
  if (!isRecord(rawInput)) {
    throw new StorefrontAvailabilityError(
      "INVALID_INPUT",
      "out-of-stock listing input must be an object",
    );
  }
  const listing = await loadOutOfStockListing(storage);
  // offCatalog left out keeps the owner's catalog choice.
  const { hideOutOfStock, offCatalog = !!listing.offCatalog, ...rest } = rawInput as Record<string, unknown>;
  if (
    Object.keys(rest).length ||
    typeof hideOutOfStock !== "boolean" ||
    typeof offCatalog !== "boolean"
  ) {
    throw new StorefrontAvailabilityError(
      "INVALID_INPUT",
      "out-of-stock listing accepts hideOutOfStock and offCatalog only",
    );
  }
  if (listing.hideOutOfStock === hideOutOfStock && !!listing.offCatalog === offCatalog) {
    return { changed: false, listing };
  }
  const updated: StorefrontOutOfStockListingRecord = {
    recordKind: "storefront-out-of-stock-listing",
    recordId: STOREFRONT_OUT_OF_STOCK_LISTING_RECORD_ID,
    hideOutOfStock,
    ...(offCatalog ? { offCatalog } : {}),
    updatedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  try {
    await storage.put(updated.recordId, updated);
  } catch {
    throw new StorefrontAvailabilityError(
      "STORAGE_UNAVAILABLE",
      "out-of-stock listing update failed",
    );
  }
  return { changed: true, listing: updated };
}
