import { catalogValue, saveProductData, type CatalogReader } from "./product-state.js";
import { isRecord } from "../../shared/record.js";
import { CatalogError, catalogFail, catalogStorage } from "./errors.js";
import { moneyEquals, normalizeMoney, saleIsStrictlyLower } from "./money.js";
import type {
  CatalogItemPriceResolution,
  CatalogPriceRecord,
  CatalogPriceStorage,
  ClearCatalogItemPriceInput,
  Money,
  SetCatalogItemPriceInput,
  SetCatalogItemPriceResult,
  SetCatalogItemPriceStorage,
} from "./types.js";

export function catalogPriceRecord(catalogItemId: string, regular: Money, sale?: Money | null): CatalogPriceRecord {
  return { recordKind: "catalog-price", recordId: catalogItemId, catalogItemId, regular, ...(sale ? { sale } : {}) };
}

function requireCatalogItemId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    catalogFail("INVALID_INPUT", "catalogItemId must be a non-empty string");
  }
  return value.trim();
}

function normalizeSetInput(value: unknown): SetCatalogItemPriceInput {
  if (!isRecord(value)) {
    catalogFail("INVALID_INPUT", "price input must be an object");
  }
  if (Object.keys(value).length !== 2) {
    catalogFail("INVALID_INPUT", "price setting accepts only catalogItemId and amount",);
  }
  return {
    catalogItemId: requireCatalogItemId(value.catalogItemId),
    amount: normalizeMoney(value.amount, "amount"),
  };
}

function normalizeClearInput(value: unknown): ClearCatalogItemPriceInput {
  if (!isRecord(value)) {
    catalogFail("INVALID_INPUT", "price clear input must be an object");
  }
  if (Object.keys(value).length !== 1) {
    catalogFail("INVALID_INPUT", "price clear accepts only catalogItemId");
  }
  return { catalogItemId: requireCatalogItemId(value.catalogItemId) };
}

function invalidStoredPrice(cause?: unknown): never {
  catalogFail("STORAGE_UNAVAILABLE", "stored catalog price is invalid", cause ? { cause } : undefined);
}

function normalizeStoredPrice(
  value: CatalogPriceRecord | null,
  catalogItemId: string,
): CatalogPriceRecord | null {
  if (value === null) return null;
  if (
    value.recordKind !== "catalog-price" ||
    value.recordId !== catalogItemId ||
    value.catalogItemId !== catalogItemId
  ) {
    invalidStoredPrice();
  }
  try {
    const regular = normalizeMoney(value.regular, "stored regular");
    const sale = Object.hasOwn(value, "sale") ? normalizeMoney(value.sale, "stored sale") : undefined;
    if (sale && !saleIsStrictlyLower(sale, regular)) invalidStoredPrice();
    return catalogPriceRecord(catalogItemId, regular, sale);
  } catch (error) {
    if (error instanceof CatalogError && error.code !== "INVALID_INPUT") throw error;
    invalidStoredPrice(error);
  }
}

async function readPrice(
  storage: Pick<CatalogPriceStorage, "get">,
  catalogItemId: string,
  catalog: CatalogReader,
): Promise<CatalogPriceRecord | null> {
  const saved = await catalogValue(catalog, catalogItemId, "price");
  return normalizeStoredPrice(
    saved !== undefined ? saved : await catalogStorage(() => storage.get(catalogItemId), "catalog price lookup failed"),
    catalogItemId,
  );
}

async function requireCatalogItem(
  storage: SetCatalogItemPriceStorage["catalog"],
  catalogItemId: string,
): Promise<void> {
  const item = await catalogStorage(() => storage.get(catalogItemId), "catalog item lookup failed");
  if (item === null || item.recordKind !== "catalog-item") {
    catalogFail("CATALOG_ITEM_NOT_FOUND", "catalog item was not found");
  }
  if (item.itemId !== catalogItemId) {
    catalogFail("STORAGE_UNAVAILABLE", "stored catalog item identity does not match its key");
  }
}

async function changePrice(
  storage: SetCatalogItemPriceStorage,
  catalogItemId: string,
  decide: (existing: CatalogPriceRecord | null) => CatalogPriceRecord | null | undefined,
): Promise<SetCatalogItemPriceResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await saveProductData(storage.catalog, catalogItemId, async (data) => {
    const values = data.items[catalogItemId] ?? {};
    const existing = normalizeStoredPrice(Object.hasOwn(values, "price") ? values.price! : await storage.prices.get(catalogItemId), catalogItemId);
    const next = decide(existing);
    if (next === undefined) return { changed: false, price: existing };
    data.items[catalogItemId] = { ...values, price: next };
    return { changed: true, price: next };
  }); } catch (error) {
      if (!(error instanceof CatalogError) || error.code !== "COMMAND_CONFLICT" || attempt === 1) throw error;
    }
  }
  throw new Error("unreachable price retry");
}

export async function loadCatalogItemPrice(
  storage: CatalogPriceStorage,
  catalogItemId: string,
  catalog: CatalogReader,
): Promise<CatalogPriceRecord | null> {
  return readPrice(storage, catalogItemId, catalog);
}

export async function resolveCatalogItemPrice(
  storage: CatalogPriceStorage,
  catalogItemId: string,
  catalog: CatalogReader,
): Promise<CatalogItemPriceResolution> {
  const id = requireCatalogItemId(catalogItemId);
  const price = await readPrice(storage, id, catalog);
  return price === null
    ? { catalogItemId: id, listable: false }
    : {
        catalogItemId: id,
        listable: true,
        regular: price.regular,
        ...(price.sale ? { sale: price.sale } : {}),
        customerPays: price.sale ?? price.regular,
      };
}

export async function commitCatalogItemPrice(
  storage: SetCatalogItemPriceStorage,
  input: { catalogItemId: string; regular: Money | null; sale: Money | null },
): Promise<CatalogPriceRecord | null> {
  if (input.sale && (!input.regular || !saleIsStrictlyLower(input.sale, input.regular)))
    catalogFail("SALE_NOT_LOWER_THAN_REGULAR", "Sale must be lower than Regular");
  return (await changePrice(storage, input.catalogItemId, () => input.regular ? catalogPriceRecord(input.catalogItemId, input.regular, input.sale) : null)).price;
}

export async function setCatalogItemRegularPrice(
  storage: SetCatalogItemPriceStorage,
  rawInput: unknown,
): Promise<SetCatalogItemPriceResult> {
  const input = normalizeSetInput(rawInput);
  return changePrice(storage, input.catalogItemId, (existing) => {
    if (existing?.sale !== undefined && !saleIsStrictlyLower(existing.sale, input.amount)) {
      catalogFail("SALE_NOT_LOWER_THAN_REGULAR", "Sale must be strictly lower than Regular");
    }
    if (existing !== null && moneyEquals(existing.regular, input.amount)) {
      return undefined;
    }
    return catalogPriceRecord(input.catalogItemId, input.amount, existing?.sale);
  });
}

export async function setCatalogItemSalePrice(
  storage: SetCatalogItemPriceStorage,
  rawInput: unknown,
): Promise<SetCatalogItemPriceResult> {
  const input = normalizeSetInput(rawInput);
  return changePrice(storage, input.catalogItemId, (existing) => {
    if (existing === null) {
      catalogFail("SALE_REQUIRES_REGULAR", "Sale cannot be set until Regular exists");
    }
    if (!saleIsStrictlyLower(input.amount, existing.regular)) {
      catalogFail("SALE_NOT_LOWER_THAN_REGULAR", "Sale must be strictly lower than Regular");
    }
    if (existing.sale !== undefined && moneyEquals(existing.sale, input.amount)) {
      return undefined;
    }
    return catalogPriceRecord(input.catalogItemId, existing.regular, input.amount);
  });
}

export async function clearCatalogItemSalePrice(
  storage: SetCatalogItemPriceStorage,
  rawInput: unknown,
): Promise<SetCatalogItemPriceResult> {
  const input = normalizeClearInput(rawInput);
  return changePrice(storage, input.catalogItemId, (existing) =>
    existing === null || existing.sale === undefined
      ? undefined
      : catalogPriceRecord(input.catalogItemId, existing.regular),
  );
}

export async function clearCatalogItemRegularPrice(
  storage: SetCatalogItemPriceStorage,
  rawInput: unknown,
): Promise<SetCatalogItemPriceResult> {
  const input = normalizeClearInput(rawInput);
  return changePrice(storage, input.catalogItemId, (existing) => {
    if (existing === null) {
      return undefined;
    }
    if (existing.sale !== undefined) {
      catalogFail("REGULAR_HAS_SALE", "Regular cannot be cleared while Sale exists");
    }
    return null;
  });
}
