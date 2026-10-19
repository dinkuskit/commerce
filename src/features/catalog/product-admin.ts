import { isRecord } from "../../shared/record.js";
import {
  normalizeStoredStockManagement,
  setManageStock,
} from "../inventory-provider/kernel/index.js";
import { CatalogError, catalogFail, catalogStorage } from "./errors.js";
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
  MANAGE_STOCK_SETUP_PENDING_MESSAGE,
  type ClerkStockStatus,
} from "./clerk-stock.js";
import {
  loadCatalogItemManualAvailability,
  setCatalogItemManualAvailability,
} from "./manual-availability.js";
import { moneyEquals, saleIsStrictlyLower } from "./money.js";
import { catalogPriceRecord, commitCatalogItemPrice, resolveCatalogItemPrice } from "./price.js";
import type {
  CatalogItemRecord,
  CatalogManualAvailabilityRecord,
  CatalogManualAvailabilityStatus,
  CatalogManualAvailabilityStorage,
  CatalogPriceRecord,
  CatalogPriceStorage,
  CatalogStorageRecord,
  CatalogVariantProduct,
  Money,
} from "./types.js";
import { resolveCatalogVariantMember, variantSelections } from "./variants.js";

export { CLERK_STOCK_STATUSES, type ClerkStockStatus } from "./clerk-stock.js";

const LIST_PAGE_LIMIT = 100;
const LIST_PAGE_CAP = 100;

interface PageResult<T> {
  items: Array<{ id: string; data: T }>;
  cursor?: string;
  hasMore: boolean;
}

interface ManyReader<T> {
  getMany(ids: string[]): Promise<Map<string, T>>;
}

export interface CatalogProductListStorage {
  catalog: ManyReader<CatalogStorageRecord> & {
    get(id: string): Promise<CatalogStorageRecord | null>;
    query(options?: {
      limit?: number;
      cursor?: string;
    }): Promise<PageResult<CatalogStorageRecord>>;
  };
  prices: CatalogPriceStorage & ManyReader<CatalogPriceRecord>;
  availability: CatalogManualAvailabilityStorage & ManyReader<CatalogManualAvailabilityRecord>;
}

/** What the Products list shows for each product. */
export type CatalogProductSummary = Pick<CatalogProductListItem, "catalogItemId" | "name" | "sku" | "archivedAt">;

export interface CatalogProductListItem {
  catalogItemId: string;
  name: string;
  sku: string;
  regular: string | null;
  sale: string | null;
  manageStock: boolean;
  stockStatus: ClerkStockStatus | null;
  gtin?: string;
  mpn?: string;
  brand?: string;
  fulfillment: "physical" | "digital";
  weightOz?: number;
  /** Present when the product is archived: off the shop and not for sale. */
  archivedAt?: string;
  variantProduct?: {
    productId: string;
    revision: number;
    options: CatalogVariantProduct["options"];
    members: readonly CatalogProductVariantListItem[];
  };
}

export interface CatalogProductVariantListItem {
  catalogItemId: string;
  selections: ReturnType<typeof variantSelections>;
  regular: string | null;
  sale: string | null;
  manageStock: boolean;
  stockStatus: ClerkStockStatus | null;
  fulfillment: "physical" | "digital";
  priceRevision: string | null;
  weightOz?: number;
}

export interface SaveCatalogProductPricesInput {
  catalogItemId: string;
  regular: string;
  sale: string;
  manageStock?: boolean;
  stockStatus?: string;
  expectedRevision?: string | null;
}

export interface CatalogProductPriceForm {
  saved: boolean;
  regular: string;
  sale: string;
  manageStock: boolean;
  stockStatus: ClerkStockStatus | null;
  message: string | null;
}

interface CatalogProductSaveCatalogStorage {
  get(id: string): Promise<CatalogStorageRecord | null>;
  getVersioned(
    id: string,
  ): Promise<{ value: CatalogStorageRecord; revision: string } | null>;
  compareAndSet(
    id: string,
    expectedRevision: string | null,
    record: CatalogStorageRecord,
  ): Promise<{ applied: boolean }>;
}

interface SaveStorage {
  catalog: CatalogProductSaveCatalogStorage;
  prices: CatalogPriceStorage;
  availability: CatalogManualAvailabilityStorage;
  /**
   * Native Manage Stock off releases registration claims. Sandbox omits this;
   * v1 admission refuses Manage Stock mutations there.
   */
  releaseRegistrationClaims?: (catalogItemId: string) => Promise<void>;
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
): Promise<Array<{ id: string; data: T }>> {
  const rows: Array<{ id: string; data: T }> = [];
  let cursor: string | undefined;
  for (let page = 0; page < LIST_PAGE_CAP; page += 1) {
    let result: PageResult<T>;
    try {
      result = await query({ limit: LIST_PAGE_LIMIT, cursor });
    } catch (error) {
      catalogFail("STORAGE_UNAVAILABLE", failure, { cause: error });
    }
    rows.push(...result.items);
    if (!result.hasMore) return rows;
    if (result.cursor === undefined || result.cursor === cursor) {
      catalogFail("STORAGE_UNAVAILABLE", failure);
    }
    cursor = result.cursor;
  }
  catalogFail("STORAGE_UNAVAILABLE", failure);
}

function isListedProduct(record: CatalogStorageRecord): record is CatalogItemRecord {
  return record.recordKind === "catalog-item" && !record.variantProductId;
}

function byNameThenSku(left: { name: string; sku: string }, right: { name: string; sku: string }): number {
  return left.name.localeCompare(right.name) || left.sku.localeCompare(right.sku);
}

// Each storage call is one subrequest from the plugin sandbox, which allows only a few per
// call (EmDash's default is 10, Template Store's 32). So a screen reads prices and stock for
// all its products in one call each, never one call per product.
async function readMany<T>(
  collection: ManyReader<T>,
  ids: readonly string[],
  failure: string,
): Promise<(id: string) => Promise<T | null>> {
  const unique = [...new Set(ids)];
  const found = unique.length
    ? await catalogStorage(() => collection.getMany(unique), failure)
    : new Map<string, T>();
  return async (id) => found.get(id) ?? null;
}

async function describeCatalogProducts(
  storage: CatalogProductListStorage,
  records: readonly CatalogItemRecord[],
  catalog: Pick<CatalogProductListStorage["catalog"], "get">,
): Promise<CatalogProductListItem[]> {
  const managed = (record: CatalogItemRecord) =>
    normalizeStoredStockManagement(record.stockManagement).mode === "managed";
  const resolved = new Map<string, Awaited<ReturnType<typeof resolveCatalogVariantMember>>>();
  for (const record of records) {
    for (const member of record.variantProduct?.members ?? []) {
      resolved.set(member.catalogItemId, await resolveCatalogVariantMember(catalog, member.catalogItemId));
    }
  }
  const unmanaged = [
    ...records.filter((record) => !managed(record)).map((record) => record.itemId),
    ...[...resolved].filter(([, member]) => member?.item && !managed(member.item)).map(([id]) => id),
  ];
  const prices = { ...storage.prices, get: await readMany(storage.prices, records.map((record) => record.itemId), "catalog price lookup failed") };
  const availability = { ...storage.availability, get: await readMany(storage.availability, unmanaged, "manual availability lookup failed") };
  const products: CatalogProductListItem[] = [];
  for (const record of records) {
    const price = await resolveCatalogItemPrice(prices, record.itemId);
    const itemManaged = managed(record);
    const stock = itemManaged
      ? null
      : await loadCatalogItemManualAvailability(availability, record.itemId);
    const product: CatalogProductListItem = {
      catalogItemId: record.itemId,
      name: record.name,
      sku: record.sku,
      regular:
        price.listable && price.regular !== undefined
          ? formatClerkDollar(price.regular)
          : null,
      sale: price.sale === undefined ? null : formatClerkDollar(price.sale),
      manageStock: itemManaged,
      stockStatus: stock === null ? null : toClerkStockStatus(stock.status),
      ...(record.gtin ? { gtin: record.gtin } : {}),
      ...(record.mpn ? { mpn: record.mpn } : {}),
      ...(record.brand ? { brand: record.brand } : {}),
      fulfillment: record.fulfillment ?? "physical",
      ...(record.weightOz ? { weightOz: record.weightOz } : {}),
      ...(record.archivedAt ? { archivedAt: record.archivedAt } : {}),
    };
    if (record.variantProduct) {
      const members: CatalogProductVariantListItem[] = [];
      for (const member of record.variantProduct.members) {
        const memberRecord = resolved.get(member.catalogItemId);
        if (!memberRecord?.member || !memberRecord.product) continue;
        // A choice's price form saves against this revision, which only a read of its own returns.
        const priceState = await storage.prices.getVersioned(member.catalogItemId);
        const memberPrice = await resolveCatalogItemPrice({ ...storage.prices, get: async () => priceState?.value ?? null }, member.catalogItemId);
        const memberManaged =
          memberRecord.item.stockManagement && managed(memberRecord.item);
        const memberAvailability = memberManaged
          ? null
          : await loadCatalogItemManualAvailability(availability, member.catalogItemId);
        members.push({
          catalogItemId: member.catalogItemId,
          selections: variantSelections(memberRecord.product, memberRecord.member),
          regular: memberPrice.regular ? formatClerkDollar(memberPrice.regular) : null,
          sale: memberPrice.sale ? formatClerkDollar(memberPrice.sale) : null,
          manageStock: memberManaged,
          stockStatus: memberAvailability ? toClerkStockStatus(memberAvailability.status) : null,
          fulfillment: member.fulfillment,
          priceRevision: priceState?.revision ?? null,
          ...(memberRecord.item.weightOz ? { weightOz: memberRecord.item.weightOz } : {}),
        });
      }
      product.variantProduct = {
        productId: record.variantProduct.productId,
        revision: record.variantProduct.revision,
        options: record.variantProduct.options,
        members,
      };
    }
    products.push(product);
  }
  return products;
}

export async function listCatalogProducts(
  storage: CatalogProductListStorage,
): Promise<{ products: CatalogProductListItem[] }> {
  const rows = await readPages(
    (options) => storage.catalog.query(options),
    "catalog product list failed",
  );
  const byKey = new Map(rows.map((row) => [row.id, row.data]));
  const products = await describeCatalogProducts(
    storage,
    rows.map((row) => row.data).filter(isListedProduct),
    { get: async (id) => byKey.get(id) ?? null },
  );
  return { products: products.sort(byNameThenSku) };
}

/** The Products list: names only, so it costs one storage call per 100 products. */
export async function listCatalogProductSummaries(
  catalog: Pick<CatalogProductListStorage["catalog"], "query">,
): Promise<CatalogProductSummary[]> {
  const rows = await readPages((options) => catalog.query(options), "catalog product list failed");
  return rows.map((row) => row.data).filter(isListedProduct).map((record) => ({
    catalogItemId: record.itemId,
    name: record.name,
    sku: record.sku,
    ...(record.archivedAt ? { archivedAt: record.archivedAt } : {}),
  })).sort(byNameThenSku);
}

/**
 * One product as listCatalogProducts describes it, read by id with its choices, so a product
 * screen costs the same in a store of 5 products or 5,000. Null when it is not a listed product.
 */
export async function loadCatalogProduct(
  storage: CatalogProductListStorage,
  catalogItemId: string,
): Promise<CatalogProductListItem | null> {
  const record = await catalogStorage(() => storage.catalog.get(catalogItemId), "catalog item lookup failed");
  if (!record || !isListedProduct(record) || record.itemId !== catalogItemId) return null;
  const memberIds = (record.variantProduct?.members ?? []).map((member) => member.catalogItemId);
  const members = await readMany(storage.catalog, memberIds.filter((id) => id !== catalogItemId), "catalog item lookup failed");
  const [product] = await describeCatalogProducts(storage, [record], {
    get: async (id) => (id === catalogItemId ? record : members(id)),
  });
  return product ?? null;
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
  if (!isRecord(value)) {
    catalogFail("INVALID_INPUT", "price save input must be an object");
  }
  const input = value as Record<string, unknown>;
  if (typeof input.catalogItemId !== "string" || input.catalogItemId.trim().length === 0) {
    catalogFail("INVALID_INPUT", "catalogItemId must be a non-empty string");
  }
  if (typeof input.regular !== "string" || typeof input.sale !== "string") {
    catalogFail("INVALID_INPUT", "price fields must be strings");
  }
  if (input.stockStatus !== undefined && typeof input.stockStatus !== "string") {
    catalogFail("INVALID_INPUT", "stock status must be a string");
  }
  if (input.manageStock !== undefined && typeof input.manageStock !== "boolean") {
    catalogFail("INVALID_INPUT", "manageStock must be a boolean");
  }
  if (input.expectedRevision !== undefined && input.expectedRevision !== null && typeof input.expectedRevision !== "string") {
    catalogFail("INVALID_INPUT", "invalid price revision");
  }
  return {
    catalogItemId: input.catalogItemId,
    regular: input.regular,
    sale: input.sale,
    manageStock: input.manageStock,
    stockStatus: input.stockStatus,
    expectedRevision: input.expectedRevision as string | null | undefined,
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
    catalogFail("CATALOG_ITEM_NOT_FOUND", "catalog item was not found");
  }

  const currentStockManagement = normalizeStoredStockManagement(item.stockManagement);
  const managed = currentStockManagement.mode === "managed";
  const nextManaged = input.manageStock ?? managed;
  const dormantAvailability = await loadCatalogItemManualAvailability(
    storage.availability,
    catalogItemId,
  );
  const dormantStockStatus = toClerkStockStatus(dormantAvailability.status);
  const currentStockStatus = managed ? null : dormantStockStatus;

  let nextStockStatus = nextManaged ? null : dormantStockStatus;
  if (
    !nextManaged &&
    currentStockManagement.mode === "managed" &&
    currentStockManagement.status === "setup-pending"
  ) {
    return refused(input, MANAGE_STOCK_SETUP_PENDING_MESSAGE, true, null);
  }
  if (nextManaged && managed && input.stockStatus !== undefined) {
    return refused(input, MANAGED_STOCK_STATUS_MESSAGE, true, null);
  }
  if (!nextManaged && input.stockStatus !== undefined) {
    if (!isClerkStockStatus(input.stockStatus)) {
      return refused(
        input,
        CLERK_STOCK_STATUS_MESSAGE,
        nextManaged,
        currentStockStatus,
      );
    }
    nextStockStatus = input.stockStatus;
  }

  const regular = parseClerkDollar(input.regular);
  const sale = parseClerkDollar(input.sale);
  const invalid = invalidMessage(regular, sale);
  if (invalid !== null) {
    return refused(input, invalid, nextManaged, currentStockStatus);
  }

  const targetRegular = regular.status === "amount" ? regular.amount : null;
  const targetSale = sale.status === "amount" ? sale.amount : null;
  const versioned = input.expectedRevision === undefined ? undefined : await storage.prices.getVersioned(catalogItemId);
  const current = await resolveCatalogItemPrice(versioned === undefined ? storage.prices : { ...storage.prices, get: async () => versioned?.value ?? null }, catalogItemId);
  if (versioned !== undefined && (versioned?.revision ?? null) !== input.expectedRevision) {
    catalogFail("COMMAND_CONFLICT", "Price changed; reload before saving");
  }
  const currentRegular = current.regular ?? null;
  const currentSale = current.sale ?? null;

  if (targetSale !== null && targetRegular === null) {
    return refused(
      input,
      currentSale !== null || currentRegular !== null
        ? CLERK_END_SALE_MESSAGE
        : CLERK_SALE_NEEDS_REGULAR_MESSAGE,
      nextManaged,
      currentStockStatus,
    );
  }
  if (
    targetSale !== null &&
    targetRegular !== null &&
    !saleIsStrictlyLower(targetSale, targetRegular)
  ) {
    return refused(input, CLERK_SALE_LOWER_MESSAGE, nextManaged, currentStockStatus);
  }
  const priceUnchanged =
    moneySame(currentRegular, targetRegular) && moneySame(currentSale, targetSale);
  const manageUnchanged = nextManaged === managed;
  const stockUnchanged = nextStockStatus === currentStockStatus;
  if (priceUnchanged && stockUnchanged && manageUnchanged && nextManaged) {
    return displayForm(targetRegular, targetSale, nextManaged, nextStockStatus);
  }

  let priceCommitted = false;
  let committedRevision: string | undefined;
  try {
    if (!priceUnchanged) {
      if (versioned !== undefined) {
        const record = catalogPriceRecord(catalogItemId, targetRegular!, targetSale);
        const applied = targetRegular === null
          ? await storage.prices.compareAndDelete(catalogItemId, versioned!.revision)
          : await storage.prices.compareAndSet(catalogItemId, versioned?.revision ?? null, record);
        if (!applied.applied) catalogFail("COMMAND_CONFLICT", "Price changed; reload before saving");
        if ("revision" in applied && typeof applied.revision === "string") committedRevision = applied.revision;
      } else await commitCatalogItemPrice(storage, {
        catalogItemId,
        regular: targetRegular,
        sale: targetSale,
      });
      priceCommitted = true;
    }
    if (!manageUnchanged) {
      await persistManageStock(storage, item, nextManaged);
    }
    if (!nextManaged && storage.releaseRegistrationClaims) {
      await catalogStorage(() => storage.releaseRegistrationClaims!(catalogItemId), "managed SKU registration claim release failed");
    }
    if (!nextManaged && nextStockStatus !== null && !stockUnchanged) {
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
          committedRevision,
        );
      } catch {
        // Keep the original stock-write error.
      }
    }
    throw error;
  }
  return displayForm(targetRegular, targetSale, nextManaged, nextStockStatus);
}

export interface BulkCatalogProductPriceInput {
  catalogItemId: string;
  regular: string;
  sale: string;
  expectedRevision: string | null;
}

export interface BulkCatalogProductPriceOutcome {
  catalogItemId: string;
  applied: boolean;
  code?: "INVALID_INPUT" | "CATALOG_ITEM_NOT_FOUND" | "CONFLICT" | "STORAGE_UNAVAILABLE";
  message?: string;
}

export async function bulkSaveCatalogProductPrices(
  storage: SaveStorage,
  inputs: readonly BulkCatalogProductPriceInput[],
): Promise<{ outcomes: BulkCatalogProductPriceOutcome[] }> {
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 100) {
    catalogFail("INVALID_INPUT", "bulk price input needs 1-100 rows");
  }
  const outcomes: BulkCatalogProductPriceOutcome[] = [];
  for (const input of inputs) {
    try {
      if (!input || typeof input !== "object" || !Object.hasOwn(input, "expectedRevision")) {
        catalogFail("INVALID_INPUT", "each bulk row needs its loaded price revision");
      }
      if (!(await resolveCatalogVariantMember(storage.catalog, input.catalogItemId))?.member) {
        catalogFail("CATALOG_ITEM_NOT_FOUND", "catalog member is unavailable");
      }
      if (Object.keys(input).some(key => !["catalogItemId", "regular", "sale", "expectedRevision"].includes(key))) {
        catalogFail("INVALID_INPUT", "bulk edits accept price fields only");
      }
      const saved = await saveCatalogProductPrices(storage, input);
      if (!saved.saved) catalogFail("INVALID_INPUT", saved.message ?? "invalid price");
      outcomes.push({ catalogItemId: input.catalogItemId, applied: true });
    } catch (error) {
      const code = error instanceof CatalogError && ["INVALID_INPUT", "CATALOG_ITEM_NOT_FOUND"].includes(error.code)
        ? error.code as BulkCatalogProductPriceOutcome["code"]
        : error instanceof CatalogError && error.code === "COMMAND_CONFLICT"
          ? "CONFLICT"
          : "STORAGE_UNAVAILABLE";
      outcomes.push({ catalogItemId: input?.catalogItemId ?? "", applied: false, code, message: error instanceof Error ? error.message : "bulk price update failed" });
    }
  }
  return { outcomes };
}

async function persistManageStock(
  storage: SaveStorage,
  item: CatalogItemRecord,
  manageStock: boolean,
): Promise<void> {
  const current = normalizeStoredStockManagement(item.stockManagement);
  const nextStockManagement = setManageStock(current, manageStock);
  if (JSON.stringify(current) === JSON.stringify(nextStockManagement)) return;
  const latest = await catalogStorage(() => storage.catalog.getVersioned(item.itemId), "Manage Stock update failed");
  if (latest === null || latest.value.recordKind !== "catalog-item") {
    catalogFail("CATALOG_ITEM_NOT_FOUND", "catalog item was not found");
  }
  const latestState = normalizeStoredStockManagement(latest.value.stockManagement);
  if (
    !manageStock &&
    latestState.mode === "managed" &&
    latestState.status === "setup-pending"
  ) {
    catalogFail("MANAGE_STOCK_SETUP_PENDING", MANAGE_STOCK_SETUP_PENDING_MESSAGE,);
  }
  if (manageStock && latestState.mode === "managed") return;
  const nextItem: CatalogItemRecord = {
    ...latest.value,
    stockManagement: nextStockManagement,
  };
  const applied = await catalogStorage(() => storage.catalog.compareAndSet(
      item.itemId,
      latest.revision,
      nextItem,
    ), "Manage Stock update failed");
  if (!applied.applied) {
    catalogFail("STORAGE_UNAVAILABLE", "Manage Stock lost to concurrent write",);
  }
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
  committedRevision?: string,
): Promise<void> {
  const latest = await storage.prices.getVersioned(catalogItemId);
  if (latest === null || (committedRevision !== undefined && latest.revision !== committedRevision)) return;
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
  await storage.prices.compareAndSet(catalogItemId, latest.revision, catalogPriceRecord(catalogItemId, previousRegular, previousSale));
}
