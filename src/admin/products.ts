import { rememberReads } from "../features/catalog/kernel/index.js";
import type { Block, BlockResponse } from "@emdash-cms/blocks";
import type { PluginContext, SandboxedRouteContext } from "emdash/plugin";
import type { StorageCollection } from "emdash";
import {
  CatalogError, createCatalogItem, loadCatalogProduct, editProduct,
  linkProductPage, pageProduct, productNotFound, PRODUCT_PAGES_COLLECTION, type ProductPages,
  saveCatalogProductPrices, loadCatalogItemManualAvailability, loadCatalogItemMedia, saveCatalogItemMedia,
  admitV1CatalogPriceSaveInput, isManagedCatalogRecord, CATALOG_GALLERY_LIMIT,
  normalizeWeightOz, setCatalogItemWeight, setCatalogWeights, setCatalogProductArchived,
  addCatalogVariantOption, updateCatalogVariantLabels, normalizeIdentifierPatch,
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
// The catalog's unique index is named for the install's own collection: native installs keep catalogItems.
export const unique = (ctx: PluginContext) => ({ collection: "catalogItems" in ctx.storage ? "catalogItems" : "catalog_items", pluginId: ctx.plugin?.id });
export function storage(ctx: PluginContext) {
  return {
    catalog: ctx.storage["catalog_items"] as StorageCollection<CatalogStorageRecord>,
    prices: ctx.storage["catalog_prices"] as StorageCollection<CatalogPriceRecord>,
    availability: ctx.storage["catalog_manual_availability"] as StorageCollection<CatalogManualAvailabilityRecord>,
    media: ctx.storage["catalog_media"] as CatalogMediaStorage,
    pages: ctx.storage[PRODUCT_PAGES_COLLECTION] as ProductPages,
  };
}
export function feedEligibility(ctx: PluginContext) {
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
      ? base + ". This product stays managed."
      : managed === false
        ? base
        : base + ". Stock status hidden.",
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
const IDENTIFIERS = [["gtin", "GTIN"], ["mpn", "MPN"], ["brand", "Brand"]] as const;
const FULFILLMENT = [{ label: "Physical", value: "physical" }, { label: "Digital", value: "digital" }];
/** Shipping weight for each physical item, in ounces; Ship's label form starts from it. Digital items have none. */
function weightForm(selected: CatalogProductListItem): Block[] {
  const items = selected.variantProduct?.options.length
    ? selected.variantProduct.members.map(m => [m, "Weight (oz): " + m.selections.map(s => s.valueLabel).join(" / ")] as const)
    : [[selected, "Weight (oz)"] as const];
  const fields = items.filter(([item]) => item.fulfillment === "physical").map(([item, label]) =>
    ({ type: "text_input" as const, action_id: "w:" + item.catalogItemId, label, initial_value: item.weightOz === undefined ? "" : String(item.weightOz) }));
  return fields.length ? [header("Shipping weight"), { type: "form", block_id: "weight-" + crypto.randomUUID(), fields,
    submit: { label: "Save weight", action_id: "weight:" + JSON.stringify([selected.catalogItemId, selected.revision]) } }] : [];
}
function variantEditor(id: string, variant: CatalogProductListItem["variantProduct"]): Block[] {
  // A product is simple until it has a choice; adding one makes it variable (catalog-simple-product-label-20261027).
  if (!variant?.options.length) return [note("Simple product. Add a choice, like Size, to sell it in more than one version."), {
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
/** The Product image & gallery panel (catalog-media-panel-20261027): Commerce's picture and gallery for this product. */
async function mediaView(ctx: PluginContext, id: string, toast?: string): Promise<BlockResponse> {
  const store = storage(ctx);
  const selected = await loadCatalogProduct(store, id) ?? productNotFound();
  const name = selected.name, media: CatalogMediaRecord = await loadCatalogItemMedia(store.media, id);
  const blocks: Block[] = [header("Product image"), await preview(ctx, media.image, name), { type: "actions", elements: [
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
  return { blocks, ...(toast ? { toast: { type: "success", message: toast } } : {}) };
}
async function product(ctx: PluginContext, id: string, form?: CatalogProductPriceForm & { feedChannels?: readonly ProductFeedChannel[] }, toast?: string): Promise<BlockResponse> {
  const store = storage(ctx);
  const selected = await loadCatalogProduct(store, id) ?? productNotFound();
  const dormant = await loadCatalogItemManualAvailability(store.availability, id, store.catalog);
  const status = dormant.status === "available-on-backorder" ? "on-backorder" : dormant.status;
  const feeds = feedEligibility(ctx);
  const feedChannels = feeds ? await loadProductFeedEligibility(feeds, id, store.catalog) : undefined;
  const unpriced = selected.variantProduct?.options.length ? !selected.variantProduct.members.some(m => m.regular) : !selected.regular;
  const values = form ? { ...form, feedChannels: form.feedChannels ?? feedChannels } : { regular: selected.regular ?? "", sale: selected.sale ?? "", manageStock: selected.manageStock, stockStatus: selected.stockStatus, feedChannels };
  return { blocks: [
    header(selected.name),
    note((selected.archivedAt ? "Archived: off the shop" : selected.offSale ? "Draft: publish to sell it" : unpriced ? "Published: off the shop" : "On sale") + " \u00b7 SKU " + selected.sku + " \u00b7 Name comes from the page title"),
    // A missing Regular price keeps it off the shop whatever the page's state; it never means free.
    ...(unpriced && !selected.archivedAt ? [note(NO_PRICE)] : []),
    ...(form?.message ? [alert(form.message)] : []),
    manageStockNotice(values.manageStock),
    ...(!selected.variantProduct?.options.length ? [productForm(id, { ...values, stockStatus: values.stockStatus ?? status }, "save:" + JSON.stringify([id, selected.revision]))] : []),
    ...variantEditor(id, selected.variantProduct),
    ...weightForm(selected),
    // Barcode and brand for shopping feeds and the product page's structured data; empty clears one.
    { type: "form", block_id: "ids-" + crypto.randomUUID(), fields: IDENTIFIERS.map(([key, label]) =>
      ({ type: "text_input" as const, action_id: key, label, initial_value: selected[key] ?? "" })),
      submit: { label: "Save identifiers", action_id: "ids:" + id } },
    { type: "actions", elements: [selected.archivedAt ? button("Restore", "archive", { id, a: false })
      : { ...button("Archive product", "archive", { id, a: true }), style: "danger", confirm: { title: "Archive " + selected.name + "?",
        text: "Past orders keep it.", confirm: "Archive", deny: "Cancel", style: "danger" } }] },
  ], ...(toast ? { toast: { type: toast === NO_PRICE ? "info" : "success", message: toast } } : {}) };
}
async function saveGallery(ctx: PluginContext, id: string, edit: (gallery: string[]) => string[], toast: string): Promise<BlockResponse> {
  const store = storage(ctx);
  const current = await loadCatalogItemMedia(store.media, id);
  await saveCatalogItemMedia(store, { catalogItemId: id, gallery: edit(current.gallery.map((entry) => entry.mediaId)) });
  return mediaView(ctx, id, toast);
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
/** What the panel says of a product with no Regular price, and what a Save that leaves Regular empty answers. */
const NO_PRICE = "Add a Regular price to sell it";
const command = (action: string) => /^sell:[\w-]{8,64}$/.test(action) ? action.slice(5) : crypto.randomUUID();
/** An action id's tail: a JSON list, or the bare product id an older panel sent. */
const tail = (rest: string): [string, string?] => rest.startsWith("[") ? JSON.parse(rest) : [rest];
/** The sell form carries its create command, so a retry after a partial failure resumes the same product. Every product is made for its page (catalog-product-needs-page-20261031). */
function unlinked(sku = "", command: string = crypto.randomUUID()): BlockResponse {
  return { blocks: [
    note("Not a product yet. Add price and stock to sell it."),
    { type: "form", block_id: "sell-" + crypto.randomUUID(), fields: [{ type: "text_input", action_id: "sku", label: "SKU (optional)", initial_value: sku }],
      submit: { label: "Add price and stock", action_id: "sell:" + command } },
  ] };
}
/** A SKU from the page title, made unique with a tail from its create command so a retry asks for the same SKU. */
const skuFrom = (title: string, command: string) => (title.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40) + "-" + command.slice(0, 4)).toUpperCase().replace(/^-+/, "");
/** Links this page to a Commerce product; Commerce keeps the link, the page has no field for it (catalog-page-link-in-commerce-20261029). */
async function sell(ctx: PluginContext, entryId: string, fields: Record<string, unknown>, sku = "", command: string = crypto.randomUUID()): Promise<BlockResponse> {
  const store = storage(ctx);
  let id = await pageProduct(store.pages, entryId);
  let toast = "Linked.";
  if (!id) {
    // New products start as a physical Draft: off the shop until this page is published.
    const title = typeof fields.title === "string" && fields.title.trim() ? fields.title.trim().slice(0, 160) : "New product";
    // Its first write is already a Draft, so a retry that finds the earlier try's product finds a Draft.
    id = (await createCatalogItem(store.catalog, { commandId: "page:" + command, name: title, sku: sku.trim() || skuFrom(title, command), fulfillment: "physical" },
      { ...unique(ctx), offSale: true })).item.itemId;
    toast = "Draft made. Publish the page to sell it.";
  }
  // The product view refuses a product that is gone, before anything is linked.
  const view = await product(ctx, id, undefined, toast);
  await linkProductPage(store, entryId, id);
  return view;
}
/** The Dinkus Commerce panel on a product page: that page's price, sale, SKU, sizes, stock, weight and photos. */
export async function productPanel(route: SandboxedRouteContext, ctx: PluginContext): Promise<BlockResponse> {
  ctx = { ...ctx, storage: rememberReads(ctx.storage).storage as typeof ctx.storage };
  const entryId = route.ui?.surface === "content-editor-panel" ? route.ui.entry.id : "";
  if (!entryId) return failed("Invalid panel");
  const input = route.input as Record<string, unknown>;
  try {
    const draft = input.draft as Draft | undefined, fields = draft?.fields ?? {}, action = String(input.action_id ?? "");
    if (action.startsWith("sell")) return await sell(ctx, entryId, fields, text(object(input.values).sku ?? ""), command(action));
    if (input.type === "panel_load") {
      const linked = await pageProduct(storage(ctx).pages, entryId);
      return linked && await loadCatalogProduct(storage(ctx), linked) ? await product(ctx, linked) : unlinked();
    }
  } catch (error) {
    // A refused sell keeps the typed SKU, its create command and the buttons so the owner can retry.
    const sku = (input.values as Draft["fields"] | undefined)?.sku, again = unlinked(String(sku ?? "").slice(0, 1024), command(String(input.action_id ?? "")));
    return refused(message(error), [alert(message(error)), ...again.blocks]);
  }
  return productEdit(route, ctx);
}
/** The Product image & gallery panel on a product page; its picks and changes go through productEdit like the main panel's. */
export async function productMediaPanel(route: SandboxedRouteContext, ctx: PluginContext): Promise<BlockResponse> {
  const entryId = route.ui?.surface === "content-editor-panel" ? route.ui.entry.id : "";
  if (!entryId) return failed("Invalid panel");
  if (object(route.input).type !== "panel_load") return productEdit(route, ctx);
  try {
    const linked = await pageProduct(storage(ctx).pages, entryId);
    return linked && await loadCatalogProduct(storage(ctx), linked) ? await mediaView(ctx, linked) : { blocks: [note("Add price and stock in the Dinkus Commerce panel first, then choose its pictures here.")] };
  } catch (error) {
    return failed(message(error));
  }
}
async function productEdit(route: SandboxedRouteContext, ctx: PluginContext): Promise<BlockResponse> {
  let committed: { id: string; message: string } | undefined;
  let input: Record<string, unknown> = {};
  let values: Record<string, unknown> = {};
  try {
    input = object(route.input);
    const action = text(input.action_id);
    if (input.type === "block_action") {
      if (action === "open") return await product(ctx, text(input.value));
      // The image library's Cancel goes back to the Product image & gallery panel it was opened from.
      if (action === "media.open") return await mediaView(ctx, text(input.value));
      if (action === "archive") {
        const v = object(input.value);
        await setCatalogProductArchived(storage(ctx).catalog, { catalogItemId: v.id, archived: v.a }, undefined, true);
        committed = { id: text(v.id), message: v.a ? "Product archived" : "Restored as a Draft" };
        return await product(ctx, committed.id, undefined, committed.message);
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
          return await mediaView(ctx, t.id, mediaId ? "Image saved" : "Image removed");
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
        const [id, expectedRevision] = tail(action.slice(5));
        const store = storage(ctx);
        const item = await store.catalog.get(id);
        const wasManaged = isManagedCatalogRecord(item);
        const payload: Record<string, unknown> = {
          catalogItemId: id,
          regular: text(values.regular),
          sale: text(values.sale),
          expectedRevision,
        };
        if (Object.hasOwn(values, "manageStock")) payload.manageStock = values.manageStock;
        if (!wasManaged && values.stockStatus !== undefined) payload.stockStatus = text(values.stockStatus);
        const feedSubmitted = FEEDS.some(([channel]) => Object.hasOwn(values, "feed:" + channel));
        const channels = FEEDS.map(([channel]) => channel).filter(channel => values["feed:" + channel] === true);
        if (feedSubmitted) payload.feedChannels = channels;
        const saved = await saveCatalogProductPrices(store, admitV1CatalogPriceSaveInput(payload, wasManaged));
        if (saved.saved) committed = { id, message: saved.regular ? "Product saved" : NO_PRICE };
        return { ...await product(ctx, id, !saved.saved && feedSubmitted ? { ...saved, feedChannels: channels } : saved), toast: { type: !saved.saved ? "error" : saved.regular ? "success" : "info", message: saved.message ?? (saved.regular ? "Product saved" : NO_PRICE) } };
      }
      if (action.startsWith("ids:")) {
        const id = action.slice(4);
        // The same checks as the identifiers route (GS1 check digit, 256 characters); an empty box clears its field.
        const typed = normalizeIdentifierPatch(Object.fromEntries(IDENTIFIERS.map(([key]) => [key, text(values[key])])));
        await editProduct(storage(ctx).catalog, id, ({ gtin: _gtin, mpn: _mpn, brand: _brand, ...item }) => ({ ...item, ...Object.fromEntries(Object.entries(typed).filter(([, value]) => value)) }));
        return await product(ctx, id, undefined, "Identifiers saved");
      }
      if (action.startsWith("weight:")) {
        const [id, expectedRevision] = tail(action.slice(7));
        const typed = Object.entries(values).filter(([key]) => key.startsWith("w:")).map(([key, value]) => [key.slice(2), value] as const);
        await setCatalogWeights(storage(ctx).catalog, id, typed, expectedRevision);
        committed = { id, message: "Weight saved" };
        return await product(ctx, id, undefined, "Weight saved");
      }
      if (action.startsWith("variant:")) {
        const [operation, id, ...args] = JSON.parse(action.slice(8));
        const store = storage(ctx);
        const selected = await loadCatalogProduct(store, id) ?? productNotFound();
        if (operation === "add") await addCatalogVariantOption(store, {
          productId: id, optionId: args[0], optionLabel: text(values.optionLabel), values: [
            { valueId: args[1], label: text(values.smallLabel), member: { catalogItemId: id, fulfillment: values.first as never } },
            { valueId: args[2], label: text(values.largeLabel), member: { commandId: args[3], name: selected.name, sku: text(values.sku), fulfillment: values.second as never } },
          ],
        }, unique(ctx));
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
          }, unique(ctx));
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
          }, unique(ctx));
        } else if (operation === "price") {
          const member = selected.variantProduct?.members.find(m => m.catalogItemId === args[0]);
          if (!member) throw new Error("Member unavailable");
          const saved = await saveCatalogProductPrices(store, { catalogItemId: args[0], expectedRevision: args[1], regular: text(values.regular), sale: text(values.sale),
            ...(!member.manageStock && values.stockStatus !== undefined ? { stockStatus: text(values.stockStatus) } : {}) });
          if (!saved.saved) throw new Error(saved.message ?? "Could not save price");
          committed = { id, message: saved.regular ? "Changes saved" : NO_PRICE };
          if (!saved.regular) return await product(ctx, id, undefined, NO_PRICE);
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
        return await product(ctx, id, undefined, "Changes saved");
      }
    }
    throw new Error("Unknown interaction");
  } catch (error) {
    if (committed) return { toast: { type: committed.message === NO_PRICE ? "info" : "success", message: committed.message }, blocks: [
      note("Your changes were saved. Reload the product to refresh this panel."),
      { type: "actions", elements: [button("Reload product", "open", committed.id)] },
    ] };
    if (error instanceof CatalogError && error.code === "SAVE_OUTCOME_UNKNOWN") return {
      toast: { type: "info", message: error.message }, blocks: [note(error.message)],
    };
    const failure = message(error);
    // A refused media choice returns the clerk to the pictures (an archive, to the product) with the reason; stored values are unchanged.
    if (input.type === "block_action" && /^(media\.(use|clear|remove|up)|archive)$/.test(String(input.action_id))) {
      const v = input.value as { t?: unknown; id?: unknown } | null;
      try {
        const back = typeof v?.id === "string" && v.id ? await (input.action_id === "archive" ? product : mediaView)(ctx, v.id) : null;
        if (back) return refused(failure, [alert(failure), ...back.blocks]);
      } catch { /* fall through to the generic alert */ }
    }
    // A refused form keeps what the owner typed: the product comes back with the same form refilled.
    if (input.type === "form_submit" && typeof input.action_id === "string" && /^(variant|weight|save|ids):/.test(input.action_id)) {
      try {
        const sent = input.action_id, args = sent.startsWith("variant:") ? JSON.parse(sent.slice(8)) : null;
        const rawId = sent.replace(/^\w+:/, "");
        const back = await product(ctx, args ? args[1] : tail(rawId)[0]);
        for (const block of back.blocks) if (block.type === "form") {
          const next = args && block.submit.action_id.startsWith("variant:") ? JSON.parse(block.submit.action_id.slice(8)) : null;
          const key = (action: string) => {
            const raw = action.replace(/^\w+:/, "");
            return action.split(":")[0] + ":" + tail(raw)[0];
          };
          const sameForm = key(block.submit.action_id) === key(sent);
          if (next ? next[0] !== args[0] || (args[0] === "price" && next[2] !== args[2]) : !sameForm) continue;
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
