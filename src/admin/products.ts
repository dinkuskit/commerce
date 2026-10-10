import type { Block, BlockResponse } from "@emdash-cms/blocks";
import type { PluginContext, SandboxedRouteContext } from "emdash/plugin";
import type { StorageCollection } from "emdash";
import {
  CatalogError, createCatalogItem, catalogProductCreateInput, listCatalogProducts,
  saveCatalogProductPrices, loadCatalogItemManualAvailability, loadCatalogItemMedia, saveCatalogItemMedia,
  admitV1CatalogCreateInput, admitV1CatalogPriceSaveInput, isManagedCatalogRecord, CATALOG_GALLERY_LIMIT,
  addCatalogVariantOption, bulkSaveCatalogProductPrices, updateCatalogVariantLabels,
  type CatalogStorageRecord, type CatalogPriceRecord, type CatalogManualAvailabilityRecord,
  type CatalogProductPriceForm, type CatalogProductListItem, type CatalogMediaRecord, type CatalogMediaStorage,
} from "../features/catalog/kernel/index.js";
import {
  loadProductFeedEligibility, setProductFeedEligibility,
  type ProductFeedChannel, type ProductFeedEligibilityRecord,
} from "../features/feeds/kernel/index.js";
import { pageOffset, pagination, navigation } from "../shared/admin-blocks.js";
import { alert, button, failed, header, message, note, object, refused, text } from "./common.js";
import { library, preview, target } from "./media.js";

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
    media: ctx.storage["catalog_media"] as CatalogMediaStorage,
  };
}
function feedEligibility(ctx: PluginContext) {
  return ctx.storage["product_feed_eligibility"] as StorageCollection<ProductFeedEligibilityRecord> | undefined;
}
function addForm(commandId: string = crypto.randomUUID(), name = "", sku = ""): Block[] {
  return [
    header("Add product"),
    note("Customer-facing title; unmanaged until Manage stock ships."),
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
  const blocks: Block[] = [header("Products"), note("Commerce"), navigation(),
    ...addForm(), { type: "divider" }];
  for (const product of products.slice(start, start + PAGE_SIZE)) {
    blocks.push({ type: "section", text: product.name + " — " + product.sku,
      accessory: button("Open " + product.name, "open", product.catalogItemId) });
  }
  if (!products.length) blocks.push({ type: "empty", title: "No products yet", description: "Add your first product." });
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
function manageStockNotice(managed: boolean | null): Block {
  const base = "Manage stock — Coming soon";
  return {
    type: "context",
    text: managed === true
      ? base + ". This product stays managed; tracking cannot be changed."
      : managed === false
        ? base
        : base + ". Manual status is hidden until stored tracking can be proven.",
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
      header(label(m)), manageStockNotice(m.manageStock),
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
async function mediaBlocks(ctx: PluginContext, id: string, name: string, media: CatalogMediaRecord): Promise<Block[]> {
  const blocks: Block[] = [header("Images"), await preview(ctx, media.image, name), { type: "actions", elements: [
    button(media.image ? "Change image" : "Choose image", "media.pick", { t: "image", id }),
    ...(media.image ? [button("Remove image", "media.clear", { t: "image", id })] : []),
  ] }, note("Gallery (" + media.gallery.length + " of " + CATALOG_GALLERY_LIMIT + ")")];
  for (const [index, entry] of media.gallery.entries()) {
    blocks.push(await preview(ctx, entry, name + " gallery image " + (index + 1)), { type: "actions", elements: [
      ...(index ? [button("Move image " + (index + 1) + " up", "media.up", { id, index, m: entry.mediaId })] : []),
      button("Remove image " + (index + 1), "media.remove", { id, index, m: entry.mediaId }),
    ] });
  }
  if (media.gallery.length < CATALOG_GALLERY_LIMIT) {
    blocks.push({ type: "actions", elements: [button("Add to gallery", "media.pick", { t: "gallery", id })] });
  }
  return blocks;
}
async function product(ctx: PluginContext, id: string, form?: CatalogProductPriceForm & { feedChannels?: readonly ProductFeedChannel[] }, toast?: string): Promise<BlockResponse> {
  const store = storage(ctx);
  const listed = await listCatalogProducts(store);
  const selected = listed.products.find((item) => item.catalogItemId === id);
  if (!selected) throw new CatalogError("CATALOG_ITEM_NOT_FOUND", "Product not found. Return to Products.");
  const dormant = await loadCatalogItemManualAvailability(store.availability, id);
  const status = dormant.status === "available-on-backorder" ? "on-backorder" : dormant.status;
  const media = await loadCatalogItemMedia(store.media, id);
  const feeds = feedEligibility(ctx);
  const feedChannels = feeds ? await loadProductFeedEligibility(feeds, id) : undefined;
  const values = form ? { ...form, feedChannels: form.feedChannels ?? feedChannels } : { regular: selected.regular ?? "", sale: selected.sale ?? "", manageStock: selected.manageStock, stockStatus: selected.stockStatus, feedChannels };
  return { blocks: [
    header(selected.name), note("Commerce / Products"), navigation(),
    note("SKU: " + selected.sku),
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
/** Products page and product editing, including product images. */
export async function productsAdmin(route: SandboxedRouteContext, ctx: PluginContext): Promise<BlockResponse> {
  let input: Record<string, unknown> = {};
  let values: Record<string, unknown> = {};
  try {
    input = object(route.input);
    if (input.type === "page_load") {
      if (input.page === "/products") return await products(ctx);
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
      if (action === "media.pick") {
        const v = object(input.value);
        return await library(ctx, target(v), typeof v.c === "string" && v.c.length <= 1024 ? v.c : undefined);
      }
      if (action === "media.use" || action === "media.clear") {
        const v = object(input.value);
        const t = target(v);
        const mediaId = action === "media.use" ? text(v.m) : null;
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
        const feedSubmitted = Object.hasOwn(values, "feed:google-merchant") || Object.hasOwn(values, "feed:meta-catalog");
        const channels = [
          ...(values["feed:google-merchant"] === true ? ["google-merchant" as const] : []),
          ...(values["feed:meta-catalog"] === true ? ["meta-catalog" as const] : []),
        ];
        // A refused price save writes nothing, feed choices included; the form keeps the clerk's entries.
        const feeds = feedEligibility(ctx);
        if (saved.saved && feeds && feedSubmitted) {
          await setProductFeedEligibility(feeds, store.catalog, { catalogItemId: id, channels });
        }
        return { ...await product(ctx, id, !saved.saved && feedSubmitted ? { ...saved, feedChannels: channels } : saved), toast: { type: saved.saved ? "success" : "error", message: saved.message ?? "Product saved" } };
      }
      if (action.startsWith("variant:")) {
        const [operation, id, ...args] = JSON.parse(action.slice(8));
        const store = storage(ctx);
        const selected = (await listCatalogProducts(store)).products.find(item => item.catalogItemId === id);
        if (!selected) throw new CatalogError("CATALOG_ITEM_NOT_FOUND", "Product not found. Return to Products.");
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
          return { blocks: [note(result.outcomes.map(r => r.catalogItemId + ": " + (r.applied ? "Saved" : r.message)).join("; ")), ...back.blocks] };
        } else throw new Error("Unknown variant action");
        return product(ctx, id, undefined, "Changes saved");
      }
    }
    throw new Error("Unknown interaction");
  } catch (error) {
    const failure = message(error);
    // A refused media choice returns the clerk to the product with the reason; stored values are unchanged.
    if (input.type === "block_action" && /^media\.(use|clear|remove|up)$/.test(String(input.action_id))) {
      const v = input.value as { t?: unknown; id?: unknown } | null;
      try {
        const back = typeof v?.id === "string" && v.id ? await product(ctx, v.id) : null;
        if (back) return refused(failure, [alert(failure), ...back.blocks]);
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
        return refused(failure, [alert(failure), ...back.blocks]);
      } catch { /* storage recovery falls through to the render-only alert */ }
    }
    // Preserve clerk input for a refused create; retry uses the same command identity.
    if (input.type === "form_submit" && typeof input.action_id === "string" && input.action_id.startsWith("create:") &&
        typeof values.name === "string" && values.name.length <= 1024 && typeof values.sku === "string" && values.sku.length <= 1024) {
      return { blocks: [header("Products"), navigation(), alert(failure),
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
          header("Product changes"), note("Commerce / Products"), navigation(),
          alert(failure), note("Save not confirmed; entries kept."),
          manageStockNotice(managed),
          productForm(input.action_id.slice(5), {
            regular: values.regular,
            sale: values.sale,
            manageStock: managed,
            stockStatus: managed === false ? status : null,
            ...(typeof values["feed:google-merchant"] === "boolean" || typeof values["feed:meta-catalog"] === "boolean" ? { feedChannels: [
              ...(values["feed:google-merchant"] === true ? ["google-merchant" as const] : []),
              ...(values["feed:meta-catalog"] === true ? ["meta-catalog" as const] : []),
            ] } : {}),
          }),
        ], toast: { type: "error", message: failure } };
      }
    }
    return failed(failure);
  }
}
