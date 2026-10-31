import { rememberReads } from "../features/catalog/kernel/index.js";
import type { Block, BlockResponse } from "@emdash-cms/blocks";
import type { PluginContext, SandboxedRouteContext } from "emdash/plugin";
import type { StorageCollection } from "emdash";
import {
  CatalogError, createProductForPage, changeCatalogItemSku, loadCatalogProduct, editProduct,
  pageProduct, productNotFound, PRODUCT_PAGES_COLLECTION, type ProductPages,
  saveCatalogProductPrices, loadCatalogItemManualAvailability, loadCatalogItemMedia, saveCatalogItemMedia,
  admitV1CatalogPriceSaveInput, isManagedCatalogRecord, CATALOG_GALLERY_LIMIT,
  setCatalogWeights, setCatalogProductArchived,
  addCatalogVariantOption, updateCatalogVariantLabels, normalizeIdentifierPatch,
  type CatalogStorageRecord, type CatalogPriceRecord, type CatalogManualAvailabilityRecord,
  type CatalogProductPriceForm, type CatalogProductListItem, type CatalogMediaRecord, type CatalogMediaStorage,
} from "../features/catalog/kernel/index.js";
import { loadProductFeedEligibility, type ProductFeedChannel, type ProductFeedEligibilityRecord } from "../features/feeds/kernel/index.js";
import { alert, button, failed, fresh, header, input, message, note, object, radio, refused, submit, text, toggle } from "./common.js";
import { REGISTRY_BUILD } from "../shared/registry-build.js";
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
  sku?: string;
  manageStock: boolean | null;
  stockStatus: CatalogProductPriceForm["stockStatus"];
  feedChannels?: readonly ProductFeedChannel[];
};
type Form = Extract<Block, { type: "form" }>;
function manageStockNotice(managed: boolean | null): Block {
  // The Registry build never manages a product (registry-headroom-20261031), so it has the one text.
  return note("Manage stock — Coming soon" + (!REGISTRY_BUILD && managed ? ". This product stays managed." : ""));
}
const FEEDS = [["google-merchant", "Google Merchant"], ["meta-catalog", "Meta catalog"]] as const;
/** A card the owner opens with a press, as on Shopify's product form; everything inside is an ordinary block (catalog-panel-cards-20261031). */
const card = (label: string, blocks: Block[], open = false): Block => ({ type: "accordion", label, blocks, default_open: open });
/** Forms on the panel, the ones inside cards included. */
const forms = (blocks: Block[]): Form[] => blocks.flatMap(b => b.type === "form" ? [b] : b.type === "accordion" ? forms(b.blocks) : []);
/** Regular, Sale, SKU, stock status and the feed channels save together in one press (feeds-facts-consistency-060). */
function productForm(id: string, values: ProductFields, action = "save:" + id): Block {
  return { type: "form", block_id: fresh("p"), fields: [
      input("regular", "Regular", values.regular),
      input("sale", "Sale", values.sale),
      ...(values.sku === undefined ? [] : [input("sku", "SKU", values.sku)]),
      ...(values.manageStock === false ? [radio("stockStatus", "Stock status", STOCK_OPTIONS, values.stockStatus ?? undefined)] : []),
      ...(values.feedChannels === undefined ? [] : FEEDS.map(([channel, label]) =>
        toggle("feed:" + channel, label, values.feedChannels!.includes(channel)))),
    ], submit: submit("Save", action) };
}
const IDENTIFIERS = [["gtin", "GTIN"], ["mpn", "MPN"], ["brand", "Brand"]] as const;
const FULFILLMENT = [{ label: "Physical", value: "physical" }, { label: "Digital", value: "digital" }];
const label = (m: { selections: readonly { valueLabel: string }[] }) => m.selections.map(s => s.valueLabel).join(" / ");
/** What the status grid says of the product: its state, SKU, name and how many variants it sells in. */
function statusGrid(selected: CatalogProductListItem, unpriced: boolean): Block {
  return { type: "fields", fields: [
    { label: "Status", value: selected.archivedAt ? "Archived: off the shop" : selected.offSale ? "Draft: publish to sell it" : unpriced ? "Published: off the shop" : "On sale" },
    { label: "SKU", value: selected.sku },
    { label: "Name (page title)", value: selected.name },
  ] };
}
/** Shipping weight for each physical item, in ounces; Ship's label form starts from it. Digital items have none. */
function shippingCard(selected: CatalogProductListItem, open: boolean): Block[] {
  const items = selected.variantProduct?.options.length
    ? selected.variantProduct.members.map(m => [m, "Weight (oz): " + label(m)] as const)
    : [[selected, "Weight (oz)"] as const];
  const fields = items.filter(([item]) => item.fulfillment === "physical").map(([item, l]) =>
    input("w:" + item.catalogItemId, l, item.weightOz === undefined ? "" : String(item.weightOz)));
  return fields.length ? [card("Shipping", [{ type: "form", block_id: fresh("w"), fields,
    submit: submit("Save weight", "weight:" + JSON.stringify([selected.catalogItemId, selected.revision])) }], open)] : [];
}
/**
 * The Variants card. A product is simple until it has an option (product-variant-model-20261008): the card stays
 * collapsed and asks for an option name and its values, as Shopify's "Add options like size or color" does. Once it
 * has options, each variant is its own card with Regular, Sale, SKU and stock status.
 */
function variantsCard(id: string, selected: CatalogProductListItem, focus?: string): Block {
  const variant = selected.variantProduct;
  if (!variant?.options.length) return card("Variants · none", [
    note("The product is the first variant."),
    { type: "form", block_id: "a" + id, fields: [
      input("optionLabel", "Option name", "Size"),
      { type: "text_input", action_id: "values", label: "Option values", placeholder: "Small, Large" },
    ], submit: submit("Add options", "variant:" + JSON.stringify(["add", id, crypto.randomUUID()])) },
  ], focus === "add");
  return card("Variants · " + variant.members.length, [
    // The variant just saved or refused stays open; otherwise the first one is.
    ...variant.members.map((m, i) => card(label(m) + (m.regular ? " · $" + m.regular : ""), [
      manageStockNotice(m.manageStock),
      productForm(m.catalogItemId, { ...m, regular: m.regular ?? "", sale: m.sale ?? "" }, "variant:" + JSON.stringify(["price", id, m.catalogItemId, m.priceRevision, m.sku])),
    ], focus === m.catalogItemId || !i && !variant.members.some(x => x.catalogItemId === focus))),
    card("Edit options", [{ type: "form", block_id: fresh("d"), fields: [
      ...variant.options.flatMap((o, i) => [
        input(i ? "option:" + o.optionId : "optionLabel", "Option: " + o.label, o.label),
        ...o.values.map(v => input("label:" + JSON.stringify([o.optionId, v.valueId]), "Value: " + v.label, v.label)),
      ]),
      ...variant.members.map(m => radio("fulfillment:" + m.catalogItemId, label(m) + " fulfillment", FULFILLMENT, m.fulfillment)),
    ], submit: submit("Save options", "variant:" + JSON.stringify(["details", id, variant.revision])) }], focus === "details"),
    ...(variant.options.length < 3 ? [card("Add another option", [{ type: "form" as const, block_id: fresh("o"), fields: [
      input("optionLabel", "Option name", ["Color", "Material"][variant.options.length - 1]),
      input("values", "Option values"),
      ...variant.members.map(m => input("member:" + m.catalogItemId, "Value for " + label(m))),
    ], submit: submit("Add option", "variant:" + JSON.stringify(["option", id, variant.revision])) }], focus === "option")] : []),
    ...(variant.members.length < 50 ? [card("Add a variant", [{ type: "form" as const, block_id: fresh("m"), fields: [
      ...variant.options.map(o => input("value:" + o.optionId, o.label)),
      input("sku", "SKU"),
      radio("fulfillment", "Fulfillment", FULFILLMENT, selected.fulfillment),
    ], submit: submit("Add variant", "variant:" + JSON.stringify(["member", id, variant.revision, crypto.randomUUID()])) }], focus === "member")] : []),
  ], true);
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
type PriceForm = CatalogProductPriceForm & { feedChannels?: readonly ProductFeedChannel[]; sku?: string };
/** `focus` names the card to draw open: the variant, or the card, just saved or refused, so the owner stays where they were. */
async function product(ctx: PluginContext, id: string, form?: PriceForm, toast?: string, focus?: string): Promise<BlockResponse> {
  const store = storage(ctx);
  const selected = await loadCatalogProduct(store, id) ?? productNotFound();
  const dormant = await loadCatalogItemManualAvailability(store.availability, id, store.catalog);
  const status = dormant.status === "available-on-backorder" ? "on-backorder" : dormant.status;
  const feeds = feedEligibility(ctx);
  const feedChannels = feeds ? await loadProductFeedEligibility(feeds, id, store.catalog) : undefined;
  const simple = !selected.variantProduct?.options.length;
  const unpriced = simple ? !selected.regular : !selected.variantProduct!.members.some(m => m.regular);
  const values = { regular: selected.regular ?? "", sale: selected.sale ?? "", manageStock: selected.manageStock, stockStatus: selected.stockStatus, feedChannels, ...form };
  return { blocks: [
    statusGrid(selected, unpriced),
    // A missing Regular price keeps it off the shop whatever the page's state; it never means free.
    ...(unpriced && !selected.archivedAt ? [note(NO_PRICE)] : []),
    ...(form?.message ? [alert(form.message)] : []),
    ...(simple ? [header("Pricing & stock"), manageStockNotice(values.manageStock),
      productForm(id, { ...values, sku: form?.sku ?? selected.sku, stockStatus: values.stockStatus ?? status }, "save:" + JSON.stringify([id, selected.revision]))] : []),
    variantsCard(id, selected, focus),
    ...shippingCard(selected, focus === "weight"),
    // Barcode and brand for shopping feeds and the product page's structured data; empty clears one.
    card("Identifiers", [{ type: "form", block_id: fresh("i"), fields: IDENTIFIERS.map(([key, l]) =>
        input(key, l, selected[key] ?? "")),
        submit: submit("Save identifiers", "ids:" + id) }], focus === "ids"),
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
  const base = label.replace(/[^a-z0-9]+/g, "-").slice(0, 48).replace(/^-|-$/g, "") || fallback;
  let id = base;
  for (let n = 2; taken.some(v => v.valueId === id); n++) id = base + "-" + n;
  return id;
}
/** Option values as typed, comma-separated: trimmed, distinct, two or more. */
function valueLabels(raw: unknown): string[] {
  const labels: string[] = [];
  for (const s of text(raw).split(",")) { const l = s.trim(); if (l && !labels.some(x => x.toLowerCase() === l.toLowerCase())) labels.push(l); }
  if (labels.length < 2) throw new CatalogError("INVALID_INPUT", "Give two or more values.");
  return labels;
}
/** A new variant's SKU: the product's SKU, cut on a segment boundary so the value's id fits after it and never its own SKU; the owner can change it after. */
const variantSku = (base: string, valueId: string, cut = 63): string => {
  const sku = (base.slice(0, cut - valueId.length).replace(/-+$/, "") + "-" + valueId).toUpperCase();
  return sku === base ? variantSku(base, valueId, 62) : sku;
};
// A stale page must never act on a different image than its label named.
function galleryIndex(value: unknown, mediaId: string, gallery: string[]): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= gallery.length) throw new Error("Invalid image");
  if (gallery[value as number] !== mediaId) throw new CatalogError("INVALID_INPUT", "The gallery changed. Reload.");
  return value as number;
}
type Draft = { fields?: Record<string, unknown> };
/** What the panel says of a product with no Regular price, and what a Save that leaves Regular empty answers. */
const NO_PRICE = "Add a Regular price to sell it";
const command = (action: string) => /^sell:[\w-]{8,64}$/.test(action) ? action.slice(5) : crypto.randomUUID();
/** An action id's tail: a JSON list, or the bare product id an older panel sent. */
const tail = (rest: string): [string, string?] => rest.startsWith("[") ? JSON.parse(rest) : [rest];
/**
 * A page with no product opens on its price, stock and shipping form; its Save makes the product
 * (catalog-first-save-creates-20261031). The form carries its create command, so a retry after a partial
 * failure resumes the same product, and a refused Save keeps what was typed.
 */
function unlinked(values: Record<string, unknown> = {}, command: string = crypto.randomUUID()): BlockResponse {
  const v = (key: string, fallback = "") => typeof values[key] === "string" ? values[key] as string : fallback;
  return { blocks: [
    note("Save makes the product as a Draft."),
    { type: "form", block_id: fresh("s"), fields: [
      input("regular", "Regular", v("regular")),
      input("sale", "Sale", v("sale")),
      input("sku", "SKU", v("sku")),
      radio("stockStatus", "Stock status", STOCK_OPTIONS, v("stockStatus", "in-stock")),
      toggle("physical", "Physical", values.physical !== false),
      { type: "text_input", action_id: "weightOz", label: "Weight (oz)", initial_value: v("weightOz"), condition: { field: "physical", eq: true } },
    ], submit: submit("Save", "sell:" + command) },
  ] };
}
/** A SKU from the page title, made unique with a tail from its create command so a retry asks for the same SKU. */
const skuFrom = (title: string, command: string) => (title.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40) + "-" + command.slice(0, 4)).toUpperCase().replace(/^-+/, "");
/** Makes this page's product from the form; Commerce keeps the link, the page has no field for it (catalog-page-link-in-commerce-20261029). */
async function sell(ctx: PluginContext, entryId: string, fields: Record<string, unknown>, values: Record<string, unknown>, command: string): Promise<BlockResponse> {
  // New products start as a Draft: off the shop until this page is published.
  const title = typeof fields.title === "string" && fields.title.trim() ? fields.title.trim().slice(0, 160) : "New product";
  const sku = text(values.sku ?? "").trim(), physical = values.physical !== false;
  // A price is written only when the form carries one (an older panel's Save sent only a SKU); the kernel checks the values.
  const made = await createProductForPage(storage(ctx), { entryId, commandId: "page:" + command, name: title, sku: sku || skuFrom(title, command),
    fulfillment: physical ? "physical" : "digital", regular: values.regular, sale: values.sale, stockStatus: values.stockStatus, weightOz: physical ? values.weightOz : undefined }, unique(ctx));
  const price = made.price;
  if (price && !price.saved) return { ...await product(ctx, made.catalogItemId, { ...price, ...(sku ? { sku } : {}) }), toast: { type: "error", message: price.message ?? NO_PRICE } };
  return product(ctx, made.catalogItemId, undefined, "Draft made. Publish the page to sell it.");
}
/** The Dinkus Commerce panel on a product page: that page's price, sale, SKU, variants, stock, weight and identifiers. */
export async function productPanel(route: SandboxedRouteContext, ctx: PluginContext): Promise<BlockResponse> {
  ctx = { ...ctx, storage: rememberReads(ctx.storage).storage as typeof ctx.storage };
  const entryId = route.ui?.surface === "content-editor-panel" ? route.ui.entry.id : "";
  if (!entryId) return failed("Invalid panel");
  const input = route.input as Record<string, unknown>;
  try {
    const draft = input.draft as Draft | undefined, fields = draft?.fields ?? {}, action = String(input.action_id ?? "");
    if (action.startsWith("sell")) return await sell(ctx, entryId, fields, object(input.values ?? {}), command(action));
    if (input.type === "panel_load") {
      const linked = await pageProduct(storage(ctx).pages, entryId);
      return linked && await loadCatalogProduct(storage(ctx), linked) ? await product(ctx, linked) : unlinked();
    }
  } catch (error) {
    // A refused Save keeps what was typed, its create command and the button so the owner can retry.
    return refused(message(error), [alert(message(error)), ...unlinked((input.values ?? {}) as Record<string, unknown>, command(String(input.action_id ?? ""))).blocks]);
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
    return linked && await loadCatalogProduct(storage(ctx), linked) ? await mediaView(ctx, linked) : { blocks: [note("Save the product in the Dinkus Commerce panel first.")] };
  } catch (error) {
    return failed(message(error));
  }
}
async function productEdit(route: SandboxedRouteContext, ctx: PluginContext): Promise<BlockResponse> {
  let committed: { id: string; message: string } | undefined;
  let input: Record<string, unknown> = {};
  let values: Record<string, unknown> = {};
  /** The feed toggles as submitted, when the form had them: the channels switched on. */
  const feeds = () => "feed:google-merchant" in values ? FEEDS.map(([c]) => c).filter(c => values["feed:" + c] === true) : undefined;
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
      const store = storage(ctx);
      // A typed SKU that differs from the one the form showed is changed first, fenced on what the form read (the product's
      // revision and, for a variant, its SKU): a stale form is refused whole, and a SKU another product has is refused
      // before anything is saved, so the refilled form's revision still holds. A changed SKU moves the fence on, so the
      // price save that follows is bound to the record this request just wrote.
      const fenceOf = (revision: unknown, sku?: string) => typeof revision === "string" ? { revision, sku } : undefined;
      const resku = (id: string, current: string, fence?: { revision: string }) =>
        values.sku !== undefined && text(values.sku).trim().toUpperCase() !== current && changeCatalogItemSku(store.catalog, id, values.sku, unique(ctx), fence);
      if (action.startsWith("save:")) {
        const [id, revision] = tail(action.slice(5)), fence = fenceOf(revision);
        const item = await store.catalog.get(id);
        const wasManaged = isManagedCatalogRecord(item);
        const payload: Record<string, unknown> = { catalogItemId: id, regular: text(values.regular), sale: text(values.sale) };
        if (Object.hasOwn(values, "manageStock")) payload.manageStock = values.manageStock;
        if (!wasManaged && values.stockStatus !== undefined) payload.stockStatus = text(values.stockStatus);
        const channels = feeds();
        if (channels) payload.feedChannels = channels;
        await resku(id, (item as { sku?: string } | null)?.sku ?? "", fence);
        payload.expectedRevision = fence?.revision ?? revision;
        const saved = await saveCatalogProductPrices(store, admitV1CatalogPriceSaveInput(payload, wasManaged));
        if (saved.saved) committed = { id, message: saved.regular ? "Product saved" : NO_PRICE };
        const typed = values.sku === undefined ? {} : { sku: text(values.sku) };
        return { ...await product(ctx, id, { ...saved, ...typed, ...(!saved.saved && channels ? { feedChannels: channels } : {}) }), toast: { type: !saved.saved ? "error" : saved.regular ? "success" : "info", message: saved.message ?? (saved.regular ? "Product saved" : NO_PRICE) } };
      }
      if (action.startsWith("ids:")) {
        const id = action.slice(4);
        // The same checks as the identifiers route (GS1 check digit, 256 characters); an empty box clears its field.
        const typed = normalizeIdentifierPatch(Object.fromEntries(IDENTIFIERS.map(([key]) => [key, text(values[key])])));
        await editProduct(store.catalog, id, ({ gtin: _gtin, mpn: _mpn, brand: _brand, ...item }) => ({ ...item, ...Object.fromEntries(Object.entries(typed).filter(([, value]) => value)) }));
        return await product(ctx, id, undefined, "Identifiers saved", "ids");
      }
      if (action.startsWith("weight:")) {
        const [id, expectedRevision] = tail(action.slice(7));
        const typed = Object.entries(values).filter(([key]) => key.startsWith("w:")).map(([key, value]) => [key.slice(2), value] as const);
        await setCatalogWeights(store.catalog, id, typed, expectedRevision);
        committed = { id, message: "Weight saved" };
        return await product(ctx, id, undefined, "Weight saved", "weight");
      }
      if (action.startsWith("variant:")) {
        const [operation, id, ...args] = JSON.parse(action.slice(8));
        const selected = await loadCatalogProduct(store, id) ?? productNotFound();
        const optionId = () => valueIdFor(text(values.optionLabel).toLowerCase(), "option" + (selected.variantProduct?.options.length ?? 0), []);
        if (operation === "add") {
          // The product itself is the first variant; each other value is a new one with the product's SKU plus the value.
          const f = selected.fulfillment, taken: { valueId: string }[] = [];
          await addCatalogVariantOption(store, { productId: id, optionId: optionId(), optionLabel: text(values.optionLabel), values: valueLabels(values.values).map((l, i) => {
            const valueId = valueIdFor(l.toLowerCase(), "v" + i, taken);
            taken.push({ valueId });
            return { valueId, label: l, member: i ? { commandId: args[0] + "-" + i, name: selected.name, sku: variantSku(selected.sku, valueId), fulfillment: f } : { catalogItemId: id, fulfillment: f } };
          }) }, unique(ctx));
        } else if (operation === "option") {
          const byLabel = new Map<string, { valueId: string; label: string }>();
          const ensure = (rawLabel: unknown) => {
            const l = text(rawLabel), k = l.toLowerCase();
            if (!byLabel.has(k)) byLabel.set(k, { valueId: valueIdFor(k, "v", [...byLabel.values()]), label: l });
            return byLabel.get(k)!.valueId;
          };
          for (const l of valueLabels(values.values)) ensure(l);
          const members = (selected.variantProduct?.members ?? []).map(m => ({
            catalogItemId: m.catalogItemId, valueId: ensure(values["member:" + m.catalogItemId]), fulfillment: m.fulfillment,
          }));
          await addCatalogVariantOption(store, {
            productId: id, expectedRevision: args[0], optionId: optionId(), optionLabel: text(values.optionLabel),
            values: [...byLabel.values()], members,
          }, unique(ctx));
        } else if (operation === "member") {
          const selections = (selected.variantProduct?.options ?? []).map((o, i) => {
            const l = text(values["value:" + o.optionId]), k = l.toLowerCase();
            const found = o.values.find(v => v.label.toLowerCase() === k || v.valueId === l);
            if (found) return { optionId: o.optionId, valueId: found.valueId };
            return { optionId: o.optionId, valueId: valueIdFor(k, "v" + i, o.values), label: l };
          });
          await addCatalogVariantOption(store, {
            productId: id, expectedRevision: args[0], commandId: args[1], name: selected.name,
            sku: text(values.sku), fulfillment: values.fulfillment as never, selections,
          }, unique(ctx));
        } else if (operation === "price") {
          const member = selected.variantProduct?.members.find(m => m.catalogItemId === args[0]) ?? productNotFound();
          const shown = args[2] ?? member.sku, fence = fenceOf(args[1], shown), regular = text(values.regular), sale = text(values.sale);
          const stock = !member.manageStock && values.stockStatus !== undefined ? { stockStatus: text(values.stockStatus) } : {};
          await resku(args[0], shown, fence);
          const saved = await saveCatalogProductPrices(store, { catalogItemId: args[0], expectedRevision: fence?.revision ?? args[1], regular, sale, ...stock });
          // A price refused after the fence held is this request's own doing: the typing comes back on a form that reads the product as it now is.
          if (!saved.saved) throw Object.assign(new CatalogError("INVALID_INPUT", saved.message ?? NO_PRICE), { fresh: true });
          committed = { id, message: saved.regular ? "Changes saved" : NO_PRICE };
          if (!saved.regular) return await product(ctx, id, undefined, NO_PRICE, args[0]);
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
        else throw new Error("Unknown action");
        return await product(ctx, id, undefined, "Changes saved", operation === "price" ? args[0] : operation);
      }
    }
    throw new Error("Unknown action");
  } catch (error) {
    if (committed) return { toast: { type: committed.message === NO_PRICE ? "info" : "success", message: committed.message }, blocks: [
      note("Saved. Reload the product."),
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
    // A refused form keeps what the owner typed: the product comes back with the same form refilled, inside its card.
    if (input.type === "form_submit" && typeof input.action_id === "string" && /^(variant|weight|save|ids):/.test(input.action_id)) {
      try {
        // An action id names its form: the operation, the product, and for a variant's price form the variant.
        const sent = input.action_id, named = (a: string): string[] => a.startsWith("variant:") ? JSON.parse(a.slice(8)) : [a.split(":")[0], tail(a.replace(/^\w+:/, ""))[0]];
        const [op, target, member] = named(sent);
        const back = await product(ctx, target, undefined, undefined, op === "price" ? member : op);
        for (const block of forms(back.blocks)) {
          const [o, , m] = named(block.submit.action_id);
          if (o !== op || (op === "price" && m !== member)) continue;
          // A price refused after its fence held keeps the fresh id, which reads the product after this request's own
          // writes, such as its SKU; every other form keeps the sent one, so a stale form stays refused until the owner
          // reloads and a retry resumes the same command.
          if (!(error as { fresh?: true } | null)?.fresh) block.submit.action_id = sent;
          for (const field of block.fields) if (Object.hasOwn(values, field.action_id)) Object.assign(field, { initial_value: values[field.action_id] });
        }
        return refused(failure, [alert(failure), ...back.blocks]);
      } catch { /* storage recovery falls through to the render-only alert */ }
    }
    // Even a storage outage must not erase the typing: the price form comes back as typed, claiming nothing about stock.
    const { regular, sale, sku } = values, sent = String(input.action_id);
    if (sent.startsWith("save:") && typeof regular === "string" && typeof sale === "string")
      return refused(failure, [alert(failure), productForm(sent.slice(5), { regular, sale, ...(typeof sku === "string" ? { sku } : {}), manageStock: null, stockStatus: null, feedChannels: feeds() })]);
    return failed(failure);
  }
}
