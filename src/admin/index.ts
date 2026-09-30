import type { Block, BlockResponse } from "@emdash-cms/blocks";
import type { PluginContext, SandboxedRouteContext } from "emdash/plugin";
import type { StorageCollection } from "emdash";
import {
  CatalogError, createCatalogItem, catalogProductCreateInput, listCatalogProducts,
  saveCatalogProductPrices, loadCatalogItemManualAvailability,
  type CatalogStorageRecord, type CatalogPriceRecord, type CatalogManualAvailabilityRecord,
  type CatalogProductPriceForm,
} from "../features/catalog/kernel/index.js";
import { type ManagedSkuRegistrationClaimRecord } from "../features/inventory-provider/index.js";
import {
  loadOutOfStockListing, setOutOfStockListing, StorefrontAvailabilityError,
  type StorefrontOutOfStockListingRecord,
} from "../features/storefront-availability/kernel/index.js";

const PAGE_SIZE = 25;
const STOCK_OPTIONS = [
  { label: "In stock", value: "in-stock" },
  { label: "Out of stock", value: "out-of-stock" },
  { label: "On backorder", value: "on-backorder" },
];
function storage(ctx: PluginContext) {
  return {
    catalog: ctx.storage["catalog_items"] as StorageCollection<CatalogStorageRecord>,
    prices: ctx.storage["catalog_prices"] as StorageCollection<CatalogPriceRecord>,
    availability: ctx.storage["catalog_manual_availability"] as StorageCollection<CatalogManualAvailabilityRecord>,
    claims: ctx.storage["managed_sku_claims"] as StorageCollection<ManagedSkuRegistrationClaimRecord>,
  };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid form");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length > 1024) throw new Error("Invalid field");
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid checkbox");
  return value;
}
function message(error: unknown): string {
  return error instanceof CatalogError || error instanceof StorefrontAvailabilityError
    ? error.message : "Could not complete the request. Reload and try again.";
}
function alert(message: string): Block {
  return { type: "banner", title: message, variant: "error" };
}
function navigation(): Block {
  return { type: "actions", elements: [
    { type: "link", label: "Products", target: { kind: "plugin-page", path: "/products" } },
    { type: "link", label: "Settings", target: { kind: "plugin-page", path: "/settings" } },
  ] };
}
function addForm(commandId: string = crypto.randomUUID(), name = "", sku = ""): Block[] {
  return [
    { type: "header", text: "Add product" },
    { type: "context", text: "Name is the customer-facing product title (the product page heading). New products start with Manage stock off." },
    { type: "form", block_id: "create-" + commandId, fields: [
      { type: "text_input", action_id: "name", label: "Name", initial_value: name },
      { type: "text_input", action_id: "sku", label: "SKU", initial_value: sku },
    ], submit: { label: "Add product", action_id: "create:" + commandId } },
  ];
}
async function products(ctx: PluginContext, offset = 0): Promise<BlockResponse> {
  const { products } = await listCatalogProducts(storage(ctx));
  const start = Math.min(offset, Math.max(0, Math.floor((products.length - 1) / PAGE_SIZE) * PAGE_SIZE));
  const blocks: Block[] = [{ type: "header", text: "Products" }, { type: "context", text: "Commerce" }, navigation(),
    ...addForm(), { type: "divider" }];
  for (const product of products.slice(start, start + PAGE_SIZE)) {
    blocks.push({ type: "section", text: product.name + " — " + product.sku,
      accessory: { type: "button", label: "Open " + product.name, action_id: "open", value: product.catalogItemId } });
  }
  if (!products.length) blocks.push({ type: "empty", title: "No products yet", description: "Add your first product above." });
  const paging: Block & { type: "actions" } = { type: "actions", elements: [] };
  if (start > 0) paging.elements.push({ type: "button", label: "Previous", action_id: "list", value: start - PAGE_SIZE });
  if (start + PAGE_SIZE < products.length) paging.elements.push({ type: "button", label: "Next", action_id: "list", value: start + PAGE_SIZE });
  if (paging.elements.length) blocks.push(paging);
  return { blocks };
}
type ProductFields = Pick<CatalogProductPriceForm, "regular" | "sale" | "manageStock" | "stockStatus">;
function productForm(id: string, values: ProductFields): Block {
  return { type: "form", block_id: "product-" + id + "-" + crypto.randomUUID(), fields: [
      { type: "text_input", action_id: "regular", label: "Regular", initial_value: values.regular },
      { type: "text_input", action_id: "sale", label: "Sale", initial_value: values.sale },
      { type: "toggle", action_id: "manageStock", label: "Manage stock", initial_value: values.manageStock,
        description: "Turning this on requires Inventory setup. It does not connect Inventory or change a quantity." },
      { type: "radio", action_id: "stockStatus", label: "Stock status", options: STOCK_OPTIONS,
        initial_value: values.stockStatus ?? undefined, condition: { field: "manageStock", eq: false } },
    ], submit: { label: "Save", action_id: "save:" + id } };
}
async function product(ctx: PluginContext, id: string, form?: CatalogProductPriceForm): Promise<BlockResponse> {
  const store = storage(ctx);
  const listed = await listCatalogProducts(store);
  const selected = listed.products.find((item) => item.catalogItemId === id);
  if (!selected) throw new CatalogError("CATALOG_ITEM_NOT_FOUND", "Product was not found. Return to Products.");
  const dormant = await loadCatalogItemManualAvailability(store.availability, id);
  const status = dormant.status === "available-on-backorder" ? "on-backorder" : dormant.status;
  const values = form ?? { regular: selected.regular ?? "", sale: selected.sale ?? "", manageStock: selected.manageStock, stockStatus: selected.stockStatus };
  return { blocks: [
    { type: "header", text: selected.name }, { type: "context", text: "Commerce / Products" }, navigation(),
    { type: "context", text: "SKU: " + selected.sku },
    ...(form?.message ? [alert(form.message)] : []),
    productForm(id, { ...values, stockStatus: values.stockStatus ?? status }),
  ] };
}
function settingsResponse(hideOutOfStock: boolean, failure?: string): BlockResponse {
  return { blocks: [
    { type: "header", text: "Commerce settings" }, navigation(), { type: "header", text: "Catalog" },
    ...(failure ? [alert(failure), { type: "context" as const, text: "Save was not confirmed. Your choice is retained; review or retry." }] : []),
    { type: "form", block_id: "catalog-settings-" + crypto.randomUUID(), fields: [
      { type: "toggle", action_id: "hideOutOfStock", label: "Hide out-of-stock products", initial_value: hideOutOfStock },
    ], submit: { label: "Save", action_id: "settings.save" } },
  ] };
}
async function settings(ctx: PluginContext): Promise<BlockResponse> {
  const listing = await loadOutOfStockListing(ctx.storage["storefront_out_of_stock_listing"] as StorageCollection<StorefrontOutOfStockListingRecord>);
  return settingsResponse(listing.hideOutOfStock);
}

/** Private Block Kit transport. The host authenticates and authorizes this route. */
export async function commerceAdmin(route: SandboxedRouteContext, ctx: PluginContext): Promise<BlockResponse> {
  let input: Record<string, unknown> = {};
  let values: Record<string, unknown> = {};
  try {
    input = object(route.input);
    if (input.type === "page_load") {
      if (input.page === "/products") return await products(ctx);
      if (input.page === "/settings") return await settings(ctx);
      throw new Error("Unknown page");
    }
    const action = text(input.action_id);
    if (input.type === "block_action") {
      if (action === "open") return await product(ctx, text(input.value));
      if (action === "list") {
        const offset = input.value ?? 0;
        if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000) throw new Error("Invalid page");
        return await products(ctx, offset);
      }
    }
    if (input.type === "form_submit") {
      values = object(input.values);
      if (action.startsWith("create:")) {
        const commandId = action.slice(7);
        const created = await createCatalogItem(storage(ctx).catalog,
          catalogProductCreateInput(text(values.name), text(values.sku), commandId), { collection: "catalog_items" });
        return { ...await product(ctx, created.item.itemId), toast: { type: "success", message: "Product added" } };
      }
      if (action.startsWith("save:")) {
        const id = action.slice(5);
        const store = storage(ctx);
        const item = await store.catalog.get(id);
        const manageStock = bool(values.manageStock);
        // The form starts at the persisted dormant status, even while hidden.
        // Honor a submitted choice on disable; omission restores the dormant value.
        const wasManaged = item?.recordKind === "catalog-item" && item.stockManagement?.mode === "managed";
        const saved = await saveCatalogProductPrices(store, { catalogItemId: id,
          regular: text(values.regular), sale: text(values.sale), manageStock,
          ...(!manageStock && (!wasManaged || values.stockStatus !== undefined)
            ? { stockStatus: text(values.stockStatus) } : {}),
        });
        return { ...await product(ctx, id, saved), toast: { type: saved.saved ? "success" : "error", message: saved.message ?? "Product saved" } };
      }
      if (action === "settings.save") {
        await setOutOfStockListing(ctx.storage["storefront_out_of_stock_listing"] as StorageCollection<StorefrontOutOfStockListingRecord>,
          { hideOutOfStock: bool(values.hideOutOfStock) });
        return { ...await settings(ctx), toast: { type: "success", message: "Settings saved" } };
      }
    }
    throw new Error("Unknown interaction");
  } catch (error) {
    const failure = message(error);
    // Preserve clerk input for a refused create; retry uses the same command identity.
    if (input.type === "form_submit" && typeof input.action_id === "string" && input.action_id.startsWith("create:") &&
        typeof values.name === "string" && values.name.length <= 1024 && typeof values.sku === "string" && values.sku.length <= 1024) {
      return { blocks: [{ type: "header", text: "Products" }, navigation(), alert(failure),
        ...addForm(input.action_id.slice(7), values.name, values.sku)], toast: { type: "error", message: failure } };
    }
    // Recovery is render-only: even a storage outage must not erase clerk input.
    if (input.type === "form_submit" && typeof input.action_id === "string" && input.action_id.length <= 1024) {
      if (input.action_id.startsWith("save:") && typeof values.regular === "string" && values.regular.length <= 1024 &&
          typeof values.sale === "string" && values.sale.length <= 1024 && typeof values.manageStock === "boolean") {
        const status = STOCK_OPTIONS.some(option => option.value === values.stockStatus)
          ? values.stockStatus as ProductFields["stockStatus"] : null;
        return { blocks: [
          { type: "header", text: "Product changes" }, { type: "context", text: "Commerce / Products" }, navigation(),
          alert(failure), { type: "context", text: "Save was not confirmed. Your entries are retained; review or retry." },
          productForm(input.action_id.slice(5), { regular: values.regular, sale: values.sale, manageStock: values.manageStock, stockStatus: status }),
        ], toast: { type: "error", message: failure } };
      }
      if (input.action_id === "settings.save" && typeof values.hideOutOfStock === "boolean") {
        return { ...settingsResponse(values.hideOutOfStock, failure), toast: { type: "error", message: failure } };
      }
    }
    return { blocks: [navigation(), alert(failure)], toast: { type: "error", message: failure } };
  }
}
