import type { Block, BlockResponse } from "@emdash-cms/blocks";
import type { PluginContext, SandboxedRouteContext } from "emdash/plugin";
import type { StorageCollection } from "emdash";
import {
  CatalogError, createCatalogItem, listCatalogProductSummaries, loadCatalogProduct, setCatalogProductOnSale,
  linkProductPage, productPageLinks, PRODUCT_PAGES_COLLECTION, type ProductPages,
  saveCatalogProductPrices, loadCatalogItemManualAvailability, loadCatalogItemMedia, saveCatalogItemMedia,
  admitV1CatalogPriceSaveInput, isManagedCatalogRecord, CATALOG_GALLERY_LIMIT,
  normalizeWeightOz, setCatalogItemWeight, renameCatalogProduct, setCatalogProductArchived,
  addCatalogVariantOption, updateCatalogVariantLabels,
  type CatalogStorageRecord, type CatalogPriceRecord, type CatalogManualAvailabilityRecord,
  type CatalogProductPriceForm, type CatalogProductListItem, type CatalogMediaRecord, type CatalogMediaStorage,
} from "../features/catalog/kernel/index.js";
import {
  loadProductFeedEligibility, setProductFeedEligibility,
  type ProductFeedChannel, type ProductFeedEligibilityRecord,
} from "../features/feeds/kernel/index.js";
import { alert, button, failed, header, message, note, object, refused, text } from "./common.js";
import { library, preview, target } from "./media.js";

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
    pages: ctx.storage[PRODUCT_PAGES_COLLECTION] as ProductPages,
  };
}
function feedEligibility(ctx: PluginContext) {
  return ctx.storage["product_feed_eligibility"] as StorageCollection<ProductFeedEligibilityRecord> | undefined;
}
type ProductFields = {
  regular: CatalogProductPriceForm["regular"];
  sale: CatalogProductPriceForm["sale"];
  manageStock: boolean | null;
  stockStatus: CatalogProductPriceForm["stockStatus"];
  feedChannels?: readonly ProductFeedChannel[];
};
function manageStockNotice(managed: boolean | null): Block {
  const base = "Manage stock \u2014 Coming soon";
  return {
    type: "context",
    text: managed === true
      ? base + ". This product stays managed; tracking cannot be changed."
      : managed === false
        ? base
        : base + ". Manual status is hidden until stored tracking can be proven.",
  };
}
const FEEDS = [["google-merchant", "Google Merchant"], ["meta-catalog", "Meta catalog"]] as const;
function productForm(id: string, values: ProductFields, action = "save:" + id): Block {
  return { type: "form", block_id: "product-" + id + "-" + crypto.randomUUID(), fields: [
      { type: "text_input", action_id: "regular", label: "Regular", initial_value: values.regular },
      { type: "text_input", action_id: "sale", label: "Sale", initial_value: values.sale },
      ...(values.manageStock === false ? [{ type: "radio" as const, action_id: "stockStatus", label: "Stock status", options: STOCK_OPTIONS,
        initial_value: values.stockStatus ?? undefined }] : []),
      ...(values.feedChannels === undefined ? [] : FEEDS.map(([channel, label]) =>
        ({ type: "toggle" as const, action_id: "feed:" + channel, label, initial_value: values.feedChannels!.includes(channel) }))),
    ], submit: { label: "Save", action_id: action } };
}
const FULFILLMENT = [{ label: "Physical", value: "physical" }, { label: "Digital", value: "digital" }];
/** Shipping weight for each physical item, in ounces; Ship's label form starts from it. Digital items have none. */
function weightForm(selected: CatalogProductListItem): Block[] {
  const items = selected.variantProduct?.options.length
    ? selected.variantProduct.members.map(m => [m, "Weight (oz): " + m.selections.map(s => s.valueLabel).join(" / ")] as const)
    : [[selected, "Weight (oz)"] as const];
  const fields = items.filter(([item]) => item.fulfillment === "physical").map(([item, label]) =>
    ({ type: "text_input" as const, action_id: "w:" + item.catalogItemId, label, initial_value: item.weightOz === undefined ? "" : String(item.weightOz) }));
  return fields.length ? [header("Shipping weight"), { type: "form", block_id: "weight-" + crypto.randomUUID(), fields,
    submit: { label: "Save weight", action_id: "weight:" + selected.catalogItemId } }] : [];
}
function variantEditor(id: string, variant: CatalogProductListItem["variantProduct"]): Block[] {
  if (!variant?.options.length) return [{
    type: "form", block_id: "variant-add-" + id, fields: [
      { type: "text_input", action_id: "optionLabel", label: "Option", initial_value: "Size" },
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
      ...variant.options.flatMap((o, i) => [
        { type: "text_input" as const, action_id: i ? "option:" + o.optionId : "optionLabel", label: i ? "Option: " + o.label : "Option", initial_value: o.label },
        ...o.values.map(v => ({ type: "text_input" as const, action_id: "label:" + JSON.stringify([o.optionId, v.valueId]), label: "Value: " + v.label, initial_value: v.label })),
      ]),
      ...variant.members.map(m => ({ type: "radio" as const, action_id: "fulfillment:" + m.catalogItemId, label: label(m) + " fulfillment", options: FULFILLMENT, initial_value: m.fulfillment })),
    ], submit: { label: "Save choices", action_id: "variant:" + JSON.stringify(["details", id, variant.revision]) } },
    ...(variant.options.length < 3 ? [{
      type: "form" as const, block_id: "variant-option-" + crypto.randomUUID(), fields: [
        { type: "text_input" as const, action_id: "optionLabel", label: "Next option", initial_value: variant.options.length === 1 ? "Color" : "Material" },
        { type: "text_input" as const, action_id: "firstValue", label: "First option value", initial_value: "Sand" },
        { type: "text_input" as const, action_id: "secondValue", label: "Second option value", initial_value: "Ink" },
        ...variant.members.map(m => ({ type: "text_input" as const, action_id: "member:" + m.catalogItemId, label: "Value for " + label(m), initial_value: "Sand" })),
      ], submit: { label: "Add option", action_id: "variant:" + JSON.stringify(["option", id, variant.revision, crypto.randomUUID()]) },
    }] : []),
    ...(variant.members.length < 50 ? [{
      type: "form" as const, block_id: "variant-member-" + crypto.randomUUID(), fields: [
        ...variant.options.map(o => ({ type: "text_input" as const, action_id: "choice:" + o.optionId, label: "Choice: " + o.label })),
        { type: "text_input" as const, action_id: "sku", label: "Variant SKU" },
        { type: "radio" as const, action_id: "fulfillment", label: "Variant fulfillment", options: FULFILLMENT, initial_value: "physical" },
      ], submit: { label: "Add variant", action_id: "variant:" + JSON.stringify(["member", id, variant.revision, crypto.randomUUID()]) },
    }] : []),
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
  const selected = await loadCatalogProduct(store, id);
  if (!selected) throw new CatalogError("CATALOG_ITEM_NOT_FOUND", "Product not found.");
  const dormant = await loadCatalogItemManualAvailability(store.availability, id);
  const status = dormant.status === "available-on-backorder" ? "on-backorder" : dormant.status;
  const media = await loadCatalogItemMedia(store.media, id);
  const feeds = feedEligibility(ctx);
  const feedChannels = feeds ? await loadProductFeedEligibility(feeds, id) : undefined;
  const values = form ? { ...form, feedChannels: form.feedChannels ?? feedChannels } : { regular: selected.regular ?? "", sale: selected.sale ?? "", manageStock: selected.manageStock, stockStatus: selected.stockStatus, feedChannels };
  return { blocks: [
    header(selected.name),
    note((selected.archivedAt ? "Archived: not in the shop and can't be bought" : selected.offSale ? "Draft: publish this page to sell it" : "On sale") + " \u00b7 SKU " + selected.sku),
    ...(form?.message ? [alert(form.message)] : []),
    { type: "form", block_id: "rename-" + crypto.randomUUID(), fields: [{ type: "text_input", action_id: "name", label: "Name", initial_value: selected.name }],
      submit: { label: "Rename", action_id: "rename:" + id } },
    manageStockNotice(values.manageStock),
    ...(!selected.variantProduct?.options.length ? [productForm(id, { ...values, stockStatus: values.stockStatus ?? status })] : []),
    ...variantEditor(id, selected.variantProduct),
    ...weightForm(selected),
    ...await mediaBlocks(ctx, id, selected.name, media),
    { type: "actions", elements: [selected.archivedAt ? button("Restore", "archive", { id, a: false })
      : { ...button("Archive product", "archive", { id, a: true }), style: "danger", confirm: { title: "Archive " + selected.name + "?",
        text: "It leaves the shop and can't be bought. Past orders keep it. You can restore it later.", confirm: "Archive", deny: "Cancel", style: "danger" } }] },
  ], ...(toast ? { toast: { type: "success", message: toast } } : {}) };
}
async function saveGallery(ctx: PluginContext, id: string, edit: (gallery: string[]) => string[], toast: string): Promise<BlockResponse> {
  const store = storage(ctx);
  const current = await loadCatalogItemMedia(store.media, id);
  await saveCatalogItemMedia(store, { catalogItemId: id, gallery: edit(current.gallery.map((entry) => entry.mediaId)) });
  return product(ctx, id, undefined, toast);
}
/** A value id from its label, made unique among the option's other values. */
function valueIdFor(label: string, fallback: string, taken: readonly { valueId: string }[]): string {
  const base = label.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || fallback;
  return taken.some(v => v.valueId === base) ? `${base}-${taken.length + 1}` : base;
}
// A stale page must never act on a different image than its label named.
function galleryIndex(value: unknown, mediaId: string, gallery: string[]): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= gallery.length) throw new Error("Invalid gallery image");
  if (gallery[value] !== mediaId) throw new CatalogError("INVALID_INPUT", "The gallery changed since this page loaded. Reload and try again.");
  return value;
}
type Draft = { fields?: Record<string, unknown> };
const command = (action: string) => /^sell:[\w-]{8,64}$/.test(action) ? action.slice(5) : crypto.randomUUID();
/** Commerce products no product page sells yet, newest first, archived ones too so they can be restored; Commerce Settings lists them. */
export async function productsWithoutPage(ctx: PluginContext) {
  const store = storage(ctx);
  const linked = await productPageLinks(store.pages);
  return (await listCatalogProductSummaries(store.catalog)).filter(p => !linked.has(p.catalogItemId));
}
export const productLabel = (p: { name: string; sku: string; archivedAt?: string | null }) => p.name + " \u2014 " + p.sku + (p.archivedAt ? " (archived)" : "");
/** The sell form carries its create command, so a retry after a partial failure resumes the same product. */
async function unlinked(ctx: PluginContext, sku = "", command: string = crypto.randomUUID()): Promise<BlockResponse> {
  const orphans = await productsWithoutPage(ctx);
  return { blocks: [
    note("Not for sale yet. Make this sellable to add price, stock and photos, or to open the product this page already names."),
    { type: "form", block_id: "sell-" + crypto.randomUUID(), fields: [{ type: "text_input", action_id: "sku", label: "SKU (optional)", initial_value: sku }],
      submit: { label: "Make this sellable", action_id: "sell:" + command } },
    ...(orphans.length ? [{ type: "form" as const, block_id: "link-" + crypto.randomUUID(), fields: [{ type: "select" as const, action_id: "product",
      label: "Or sell a product without a page", options: orphans.slice(0, 50).map(p => ({ label: productLabel(p), value: p.catalogItemId })) },
      { type: "text_input" as const, action_id: "sku", label: "Or its SKU" }],
      submit: { label: "Sell it here", action_id: "link" } }] : []),
  ] };
}
/** A SKU from the page title, made unique with a tail from its create command so a retry asks for the same SKU. */
const skuFrom = (title: string, command: string) => (title.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 40) + "-" + command.slice(0, 4)).toUpperCase().replace(/^-+/, "");
/**
 * Links this page to a Commerce product and fills the page's commerce_item_id
 * in the open editor. The page keeps it only when the merchant presses Save.
 */
async function sell(ctx: PluginContext, entryId: string, fields: Record<string, unknown>, chosen?: string, sku = "", command: string = crypto.randomUUID()): Promise<BlockResponse> {
  const store = storage(ctx);
  const typed = typeof fields.commerce_item_id === "string" ? fields.commerce_item_id.trim() : "";
  let id = chosen ?? (typed && await loadCatalogProduct(store, typed) ? typed : (await store.pages.get(entryId))?.catalogItemId);
  let toast = "Linked. Save to keep it.";
  if (!id) {
    // New products start as a physical Draft: off the shop until this page is published.
    const title = typeof fields.title === "string" && fields.title.trim() ? fields.title.trim().slice(0, 160) : "New product";
    id = (await createCatalogItem(store.catalog, { commandId: "page:" + command, name: title, sku: sku.trim() || skuFrom(title, command), fulfillment: "physical" },
      { collection: "catalog_items", pluginId: ctx.plugin?.id })).item.itemId;
    await setCatalogProductOnSale(store.catalog, { catalogItemId: id, onSale: false });
    toast = "Draft made. Save, then Publish to sell it.";
  }
  // The product view refuses a product that is gone, before anything is linked.
  const view = await product(ctx, id, undefined, toast);
  await linkProductPage(store.pages, entryId, id);
  return typed === id ? view : { ...view, patch: { type: "editor-draft-patch", operations: [{ op: "set", field: "commerce_item_id", value: id }] } };
}
/** The Dinkus Commerce panel on a product page: that page's price, sale, SKU, sizes, stock, weight and photos. */
export async function productPanel(route: SandboxedRouteContext, ctx: PluginContext): Promise<BlockResponse> {
  const entryId = route.ui?.surface === "content-editor-panel" ? route.ui.entry.id : "";
  if (!entryId) return failed("Invalid panel");
  const input = route.input as Record<string, unknown>;
  try {
    const draft = input.draft as Draft | undefined, fields = draft?.fields ?? {}, action = String(input.action_id ?? "");
    if (action.startsWith("sell")) return await sell(ctx, entryId, fields, undefined, text(object(input.values).sku ?? ""), command(action));
    if (action === "link") {
      // A typed SKU reaches every product, past the 50 the list shows.
      const v = object(input.values), sku = String(v.sku ?? "").trim().toUpperCase();
      return await sell(ctx, entryId, fields, sku ? (await listCatalogProductSummaries(storage(ctx).catalog)).find(p => p.sku.toUpperCase() === sku)?.catalogItemId ?? sku : text(v.product));
    }
    const linked = (await storage(ctx).pages.get(entryId))?.catalogItemId;
    if (input.type === "panel_load") return linked && await loadCatalogProduct(storage(ctx), linked) ? await product(ctx, linked) : await unlinked(ctx);
    // The editor's commerce_item_id wins: a page saved before the link list existed, a changed id, or a declined
    // or unsaved link is settled here, and the owner's next step acts on the product the page names.
    const named = typeof fields.commerce_item_id === "string" ? fields.commerce_item_id.trim() : "";
    if (draft && named !== (linked ?? "") && (linked || await loadCatalogProduct(storage(ctx), named))) return await sell(ctx, entryId, fields);
  } catch (error) {
    // A refused sell keeps the typed SKU, its create command and the buttons so the owner can retry.
    const sku = (input.values as Draft["fields"] | undefined)?.sku, again = await unlinked(ctx, typeof sku === "string" ? sku.slice(0, 1024) : "", command(String(input.action_id ?? ""))).catch(() => ({ blocks: [] }));
    return refused(message(error), [alert(message(error)), ...again.blocks]);
  }
  return productEdit(route, ctx);
}
async function productEdit(route: SandboxedRouteContext, ctx: PluginContext): Promise<BlockResponse> {
  let input: Record<string, unknown> = {};
  let values: Record<string, unknown> = {};
  try {
    input = object(route.input);
    const action = text(input.action_id);
    if (input.type === "block_action") {
      if (action === "open") return await product(ctx, text(input.value));
      if (action === "archive") {
        const v = object(input.value);
        await setCatalogProductArchived(storage(ctx).catalog, { catalogItemId: v.id, archived: v.a }, undefined, true);
        return await product(ctx, text(v.id), undefined, v.a ? "Product archived" : "Restored as a Draft");
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
        const feedSubmitted = FEEDS.some(([channel]) => Object.hasOwn(values, "feed:" + channel));
        const channels = FEEDS.map(([channel]) => channel).filter(channel => values["feed:" + channel] === true);
        // A refused price save writes nothing, feed choices included; the form keeps the clerk's entries.
        const feeds = feedEligibility(ctx);
        if (saved.saved && feeds && feedSubmitted) {
          await setProductFeedEligibility(feeds, store.catalog, { catalogItemId: id, channels });
        }
        return { ...await product(ctx, id, !saved.saved && feedSubmitted ? { ...saved, feedChannels: channels } : saved), toast: { type: saved.saved ? "success" : "error", message: saved.message ?? "Product saved" } };
      }
      if (action.startsWith("rename:")) {
        const id = action.slice(7);
        await renameCatalogProduct(storage(ctx).catalog, { catalogItemId: id, name: values.name });
        return await product(ctx, id, undefined, "Product renamed");
      }
      if (action.startsWith("weight:")) {
        const id = action.slice(7);
        const store = storage(ctx);
        const selected = await loadCatalogProduct(store, id);
        if (!selected) throw new CatalogError("CATALOG_ITEM_NOT_FOUND", "Product not found.");
        const typed = Object.entries(values).filter(([key]) => key.startsWith("w:")).map(([key, value]) => [key.slice(2), value] as const);
        const own = [selected, ...selected.variantProduct?.members ?? []];
        // Every weight is checked before any is saved, so a refused form changes nothing.
        for (const [itemId, value] of typed) {
          if (!own.some(item => item.catalogItemId === itemId && item.fulfillment === "physical")) throw new Error("Unknown product");
          normalizeWeightOz(value);
        }
        for (const [itemId, value] of typed) await setCatalogItemWeight(store.catalog, itemId, value);
        return product(ctx, id, undefined, "Weight saved");
      }
      if (action.startsWith("variant:")) {
        const [operation, id, ...args] = JSON.parse(action.slice(8));
        const store = storage(ctx);
        const selected = await loadCatalogProduct(store, id);
        if (!selected) throw new CatalogError("CATALOG_ITEM_NOT_FOUND", "Product not found.");
        if (operation === "add") await addCatalogVariantOption(store, {
          productId: id, optionId: args[0], optionLabel: text(values.optionLabel), values: [
            { valueId: args[1], label: text(values.smallLabel), member: { catalogItemId: id, fulfillment: values.first as never } },
            { valueId: args[2], label: text(values.largeLabel), member: { commandId: args[3], name: selected.name, sku: text(values.sku), fulfillment: values.second as never } },
          ],
        }, { collection: "catalog_items", pluginId: ctx.plugin?.id });
        else if (operation === "option") {
          const byLabel = new Map<string, { valueId: string; label: string }>();
          const ensure = (rawLabel: unknown) => {
            const l = text(rawLabel), k = l.toLowerCase();
            if (!byLabel.has(k)) byLabel.set(k, { valueId: valueIdFor(k, "v", [...byLabel.values()]), label: l });
            return byLabel.get(k)!.valueId;
          };
          ensure(values.firstValue); ensure(values.secondValue);
          const members = (selected.variantProduct?.members ?? []).map(m => ({
            catalogItemId: m.catalogItemId, valueId: ensure(values["member:" + m.catalogItemId]), fulfillment: m.fulfillment,
          }));
          await addCatalogVariantOption(store, {
            productId: id, expectedRevision: args[0], optionId: args[1], optionLabel: text(values.optionLabel),
            values: [...byLabel.values()], members,
          }, { collection: "catalog_items", pluginId: ctx.plugin?.id });
        } else if (operation === "member") {
          const selections = (selected.variantProduct?.options ?? []).map((o, i) => {
            const l = text(values["choice:" + o.optionId]), k = l.toLowerCase();
            const found = o.values.find(v => v.label.toLowerCase() === k || v.valueId === l);
            if (found) return { optionId: o.optionId, valueId: found.valueId };
            return { optionId: o.optionId, valueId: valueIdFor(k, "v" + i, o.values), label: l };
          });
          await addCatalogVariantOption(store, {
            productId: id, expectedRevision: args[0], commandId: args[1], name: selected.name,
            sku: text(values.sku), fulfillment: values.fulfillment as never, selections,
          }, { collection: "catalog_items", pluginId: ctx.plugin?.id });
        } else if (operation === "price") {
          const member = selected.variantProduct?.members.find(m => m.catalogItemId === args[0]);
          if (!member) throw new Error("Member unavailable");
          const saved = await saveCatalogProductPrices(store, { catalogItemId: args[0], expectedRevision: args[1], regular: text(values.regular), sale: text(values.sale),
            ...(!member.manageStock && values.stockStatus !== undefined ? { stockStatus: text(values.stockStatus) } : {}) });
          if (!saved.saved) throw new Error(saved.message ?? "Could not save price");
        } else if (operation === "details") await updateCatalogVariantLabels(store, {
          productId: id, expectedRevision: args[0],
          ...(values.optionLabel !== undefined ? { optionLabel: text(values.optionLabel) } : {}),
          options: Object.entries(values).filter(([k]) => k.startsWith("option:")).map(([k, v]) => ({ optionId: k.slice(7), label: text(v) })),
          values: Object.entries(values).filter(([k]) => k.startsWith("label:")).map(([k, v]) => {
            const key = k.slice(6);
            if (!key.startsWith("[")) return { valueId: key, label: text(v) };
            const [optionId, valueId] = JSON.parse(key);
            return { optionId, valueId, label: text(v) };
          }),
          members: Object.entries(values).filter(([k]) => k.startsWith("fulfillment:")).map(([k, v]) => ({ catalogItemId: k.slice(12), fulfillment: v as never })),
        });
        else throw new Error("Unknown variant action");
        return product(ctx, id, undefined, "Changes saved");
      }
    }
    throw new Error("Unknown interaction");
  } catch (error) {
    const failure = message(error);
    // A refused media choice returns the clerk to the product with the reason; stored values are unchanged.
    if (input.type === "block_action" && /^(media\.(use|clear|remove|up)|archive)$/.test(String(input.action_id))) {
      const v = input.value as { t?: unknown; id?: unknown } | null;
      try {
        const back = typeof v?.id === "string" && v.id ? await product(ctx, v.id) : null;
        if (back) return refused(failure, [alert(failure), ...back.blocks]);
      } catch { /* fall through to the generic alert */ }
    }
    // A refused form keeps what the owner typed: the product comes back with the same form refilled.
    if (input.type === "form_submit" && typeof input.action_id === "string" && /^(variant|weight|rename|save):/.test(input.action_id)) {
      try {
        const sent = input.action_id, args = sent.startsWith("variant:") ? JSON.parse(sent.slice(8)) : null;
        const back = await product(ctx, args ? args[1] : sent.replace(/^\w+:/, ""));
        for (const block of back.blocks) if (block.type === "form") {
          const next = args && block.submit.action_id.startsWith("variant:") ? JSON.parse(block.submit.action_id.slice(8)) : null;
          if (next ? next[0] !== args[0] || (args[0] === "price" && next[2] !== args[2]) : block.submit.action_id !== sent) continue;
          block.submit.action_id = sent;
          for (const field of block.fields) if (Object.hasOwn(values, field.action_id)) Object.assign(field, { initial_value: values[field.action_id] });
        }
        return refused(failure, [alert(failure), ...back.blocks]);
      } catch { /* storage recovery falls through to the render-only alert */ }
    }
    // Recovery is render-only: even a storage outage must not erase clerk input, nor pretend to know the stock tracking.
    const { regular, sale } = values, sent = String(input.action_id);
    if (sent.startsWith("save:") && typeof regular === "string" && typeof regular === typeof sale && (regular + sale).length <= 2048) {
      return refused(failure, [alert(failure), manageStockNotice(null), productForm(sent.slice(5), { regular, sale: sale as string, manageStock: null, stockStatus: null,
        ...(FEEDS.some(([channel]) => typeof values["feed:" + channel] === "boolean") ? { feedChannels: FEEDS.map(([channel]) => channel).filter(channel => values["feed:" + channel] === true) } : {}) })]);
    }
    return failed(failure);
  }
}
