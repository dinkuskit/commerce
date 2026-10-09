import { pageOffset, pagination, navigation } from './blocks.js';
import type { Block, BlockResponse } from "@emdash-cms/blocks";
import type { PluginContext, SandboxedRouteContext } from "emdash/plugin";
import type { StorageCollection } from "emdash";
import {
  CatalogError, createCatalogItem, catalogProductCreateInput, listCatalogProducts,
  saveCatalogProductPrices, loadCatalogItemManualAvailability, loadCatalogItemMedia, saveCatalogItemMedia,
  admitV1CatalogCreateInput, admitV1CatalogPriceSaveInput, isManagedCatalogRecord, CATALOG_GALLERY_LIMIT,
  addCatalogVariantOption, bulkSaveCatalogProductPrices, updateCatalogVariantLabels,
  type CatalogStorageRecord, type CatalogPriceRecord, type CatalogManualAvailabilityRecord,
  type CatalogProductPriceForm, type CatalogProductListItem, type CatalogMediaRecord, type CatalogMediaStorage, type MediaReference,
} from "../features/catalog/kernel/index.js";
import { type ManagedSkuRegistrationClaimRecord } from "../features/inventory-provider/index.js";
import {
  loadOutOfStockListing, setOutOfStockListing, loadStorefrontPlaceholderImage, setStorefrontPlaceholderImage,
  StorefrontAvailabilityError, type StorefrontOutOfStockListingRecord, type StorefrontPlaceholderImageStorage,
} from "../features/storefront-availability/kernel/index.js";
import { ordersInteraction, ordersBlocks } from "./orders-blocks.js";
import { loadProductFeedEligibility, setProductFeedEligibility } from "../features/feeds/eligibility.js";
import type {
  ProductFeedChannel,
  ProductFeedEligibilityRecord,
} from "../features/feeds/types.js";

const PAGE_SIZE = 25;
const LIBRARY_PAGE = 12;
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
    media: ctx.storage["catalog_media"] as CatalogMediaStorage,
    feedEligibility: ctx.storage["product_feed_eligibility"] as StorageCollection<ProductFeedEligibilityRecord>,
  };
}
function placeholderStorage(ctx: PluginContext) {
  return ctx.storage["storefront_placeholder_image"] as StorefrontPlaceholderImageStorage;
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

function addForm(commandId: string = crypto.randomUUID(), name = "", sku = ""): Block[] {
  return [
    { type: "header", text: "Add product" },
    { type: "context", text: "Name is the customer-facing product title (the product page heading). New products stay unmanaged. Manage stock is coming soon." },
    { type: "form", block_id: "create-" + commandId, fields: [
      { type: "text_input", action_id: "name", label: "Name", initial_value: name },
      { type: "text_input", action_id: "sku", label: "SKU", initial_value: sku },
      { type: "radio", action_id: "fulfillment", label: "Fulfillment", options: FULFILLMENT },
    ], submit: { label: "Add product", action_id: "create:" + commandId } },
  ];
}
async function products(ctx: PluginContext, offset = 0): Promise<BlockResponse> {
  const { products } = await listCatalogProducts(storage(ctx));
  const start = pageOffset(offset, products.length);
  const blocks: Block[] = [{ type: "header", text: "Products" }, { type: "context", text: "Commerce" }, navigation(),
    ...addForm(), { type: "divider" }];
  for (const product of products.slice(start, start + PAGE_SIZE)) {
    blocks.push({ type: "section", text: product.name + " — " + product.sku,
      accessory: { type: "button", label: "Open " + product.name, action_id: "open", value: product.catalogItemId } });
  }
  if (!products.length) blocks.push({ type: "empty", title: "No products yet", description: "Add your first product above." });
  pagination(blocks, start, products.length, 'list');
  return { blocks };
}
type ProductFields = {
  regular: CatalogProductPriceForm["regular"];
  sale: CatalogProductPriceForm["sale"];
  manageStock: boolean | null;
  stockStatus: CatalogProductPriceForm["stockStatus"];
  feedChannels?: readonly ProductFeedChannel[];
};
// Registry/sandbox Block Kit 1.2.0 ToggleElement has no disabled field and never
// forwards disabled to Kumo Switch. Emitting a live toggle would not fulfill the
// requested disabled slider. This notice is an honest temporary fallback.
function manageStockNotice(managed: boolean | null): Block {
  return {
    type: "context",
    text: managed === true
      ? "Manage stock — Coming soon. This product stays managed; tracking cannot be changed."
      : managed === false
        ? "Manage stock — Coming soon"
        : "Manage stock — Coming soon. Manual status is hidden until stored tracking can be proven.",
  };
}
function productForm(id: string, values: ProductFields, action = "save:" + id): Block {
  return { type: "form", block_id: "product-" + id + "-" + crypto.randomUUID(), fields: [
      { type: "text_input", action_id: "regular", label: "Regular", initial_value: values.regular },
      { type: "text_input", action_id: "sale", label: "Sale", initial_value: values.sale },
      ...(values.manageStock === false ? [{ type: "radio" as const, action_id: "stockStatus", label: "Stock status", options: STOCK_OPTIONS,
        initial_value: values.stockStatus ?? undefined }] : []),
      ...(values.feedChannels === undefined ? [] : [
        { type: "toggle" as const, action_id: "feed:google-merchant", label: "Google Merchant", initial_value: values.feedChannels.includes("google-merchant") },
        { type: "toggle" as const, action_id: "feed:meta-catalog", label: "Meta catalog", initial_value: values.feedChannels.includes("meta-catalog") },
      ]),
    ], submit: { label: "Save", action_id: action } };
}
const FULFILLMENT = [{ label: "Physical", value: "physical" }, { label: "Digital", value: "digital" }];
function variantEditor(id: string, variant: CatalogProductListItem["variantProduct"]): Block[] {
  if (!variant?.options.length) return [{
    type: "form", block_id: "variant-add-" + id, fields: [
      { type: "text_input", action_id: "optionLabel", label: "Option (for example Size)", initial_value: "Size" },
      { type: "text_input", action_id: "smallLabel", label: "First value", initial_value: "Small" },
      { type: "text_input", action_id: "largeLabel", label: "Second value", initial_value: "Large" },
      { type: "text_input", action_id: "sku", label: "Second SKU" },
      ...["first", "second"].map(key => ({ type: "radio" as const, action_id: key, label: key === "first" ? "First fulfillment" : "Second fulfillment", options: FULFILLMENT })),
    ], submit: { label: "Add choices", action_id: "variant:" + JSON.stringify(["add", id, ...Array.from({ length: 4 }, () => crypto.randomUUID())]) },
  }];
  const label = (m: typeof variant.members[number]) => m.selections.map(s => s.valueLabel).join(" / ");
  return [
    ...variant.members.flatMap(m => [
      { type: "header" as const, text: label(m) }, manageStockNotice(m.manageStock),
      productForm(m.catalogItemId, { ...m, regular: m.regular ?? "", sale: m.sale ?? "" },
        "variant:" + JSON.stringify(["price", id, m.catalogItemId, m.priceRevision])),
    ]),
    { type: "form", block_id: "variant-details-" + crypto.randomUUID(), fields: [
      { type: "text_input", action_id: "optionLabel", label: "Option", initial_value: variant.options[0].label },
      ...variant.options[0].values.map(v => ({ type: "text_input" as const, action_id: "label:" + v.valueId, label: "Value: " + v.label, initial_value: v.label })),
      ...variant.members.map(m => ({ type: "radio" as const, action_id: "fulfillment:" + m.catalogItemId, label: label(m) + " fulfillment", options: FULFILLMENT, initial_value: m.fulfillment })),
    ], submit: { label: "Save choices", action_id: "variant:" + JSON.stringify(["details", id, variant.revision]) } },
    { type: "form", block_id: "variant-bulk-" + crypto.randomUUID(), fields: [
      { type: "text_input", action_id: "regular", label: "Same regular price" },
      ...variant.members.map(m => ({ type: "toggle" as const, action_id: JSON.stringify([m.catalogItemId, m.priceRevision, m.sale ?? ""]), label: "Apply to " + label(m), initial_value: false })),
    ], submit: { label: "Apply same price", action_id: "variant:" + JSON.stringify(["bulk", id]) } },
  ];
}
// Images reference the EmDash Media Library by id. Block Kit 1.2.0 renders no
// media_picker on plugin admin pages, so Commerce lists the library itself
// through media:read; the admin preview uses the host's media item URL.
type Target = { t: "image" | "gallery" | "placeholder"; id: string };
function target(value: unknown): Target {
  const v = object(value);
  const id = typeof v.id === "string" && v.id.length <= 1024 ? v.id : "";
  if ((v.t !== "image" && v.t !== "gallery" && v.t !== "placeholder") || (v.t !== "placeholder" && !id)) throw new Error("Invalid image target");
  return { t: v.t, id };
}
async function preview(ctx: PluginContext, reference: MediaReference | null, alt: string): Promise<Block> {
  const item = reference && ctx.media ? await ctx.media.get(reference.mediaId).catch(() => null) : null;
  return item ? { type: "image", url: item.url, alt: item.alt || alt }
    : { type: "context", text: reference ? "Image " + reference.mediaId + " is not available in the Media Library." : "No image" };
}
async function mediaBlocks(ctx: PluginContext, id: string, name: string, media: CatalogMediaRecord): Promise<Block[]> {
  const blocks: Block[] = [{ type: "header", text: "Images" }, await preview(ctx, media.image, name), { type: "actions", elements: [
    { type: "button", label: media.image ? "Change image" : "Choose image", action_id: "media.pick", value: { t: "image", id } },
    ...(media.image ? [{ type: "button" as const, label: "Remove image", action_id: "media.clear", value: { t: "image", id } }] : []),
  ] }, { type: "context", text: "Gallery (" + media.gallery.length + " of " + CATALOG_GALLERY_LIMIT + ")" }];
  for (const [index, entry] of media.gallery.entries()) {
    blocks.push(await preview(ctx, entry, name + " gallery image " + (index + 1)), { type: "actions", elements: [
      ...(index ? [{ type: "button" as const, label: "Move image " + (index + 1) + " up", action_id: "media.up", value: { id, index, m: entry.mediaId } }] : []),
      { type: "button", label: "Remove image " + (index + 1), action_id: "media.remove", value: { id, index, m: entry.mediaId } },
    ] });
  }
  if (media.gallery.length < CATALOG_GALLERY_LIMIT) {
    blocks.push({ type: "actions", elements: [{ type: "button", label: "Add to gallery", action_id: "media.pick", value: { t: "gallery", id } }] });
  }
  return blocks;
}
async function library(ctx: PluginContext, t: Target, cursor?: string): Promise<BlockResponse> {
  if (!ctx.media) throw new Error("Media Library access is unavailable. Commerce needs the media:read capability.");
  const page = await ctx.media.list({ limit: LIBRARY_PAGE, mimeType: "image/", ...(cursor ? { cursor } : {}) });
  const blocks: Block[] = [
    { type: "header", text: t.t === "placeholder" ? "Choose a placeholder image" : t.t === "gallery" ? "Add to gallery" : "Choose an image" },
    navigation(), { type: "context", text: "Images from the Media Library. Upload new images on the Media page." },
    { type: "actions", elements: [{ type: "button", label: "Cancel", action_id: t.t === "placeholder" ? "settings" : "open", value: t.id }] },
  ];
  for (const item of page.items) {
    blocks.push({ type: "image", url: item.url, alt: item.alt || item.filename },
      { type: "actions", elements: [{ type: "button", label: "Use " + item.filename, action_id: "media.use", value: { ...t, m: item.id } }] });
  }
  if (!page.items.length) blocks.push({ type: "empty", title: "No images yet", description: "Upload images on the Media page first." });
  if (page.hasMore && page.cursor) {
    blocks.push({ type: "actions", elements: [{ type: "button", label: "Next", action_id: "media.pick", value: { ...t, c: page.cursor } }] });
  }
  return { blocks };
}
async function product(ctx: PluginContext, id: string, form?: CatalogProductPriceForm, toast?: string): Promise<BlockResponse> {
  const store = storage(ctx);
  const listed = await listCatalogProducts(store);
  const selected = listed.products.find((item) => item.catalogItemId === id);
  if (!selected) throw new CatalogError("CATALOG_ITEM_NOT_FOUND", "Product was not found. Return to Products.");
  const dormant = await loadCatalogItemManualAvailability(store.availability, id);
  const status = dormant.status === "available-on-backorder" ? "on-backorder" : dormant.status;
  const media = await loadCatalogItemMedia(store.media, id);
  const feedChannels = store.feedEligibility
    ? await loadProductFeedEligibility(store.feedEligibility, id)
    : undefined;
  const values = form ?? { regular: selected.regular ?? "", sale: selected.sale ?? "", manageStock: selected.manageStock, stockStatus: selected.stockStatus, feedChannels };
  return { blocks: [
    { type: "header", text: selected.name }, { type: "context", text: "Commerce / Products" }, navigation(),
    { type: "context", text: "SKU: " + selected.sku },
    ...(form?.message ? [alert(form.message)] : []),
    manageStockNotice(values.manageStock),
    ...(!selected.variantProduct?.options.length ? [productForm(id, { ...values, stockStatus: values.stockStatus ?? status })] : []),
    ...variantEditor(id, selected.variantProduct),
    ...await mediaBlocks(ctx, id, selected.name, media),
  ], ...(toast ? { toast: { type: "success", message: toast } } : {}) };
}
async function saveGallery(ctx: PluginContext, id: string, edit: (gallery: string[]) => string[], toast: string): Promise<BlockResponse> {
  const store = storage(ctx);
  const current = await loadCatalogItemMedia(store.media, id);
  await saveCatalogItemMedia(store, { catalogItemId: id, gallery: edit(current.gallery.map((entry) => entry.mediaId)) });
  return product(ctx, id, undefined, toast);
}
// A stale page must never act on a different image than its label named.
function galleryIndex(value: unknown, mediaId: string, gallery: string[]): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= gallery.length) throw new Error("Invalid gallery image");
  if (gallery[value] !== mediaId) throw new CatalogError("INVALID_INPUT", "The gallery changed since this page loaded. Reload and try again.");
  return value;
}
async function placeholderBlocks(ctx: PluginContext): Promise<Block[]> {
  const placeholder = (await loadStorefrontPlaceholderImage(placeholderStorage(ctx))).image;
  return [
    { type: "header", text: "Placeholder image" }, { type: "context", text: "Shown on the shop for products without an image." },
    await preview(ctx, placeholder, "Placeholder image"),
    { type: "actions", elements: [
      { type: "button", label: placeholder ? "Change placeholder" : "Choose placeholder", action_id: "media.pick", value: { t: "placeholder", id: "" } },
      ...(placeholder ? [{ type: "button" as const, label: "Remove placeholder", action_id: "media.clear", value: { t: "placeholder", id: "" } }] : []),
    ] },
  ];
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
async function settings(ctx: PluginContext, toast?: string): Promise<BlockResponse> {
  const listing = await loadOutOfStockListing(ctx.storage["storefront_out_of_stock_listing"] as StorageCollection<StorefrontOutOfStockListingRecord>);
  const response = settingsResponse(listing.hideOutOfStock);
  return { blocks: [...response.blocks, ...await placeholderBlocks(ctx)], ...(toast ? { toast: { type: "success", message: toast } } : {}) };
}

/** Private Block Kit transport. The host authenticates and authorizes this route. */
export async function commerceAdmin(route: SandboxedRouteContext, ctx: PluginContext): Promise<BlockResponse> {
  if (ordersInteraction(route.input)) return ordersBlocks(route, ctx);
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
      if (action === "settings") return await settings(ctx);
      if (action === "list") {
        const offset = input.value ?? 0;
        if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000) throw new Error("Invalid page");
        return await products(ctx, offset);
      }
      if (action === "media.pick") {
        const v = object(input.value);
        return await library(ctx, target(v), typeof v.c === "string" && v.c.length <= 1024 ? v.c : undefined);
      }
      if (action === "media.use" || action === "media.clear") {
        const v = object(input.value);
        const t = target(v);
        const mediaId = action === "media.use" ? text(v.m) : null;
        if (t.t === "placeholder") {
          await setStorefrontPlaceholderImage(placeholderStorage(ctx), { image: mediaId });
          return await settings(ctx, mediaId ? "Placeholder saved" : "Placeholder removed");
        }
        if (t.t === "image") {
          await saveCatalogItemMedia(storage(ctx), { catalogItemId: t.id, image: mediaId });
          return await product(ctx, t.id, undefined, mediaId ? "Image saved" : "Image removed");
        }
        return await saveGallery(ctx, t.id, (gallery) => [...gallery, mediaId as string], "Added to gallery");
      }
      if (action === "media.remove" || action === "media.up") {
        const v = object(input.value);
        const id = text(v.id);
        const mediaId = text(v.m);
        return await saveGallery(ctx, id, (gallery) => {
          const index = galleryIndex(v.index, mediaId, gallery);
          if (action === "media.remove") return gallery.filter((_, position) => position !== index);
          if (index > 0) [gallery[index - 1], gallery[index]] = [gallery[index] as string, gallery[index - 1] as string];
          return gallery;
        }, action === "media.remove" ? "Image removed" : "Gallery reordered");
      }
    }
    if (input.type === "form_submit") {
      values = object(input.values);
      if (action.startsWith("create:")) {
        const commandId = action.slice(7);
        admitV1CatalogCreateInput(values);
        const created = await createCatalogItem(storage(ctx).catalog,
          { ...catalogProductCreateInput(text(values.name), text(values.sku), commandId), ...(values.fulfillment ? { fulfillment: values.fulfillment } : {}) }, { collection: "catalog_items", pluginId: ctx.plugin?.id });
        return { ...await product(ctx, created.item.itemId), toast: { type: "success", message: "Product added" } };
      }
      if (action.startsWith("save:")) {
        const id = action.slice(5);
        const store = storage(ctx);
        const item = await store.catalog.get(id);
        const wasManaged = isManagedCatalogRecord(item);
        const payload: Record<string, unknown> = {
          catalogItemId: id,
          regular: text(values.regular),
          sale: text(values.sale),
        };
        if (Object.hasOwn(values, "manageStock")) payload.manageStock = values.manageStock;
        if (!wasManaged && values.stockStatus !== undefined) payload.stockStatus = text(values.stockStatus);
        const saved = await saveCatalogProductPrices(store,
          admitV1CatalogPriceSaveInput(payload, wasManaged));
        if (store.feedEligibility &&
            (Object.hasOwn(values, "feed:google-merchant") || Object.hasOwn(values, "feed:meta-catalog"))) {
          await setProductFeedEligibility(store.feedEligibility, store.catalog, {
            catalogItemId: id,
            channels: [
              ...(values["feed:google-merchant"] === true ? ["google-merchant" as const] : []),
              ...(values["feed:meta-catalog"] === true ? ["meta-catalog" as const] : []),
            ],
          });
        }
        return { ...await product(ctx, id, saved), toast: { type: saved.saved ? "success" : "error", message: saved.message ?? "Product saved" } };
      }
      if (action.startsWith("variant:")) {
        const [operation, id, ...args] = JSON.parse(action.slice(8));
        const store = storage(ctx);
        const selected = (await listCatalogProducts(store)).products.find(item => item.catalogItemId === id);
        if (!selected) throw new CatalogError("CATALOG_ITEM_NOT_FOUND", "Product was not found. Return to Products.");
        if (operation === "add") await addCatalogVariantOption(store, {
          productId: id, optionId: args[0], optionLabel: text(values.optionLabel), values: [
            { valueId: args[1], label: text(values.smallLabel), member: { catalogItemId: id, fulfillment: values.first as never } },
            { valueId: args[2], label: text(values.largeLabel), member: { commandId: args[3], name: selected.name, sku: text(values.sku), fulfillment: values.second as never } },
          ],
        }, { collection: "catalog_items", pluginId: ctx.plugin?.id });
        else if (operation === "price") {
          const member = selected.variantProduct?.members.find(m => m.catalogItemId === args[0]);
          if (!member) throw new Error("Member unavailable");
          const saved = await saveCatalogProductPrices(store, { catalogItemId: args[0], expectedRevision: args[1], regular: text(values.regular), sale: text(values.sale),
            ...(!member.manageStock && values.stockStatus !== undefined ? { stockStatus: text(values.stockStatus) } : {}) });
          if (!saved.saved) throw new Error(saved.message ?? "Could not save price");
        } else if (operation === "details") await updateCatalogVariantLabels(store, {
          productId: id, expectedRevision: args[0], optionLabel: text(values.optionLabel),
          values: Object.entries(values).filter(([k]) => k.startsWith("label:")).map(([k,v]) => ({ valueId: k.slice(6), label: text(v) })),
          members: Object.entries(values).filter(([k]) => k.startsWith("fulfillment:")).map(([k,v]) => ({ catalogItemId: k.slice(12), fulfillment: v as never })),
        });
        else if (operation === "bulk") {
          const rows = Object.entries(values).filter(([k,v]) => k.startsWith("[") && v === true).map(([k]) => {
            const [catalogItemId, expectedRevision, sale] = JSON.parse(k);
            if (!selected.variantProduct?.members.some(m => m.catalogItemId === catalogItemId)) throw new Error("Member unavailable");
            return { catalogItemId, expectedRevision, sale, regular: text(values.regular) };
          });
          const result = await bulkSaveCatalogProductPrices(store, rows);
          const back = await product(ctx, id);
          return { blocks: [{ type: "context", text: result.outcomes.map(r => r.catalogItemId + ": " + (r.applied ? "Saved" : r.message)).join("; ") }, ...back.blocks] };
        } else throw new Error("Unknown variant action");
        return product(ctx, id, undefined, "Changes saved");
      }
      if (action === "settings.save") {
        await setOutOfStockListing(ctx.storage["storefront_out_of_stock_listing"] as StorageCollection<StorefrontOutOfStockListingRecord>,
          { hideOutOfStock: bool(values.hideOutOfStock) });
        return await settings(ctx, "Settings saved");
      }
    }
    throw new Error("Unknown interaction");
  } catch (error) {
    const failure = message(error);
    // A refused media choice returns the clerk to the product or Settings with the reason; stored values are unchanged.
    if (input.type === "block_action" && /^media\.(use|clear|remove|up)$/.test(String(input.action_id))) {
      const v = input.value as { t?: unknown; id?: unknown } | null;
      try {
        const back = v?.t === "placeholder" ? await settings(ctx) : typeof v?.id === "string" && v.id ? await product(ctx, v.id) : null;
        if (back) return { blocks: [alert(failure), ...back.blocks], toast: { type: "error", message: failure } };
      } catch { /* fall through to the generic alert */ }
    }
    if (input.type === "form_submit" && typeof input.action_id === "string" && input.action_id.startsWith("variant:")) {
      try {
        const args = JSON.parse(input.action_id.slice(8));
        const back = await product(ctx, args[1]);
        for (const block of back.blocks) if (block.type === "form" && block.submit.action_id.startsWith("variant:")) {
          const next = JSON.parse(block.submit.action_id.slice(8));
          if (next[0] !== args[0] || (args[0] === "price" && next[2] !== args[2])) continue;
          block.submit.action_id = input.action_id;
          for (const field of block.fields) if (Object.hasOwn(values, field.action_id)) Object.assign(field, { initial_value: values[field.action_id] });
        }
        return { blocks: [alert(failure), ...back.blocks], toast: { type: "error", message: failure } };
      } catch { /* storage recovery falls through to the render-only alert */ }
    }
    // Preserve clerk input for a refused create; retry uses the same command identity.
    if (input.type === "form_submit" && typeof input.action_id === "string" && input.action_id.startsWith("create:") &&
        typeof values.name === "string" && values.name.length <= 1024 && typeof values.sku === "string" && values.sku.length <= 1024) {
      return { blocks: [{ type: "header", text: "Products" }, navigation(), alert(failure),
        ...addForm(input.action_id.slice(7), values.name, values.sku)], toast: { type: "error", message: failure } };
    }
    // Recovery is render-only: even a storage outage must not erase clerk input.
    if (input.type === "form_submit" && typeof input.action_id === "string" && input.action_id.length <= 1024) {
      if (input.action_id.startsWith("save:") && typeof values.regular === "string" && values.regular.length <= 1024 &&
          typeof values.sale === "string" && values.sale.length <= 1024) {
        const status = STOCK_OPTIONS.some(option => option.value === values.stockStatus)
          ? values.stockStatus as ProductFields["stockStatus"] : null;
        const managed = typeof values.manageStock === "boolean" ? values.manageStock : null;
        return { blocks: [
          { type: "header", text: "Product changes" }, { type: "context", text: "Commerce / Products" }, navigation(),
          alert(failure), { type: "context", text: "Save was not confirmed. Your entries are retained; review or retry." },
          manageStockNotice(managed),
          productForm(input.action_id.slice(5), {
            regular: values.regular,
            sale: values.sale,
            manageStock: managed,
            stockStatus: managed === false ? status : null,
          }),
        ], toast: { type: "error", message: failure } };
      }
      if (input.action_id === "settings.save" && typeof values.hideOutOfStock === "boolean") {
        return { ...settingsResponse(values.hideOutOfStock, failure), toast: { type: "error", message: failure } };
      }
    }
    return { blocks: [navigation(), alert(failure)], toast: { type: "error", message: failure } };
  }
}
