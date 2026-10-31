import { catalogItemState, productData, saveProductData } from "./product-state.js";
import { normalizeProductFeedChannels } from "../feeds/kernel/index.js";
import { isRecord } from "../../shared/record.js";
import { REGISTRY_BUILD } from "../../shared/registry-build.js";
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
import { catalogPriceRecord, resolveCatalogItemPrice } from "./price.js";
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
import { MANAGE_STOCK_UNAVAILABLE_MESSAGE } from "./v1-stock-admission.js";

export { CLERK_STOCK_STATUSES, type ClerkStockStatus } from "./clerk-stock.js";

const LIST_PAGE_LIMIT = 100;
const LIST_PAGE_CAP = 100;

interface PageResult<T> {
  items: Array<{ id: string; data: T }>;
  cursor?: string;
  hasMore: boolean;
}

// getMany is optional so adapters written for 0.2.x, with get only, keep working.
interface ManyReader<T> {
  get(id: string): Promise<T | null>;
  getMany?(ids: string[]): Promise<Map<string, T>>;
}

export interface CatalogProductListStorage {
  catalog: ManyReader<CatalogStorageRecord> & {
    getVersioned?(id: string): Promise<{ value: CatalogStorageRecord; revision: string } | null>;
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
  revision?: string;
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
  /** Present while the product is a Draft, until its page is published. */
  offSale?: true;
  variantProduct?: {
    productId: string;
    revision: number;
    options: CatalogVariantProduct["options"];
    members: readonly CatalogProductVariantListItem[];
  };
}

export interface CatalogProductVariantListItem {
  catalogItemId: string;
  sku: string;
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
  feedChannels?: string[];
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
  if (!collection.getMany) return (id) => collection.get(id);
  const found = unique.length
    ? await catalogStorage(() => collection.getMany!(unique), failure)
    : new Map<string, T>();
  return async (id) => found.get(id) ?? null;
}

async function describeCatalogProducts(
  storage: CatalogProductListStorage,
  records: readonly CatalogItemRecord[],
  catalog: Pick<CatalogProductListStorage["catalog"], "get">,
  revisionFor?: (id: string) => string | undefined,
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
  const prices = { ...storage.prices, get: await readMany(storage.prices, [...records.map((record) => record.itemId), ...resolved.keys()], "catalog price lookup failed") };
  const availability = { ...storage.availability, get: await readMany(storage.availability, unmanaged, "manual availability lookup failed") };
  const products: CatalogProductListItem[] = [];
  for (const record of records) {
    const revision = revisionFor?.(record.itemId);
    const weightOz = catalogItemState(record, record).weightOz;
    const price = await resolveCatalogItemPrice(prices, record.itemId, catalog);
    const itemManaged = managed(record);
    const stock = itemManaged
      ? null
      : await loadCatalogItemManualAvailability(availability, record.itemId, catalog);
    const product: CatalogProductListItem = {
      catalogItemId: record.itemId,
      ...(revision ? { revision: "catalog:" + revision } : {}),
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
      ...(weightOz ? { weightOz } : {}),
      ...(record.archivedAt ? { archivedAt: record.archivedAt } : {}),
      ...(record.offSale ? { offSale: true as const } : {}),
    };
    if (record.variantProduct) {
      const members: CatalogProductVariantListItem[] = [];
      for (const member of record.variantProduct.members) {
        const memberRecord = resolved.get(member.catalogItemId);
        if (!memberRecord?.member || !memberRecord.product) continue;
        // Every choice saves against the same product snapshot.
        const priceState = revision ? { value: await prices.get(member.catalogItemId), revision: "catalog:" + revision } : await storage.prices.getVersioned(member.catalogItemId);
        const memberPrice = await resolveCatalogItemPrice({ ...storage.prices, get: async () => priceState?.value ?? null }, member.catalogItemId, catalog);
        const memberManaged =
          memberRecord.item.stockManagement && managed(memberRecord.item);
        const memberAvailability = memberManaged
          ? null
          : await loadCatalogItemManualAvailability(availability, member.catalogItemId, catalog);
        members.push({
          catalogItemId: member.catalogItemId,
          sku: memberRecord.item.sku,
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
  const revisions = new Map<string, string>();
  const records: CatalogItemRecord[] = [];
  for (const row of rows) {
    if (!isListedProduct(row.data)) continue;
    const current = storage.catalog.getVersioned
      ? await catalogStorage(() => storage.catalog.getVersioned!(row.id), "catalog item lookup failed")
      : undefined;
    if (current === null) continue;
    const record = current?.value ?? row.data;
    if (!isListedProduct(record)) continue;
    byKey.set(row.id, record);
    if (current) revisions.set(row.id, current.revision);
    records.push(record);
  }
  const products = await describeCatalogProducts(
    storage, records,
    { get: async (id) => byKey.get(id) ?? storage.catalog.get(id) },
    (id) => revisions.get(id),
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
  const versioned = storage.catalog.getVersioned ? await catalogStorage(() => storage.catalog.getVersioned!(catalogItemId), "catalog item lookup failed") : undefined;
  const record = versioned === undefined ? await catalogStorage(() => storage.catalog.get(catalogItemId), "catalog item lookup failed") : versioned?.value;
  if (!record || !isListedProduct(record) || record.itemId !== catalogItemId) return null;
  const memberIds = (record.variantProduct?.members ?? []).map((member) => member.catalogItemId);
  const members = await readMany(storage.catalog, memberIds.filter((id) => id !== catalogItemId), "catalog item lookup failed");
  const [product] = await describeCatalogProducts(storage, [record], {
    get: async (id) => (id === catalogItemId ? record : members(id)),
  }, () => versioned?.revision);
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
    ...(input.feedChannels === undefined ? {} : { feedChannels: normalizeProductFeedChannels(input.feedChannels) }),
  };
}

export async function saveCatalogProductPrices(
  storage: SaveStorage,
  rawInput: unknown,
): Promise<CatalogProductPriceForm> {
  const input = normalizeSaveInput(rawInput);
  const id = input.catalogItemId.trim();
  const saved = await saveProductData(storage.catalog, id, async (data, item, root) => {
    const management = normalizeStoredStockManagement(item.stockManagement);
    const managed = management.mode === "managed", nextManaged = input.manageStock ?? managed;
    const current = data.items[id] ?? {};
    const snapshot = { get: async (key: string) => key === id ? item : key === root.itemId ? root : null };
    const availability = await loadCatalogItemManualAvailability(storage.availability, id, snapshot);
    const status = toClerkStockStatus(availability.status);
    if (!nextManaged && management.mode === "managed" && management.status === "setup-pending")
      return refused(input, MANAGE_STOCK_SETUP_PENDING_MESSAGE, true, null);
    if (nextManaged && managed && input.stockStatus !== undefined)
      return refused(input, MANAGED_STOCK_STATUS_MESSAGE, true, null);
    if (!nextManaged && input.stockStatus !== undefined && !isClerkStockStatus(input.stockStatus))
      return refused(input, CLERK_STOCK_STATUS_MESSAGE, nextManaged, managed ? null : status);
    const regular = parseClerkDollar(input.regular), sale = parseClerkDollar(input.sale);
    const invalid = invalidMessage(regular, sale);
    if (invalid) return refused(input, invalid, nextManaged, managed ? null : status);
    const targetRegular = regular.status === "amount" ? regular.amount : null;
    const targetSale = sale.status === "amount" ? sale.amount : null;
    const existing = await resolveCatalogItemPrice(storage.prices, id, snapshot);
    if (input.expectedRevision !== undefined && !input.expectedRevision?.startsWith("catalog:")) {
      if (Object.hasOwn(current, "price") || ((await storage.prices.getVersioned(id))?.revision ?? null) !== input.expectedRevision)
        catalogFail("COMMAND_CONFLICT", "Price changed; reload before saving");
    }
    if (targetSale && !targetRegular)
      return refused(input, existing?.regular ? CLERK_END_SALE_MESSAGE : CLERK_SALE_NEEDS_REGULAR_MESSAGE, nextManaged, managed ? null : status);
    if (targetSale && targetRegular && !saleIsStrictlyLower(targetSale, targetRegular))
      return refused(input, CLERK_SALE_LOWER_MESSAGE, nextManaged, managed ? null : status);
    if (nextManaged !== managed) {
      if (REGISTRY_BUILD) catalogFail("MANAGE_STOCK_UNAVAILABLE", MANAGE_STOCK_UNAVAILABLE_MESSAGE);
      if (root.itemId === item.itemId) root.stockManagement = setManageStock(management, nextManaged);
      else current.stockManagement = setManageStock(management, nextManaged);
    }

    const nextStatus = nextManaged ? null : input.stockStatus as ClerkStockStatus | undefined ?? status;
    data.items[id] = { ...current, price: targetRegular ? catalogPriceRecord(id, targetRegular, targetSale) : null,
      availability: { ...availability, status: toStoredStockStatus(nextStatus ?? status) } };
    if (input.feedChannels !== undefined) data.feedChannels = input.feedChannels;
    return displayForm(targetRegular, targetSale, nextManaged, nextStatus);
  }, input.expectedRevision?.startsWith("catalog:") ? input.expectedRevision : undefined);
  if (!REGISTRY_BUILD && saved.saved && !saved.manageStock && storage.releaseRegistrationClaims) {
    try { await storage.releaseRegistrationClaims(id); }
    catch { return { ...saved, message: "Product saved. Inventory claim cleanup is pending; save again to retry cleanup." }; }
  }
  return saved;
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
  const outcomes: BulkCatalogProductPriceOutcome[] = new Array(inputs.length);
  const groups = new Map<string, number[]>();
  const refuse = (index: number, error: unknown) => {
    const code = error instanceof CatalogError && ["INVALID_INPUT", "CATALOG_ITEM_NOT_FOUND"].includes(error.code)
      ? error.code as BulkCatalogProductPriceOutcome["code"]
      : error instanceof CatalogError && error.code === "COMMAND_CONFLICT"
        ? "CONFLICT" : "STORAGE_UNAVAILABLE";
    outcomes[index] = { catalogItemId: inputs[index]?.catalogItemId ?? "", applied: false, code,
      message: error instanceof Error ? error.message : "bulk price update failed" };
  };
  for (const [index, input] of inputs.entries()) {
    try {
      if (!input || typeof input !== "object" || !Object.hasOwn(input, "expectedRevision"))
        catalogFail("INVALID_INPUT", "each bulk row needs its loaded price revision");
      if (Object.keys(input).some(key => !["catalogItemId", "regular", "sale", "expectedRevision"].includes(key)))
        catalogFail("INVALID_INPUT", "bulk edits accept price fields only");
      const resolved = await resolveCatalogVariantMember(storage.catalog, input.catalogItemId);
      if (!resolved?.member || !resolved.product)
        catalogFail("CATALOG_ITEM_NOT_FOUND", "catalog member is unavailable");
      const id = resolved.product.productId;
      groups.set(id, [...(groups.get(id) ?? []), index]);
    } catch (error) { refuse(index, error); }
  }
  for (const [id, indices] of groups) {
    const accepted = new Map<number, boolean>();
    try {
      // Stage siblings against one unchanged revision, then publish them with one CAS.
      await saveProductData(storage.catalog, id, async (data, _item, root) => {
        const snapshot = await storage.catalog.getVersioned(id);
        if (!snapshot || JSON.stringify(snapshot.value) !== JSON.stringify(root))
          catalogFail("COMMAND_CONFLICT", "Product changed; reload before saving");
        let staged: CatalogStorageRecord = root;
        const catalog: CatalogProductSaveCatalogStorage = {
          get: async (key) => key === id ? staged : storage.catalog.get(key),
          getVersioned: async (key) => key === id ? { value: staged, revision: snapshot.revision } : storage.catalog.getVersioned(key),
          compareAndSet: async (key, revision, value) => {
            if (key !== id || revision !== snapshot.revision) return { applied: false };
            staged = value;
            return { applied: true };
          },
        };
        for (const index of indices) {
          try {
            const saved = await saveCatalogProductPrices({ ...storage, catalog, releaseRegistrationClaims: undefined }, inputs[index]);
            if (!saved.saved) catalogFail("INVALID_INPUT", saved.message ?? "invalid price");
            accepted.set(index, saved.manageStock);
          } catch (error) { refuse(index, error); }
        }
        if (staged.recordKind === "catalog-item") Object.assign(data, productData(staged));
      });
      for (const [index, managed] of accepted) {
        const catalogItemId = inputs[index].catalogItemId;
        const outcome: BulkCatalogProductPriceOutcome = { catalogItemId, applied: true };
        if (!managed && storage.releaseRegistrationClaims) {
          try { await storage.releaseRegistrationClaims(catalogItemId); }
          catch { outcome.message = "Product saved. Inventory claim cleanup is pending; save again to retry cleanup."; }
        }
        outcomes[index] = outcome;
      }
    } catch (error) {
      for (const index of indices) if (!outcomes[index]) refuse(index, error);
    }
  }
  return { outcomes };
}
