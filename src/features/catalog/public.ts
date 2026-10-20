import type { PluginContext } from "emdash/plugin";
import { resolveCatalogItemPrice } from "./price.js";
import { loadCatalogItemMedia, type CatalogMediaStorage } from "./media.js";
import { createProductImageProjector, type PublicCatalogImage } from "./media-projector.js";
import {
  loadStorefrontPlaceholderImage,
  resolveStorefrontAvailability,
  type StorefrontPlaceholderImageStorage,
} from "../storefront-availability/kernel/index.js";
import type { CatalogItemRecord, CatalogStorageRecord } from "./types.js";
import {
  resolveCatalogVariantMember,
  variantSelections,
  type CatalogVariantProduct,
} from "./variants.js";
import { bindGuestCheckoutRuntime, SANDBOX_GUEST_CHECKOUT_STORAGE } from "../checkout/kernel/index.js";
import { rememberReads } from "./remembered-reads.js";
import type { StorefrontAvailabilityResult } from "../storefront-availability/kernel/index.js";
import {
  loadProductFeedEligibility,
  PRODUCT_FEED_ELIGIBILITY_SANDBOX_COLLECTION,
  type ProductFeedChannel,
  type ProductFeedEligibilityStorage,
} from "../feeds/kernel/index.js";

function unavailable(): never { throw new Error("Catalog unavailable"); }
function optionalIds(item: { gtin?: string; mpn?: string; brand?: string }) {
  return {
    ...(item.gtin ? { gtin: item.gtin } : {}),
    ...(item.mpn ? { mpn: item.mpn } : {}),
    ...(item.brand ? { brand: item.brand } : {}),
  };
}

export const PUBLIC_CATALOG_ROUTE = "catalog/public";
export const PUBLIC_CATALOG_ITEM_ROUTE = "catalog/public/item";
export interface PublicCatalogProduct {
  readonly id: string;
  readonly name: string;
  readonly sku: string;
  readonly price?: { readonly currency: "USD"; readonly minor: string };
  readonly availability: Pick<StorefrontAvailabilityResult, "status" | "sellable" | "listable">;
  /** Primary image, the store placeholder (placeholder: true), or null when neither resolves. The host maps ids to URLs. */
  readonly image: PublicCatalogImage | null;
  readonly gallery: readonly PublicCatalogImage[];
  /** Optional merchant identifiers; omitted when unset. Never invented. */
  readonly gtin?: string;
  readonly mpn?: string;
  readonly brand?: string;
  /** Merchant-approved public feed channels; absent on older storage adapters. */
  readonly feedChannels?: readonly ProductFeedChannel[];
  readonly variants?: {
    readonly schema: "dinkuskit.commerce.product-variants/v1";
    readonly productId: string;
    readonly options: CatalogVariantProduct["options"];
    readonly members: readonly {
      catalogItemId: string;
      selections: readonly ReturnType<typeof variantSelections>[number][];
      price: { readonly currency: "USD"; readonly minor: string } | null;
      availability: Pick<StorefrontAvailabilityResult, "status" | "sellable" | "listable">;
      fulfillment: "physical" | "digital";
    }[];
  };
}
export interface PublicCatalogResponse {
  readonly products: readonly PublicCatalogProduct[];
  readonly cursor?: string;
}

function assertItemId(itemId: string): void {
  if (typeof itemId !== "string" || !itemId || itemId.length > 1024) unavailable();
}

async function projectPublicCatalogProduct(
  mediaStorage: CatalogMediaStorage,
  storage: ReturnType<typeof bindGuestCheckoutRuntime>["catalog"],
  item: CatalogStorageRecord,
  images: ReturnType<typeof createProductImageProjector>,
  placeholder: Awaited<ReturnType<typeof loadStorefrontPlaceholderImage>>["image"],
  eligibility: Pick<ProductFeedEligibilityStorage, "get"> | undefined,
): Promise<PublicCatalogProduct | null> {
  if (
    item.recordKind !== "catalog-item" ||
    [item.itemId, item.name, item.sku].some(
      (value) => typeof value !== "string" || !value || value.length > 1024,
    )
  ) {
    unavailable();
  }
  if (item.archivedAt) return null;
  const variant = await resolveCatalogVariantMember(storage.catalog, item.itemId);
  if (variant === null) return null;
  const availability = await resolveStorefrontAvailability(storage, { catalogItemId: item.itemId });
  const price = await resolveCatalogItemPrice(storage.prices, item.itemId);
  const media = await loadCatalogItemMedia(mediaStorage, item.itemId);
  const image =
    (media.image && (await images.project(media.image, item.name))) ||
    (placeholder && (await images.project(placeholder, item.name, true))) ||
    null;
  const gallery: PublicCatalogImage[] = [];
  for (const entry of media.gallery) {
    const projected = await images.project(entry, item.name);
    if (projected) gallery.push(projected);
  }
  const feedChannels = eligibility
    ? await loadProductFeedEligibility(eligibility, item.itemId)
    : undefined;
  if (variant.product) {
    const members = [];
    for (const member of variant.product.members) {
      const memberItem = await resolveCatalogVariantMember(storage.catalog, member.catalogItemId);
      if (!memberItem?.member || memberItem.product?.productId !== variant.product.productId) continue;
      const memberPrice = await resolveCatalogItemPrice(storage.prices, member.catalogItemId);
      if (!memberPrice.listable || !memberPrice.customerPays) continue;
      const memberAvailability = await resolveStorefrontAvailability(storage, {
        catalogItemId: member.catalogItemId,
      });
      if (!memberAvailability.listable) continue;
      members.push({
        catalogItemId: member.catalogItemId,
        selections: variantSelections(variant.product, member),
        price: memberPrice.customerPays ?? null,
        availability: {
          status: memberAvailability.status,
          sellable: memberAvailability.sellable,
          listable: memberAvailability.listable,
        },
        fulfillment: member.fulfillment,
      });
    }
    if (!members.length) return null;
    return {
      id: variant.product.productId,
      name: item.name,
      sku: item.sku,
      ...(!variant.product.options.length && price.customerPays ? { price: price.customerPays } : {}),
      availability: { status: availability.status, sellable: !variant.product.options.length && availability.sellable, listable: members.some((member) => member.availability.listable) },
      image,
      gallery,
      ...optionalIds(item),
      ...(feedChannels ? { feedChannels } : {}),
      variants: {
        schema: variant.product.schema,
        productId: variant.product.productId,
        options: variant.product.options,
        members,
      },
    };
  }
  if (!price.listable || !price.customerPays || !availability.listable) return null;
  return {
    id: item.itemId,
    name: item.name,
    sku: item.sku,
    price: price.customerPays,
    availability: {
      status: availability.status,
      sellable: availability.sellable,
      listable: availability.listable,
    },
    image,
    gallery,
    ...optionalIds(item),
    ...(feedChannels ? { feedChannels } : {}),
  };
}

// Each image is a Media Library read of its own, which no batch read covers, so one call to the
// shop list stops taking products once their images would pass this many reads. The rest come
// on the next page; storage reads stay a fixed handful per page.
const IMAGE_READS_PER_PAGE = 16;
const PAGE_CURSOR = /^(\d{1,2})\.(.*)$/s;

/** Reads a page's prices, stock and photos in a few batched calls instead of several per product. */
async function rememberCatalogReads(ctx: PluginContext, rows: Array<{ id: string; data: unknown }>) {
  const reads = rememberReads(ctx.storage as Record<string, unknown>);
  reads.seed("catalog_items", rows);
  const items = rows.map((row) => row.data as CatalogStorageRecord)
    .filter((item): item is CatalogItemRecord => item.recordKind === "catalog-item" && !item.archivedAt);
  const members = items.flatMap((item) => item.variantProduct?.members.map((member) => member.catalogItemId) ?? []);
  const ids = [...items.map((item) => item.itemId), ...members];
  await Promise.all([
    reads.prefetch("catalog_items", members),
    reads.prefetch("catalog_prices", ids),
    reads.prefetch("catalog_manual_availability", ids),
    reads.prefetch("catalog_backorder_policies", ids),
    reads.prefetch("catalog_media", items.map((item) => item.itemId)),
    reads.prefetch(PRODUCT_FEED_ELIGIBILITY_SANDBOX_COLLECTION, items.map((item) => item.itemId)),
  ]);
  const c = reads.storage as typeof ctx.storage;
  return {
    c,
    storage: bindGuestCheckoutRuntime(c, SANDBOX_GUEST_CHECKOUT_STORAGE, { runtimeSiteUrl: ctx.site.url }).catalog,
    media: c.catalog_media as CatalogMediaStorage,
    images: createProductImageProjector(ctx.media),
    placeholder: (await loadStorefrontPlaceholderImage(c.storefront_placeholder_image as StorefrontPlaceholderImageStorage)).image,
    eligibility: c[PRODUCT_FEED_ELIGIBILITY_SANDBOX_COLLECTION] as ProductFeedEligibilityStorage | undefined,
  };
}

/** Runtime-owned context only. Structural storage access does not attest installation. */
export async function readPublicCatalog(ctx: PluginContext, cursor?: string): Promise<PublicCatalogResponse> {
  if (cursor !== undefined && (!cursor || cursor.length > 1024)) unavailable();
  // A page that stopped early resumes at row `skip` of the same storage page.
  const resume = cursor === undefined ? null : PAGE_CURSOR.exec(cursor);
  if (cursor !== undefined && !resume) unavailable();
  const skip = resume ? Number(resume[1]) : 0;
  const storageCursor = resume?.[2] || undefined;
  const page = await ctx.storage.catalog_items!.query({ limit: 50, cursor: storageCursor });
  if (page.items.length > 50 || skip > page.items.length ||
      (page.hasMore && (!page.cursor || page.cursor === storageCursor || page.cursor.length > 1000))) {
    unavailable();
  }
  const { storage, media, images, placeholder, eligibility } = await rememberCatalogReads(ctx, page.items);
  const imageIds = new Set(placeholder ? [placeholder.mediaId] : []);
  const products: PublicCatalogProduct[] = [];
  for (let index = skip; index < page.items.length; index += 1) {
    const row = page.items[index]!;
    const item = row.data as unknown as CatalogStorageRecord;
    if (item.recordKind !== "catalog-item" || item.variantProductId) continue;
    if (row.id !== item.itemId) unavailable();
    if (!item.archivedAt) {
      const stored = await loadCatalogItemMedia(media, item.itemId);
      const added = [stored.image, ...stored.gallery].flatMap((entry) => entry && !imageIds.has(entry.mediaId) ? [entry.mediaId] : []);
      if (index > skip && imageIds.size + added.length > IMAGE_READS_PER_PAGE) {
        return { products, cursor: `${index}.${storageCursor ?? ""}` };
      }
      for (const id of added) imageIds.add(id);
    }
    const product = await projectPublicCatalogProduct(media, storage, item, images, placeholder, eligibility);
    if (product) products.push(product);
  }
  return { products, ...(page.hasMore ? { cursor: `0.${page.cursor}` } : {}) };
}

/**
 * Resolve one authoritative Commerce product by its permanent itemId.
 * Publication, page selection, and CMS state belong to the host page resolver.
 */
export async function readPublicCatalogItem(
  ctx: PluginContext,
  itemId: string,
): Promise<PublicCatalogProduct | null> {
  assertItemId(itemId);
  const row = await ctx.storage.catalog_items!.get(itemId);
  if (!row) return null;
  let item = row as unknown as CatalogStorageRecord;
  if (item.recordKind !== "catalog-item" || item.itemId !== itemId) unavailable();
  let parent: unknown = null;
  if (item.variantProductId) {
    parent = await ctx.storage.catalog_items!.get(item.variantProductId);
    if (!parent) return null;
  }
  const rows = [{ id: itemId, data: row }, ...(parent ? [{ id: item.variantProductId!, data: parent }] : [])];
  const { storage, media, images, placeholder, eligibility } = await rememberCatalogReads(ctx, rows);
  if (item.variantProductId) {
    if (!await resolveCatalogVariantMember(storage.catalog, itemId)) return null;
    item = parent as CatalogStorageRecord;
  }
  return projectPublicCatalogProduct(media, storage, item, images, placeholder, eligibility);
}
