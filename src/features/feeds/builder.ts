import {
  PRODUCT_FEED_CHANNELS,
  type ProductFeedBuildOptions,
  type ProductFeedFacts,
  type ProductFeedPage,
  type ProductFeedChannel,
} from "./types.js";
import { formatMinorUnitsAsDecimal } from "../structured-data/index.js";

const DEFAULT_PAGE_SIZE = 100;
// Channel caps on secondary images: Google takes 10 additional_image_link
// elements, Meta 20 comma-separated URLs in one additional_image_link column.
const GOOGLE_ADDITIONAL_IMAGES = 10;
const META_ADDITIONAL_IMAGES = 20;
const MAX_PAGE_SIZE = 500;

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  })[character]!);
}

function csv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function price(product: ProductFeedFacts): string {
  const money = product.product.price;
  return money ? `${formatMinorUnitsAsDecimal(money)} ${money.currency}` : "";
}

// Each channel's value for the same status JSON-LD maps (backorder → BackOrder).
const AVAILABILITY_VALUES: Record<ProductFeedChannel, { inStock: string; backorder: string; outOfStock: string }> = {
  "google-merchant": { inStock: "in stock", backorder: "backorder", outOfStock: "out of stock" },
  "meta-catalog": { inStock: "in stock", backorder: "available for order", outOfStock: "out of stock" },
};

function availability(product: ProductFeedFacts, channel: ProductFeedChannel): string {
  const values = AVAILABILITY_VALUES[channel];
  switch (product.product.availability.status) {
    case "in-stock":
      return values.inStock;
    case "available-on-backorder":
      return values.backorder;
    default:
      return values.outOfStock;
  }
}

function eligible(product: ProductFeedFacts, channel: ProductFeedChannel): boolean {
  return product.eligibility.includes(channel) &&
    product.product.availability.listable &&
    product.product.price !== undefined &&
    product.content.canonicalUrl.length > 0 &&
    product.content.title.length > 0;
}

export function pageProductFeedRows(
  products: readonly ProductFeedFacts[],
  options: ProductFeedBuildOptions = {},
): ProductFeedPage {
  const pageSize = Math.min(Math.max(options.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const cursor = options.cursor ?? 0;
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new RangeError("invalid feed cursor");
  const rows = products.slice(cursor, cursor + pageSize);
  return {
    rows,
    ...(cursor + rows.length < products.length ? { nextCursor: cursor + rows.length } : {}),
  };
}

export function buildGoogleMerchantFeed(products: readonly ProductFeedFacts[]): string {
  const rows = products.filter((product) => eligible(product, "google-merchant"));
  const items = rows.map((product) => {
    const image = product.content.imageUrls?.[0];
    return [
      "<item>",
      `<g:id>${escapeXml(product.product.id)}</g:id>`,
      `<g:title>${escapeXml(product.content.title)}</g:title>`,
      product.content.description ? `<g:description>${escapeXml(product.content.description)}</g:description>` : "",
      `<g:link>${escapeXml(product.content.canonicalUrl)}</g:link>`,
      image ? `<g:image_link>${escapeXml(image)}</g:image_link>` : "",
      ...(product.content.imageUrls ?? []).slice(1, 1 + GOOGLE_ADDITIONAL_IMAGES)
        .map((url) => `<g:additional_image_link>${escapeXml(url)}</g:additional_image_link>`),
      `<g:price>${escapeXml(price(product))}</g:price>`,
      `<g:availability>${availability(product, "google-merchant")}</g:availability>`,
      "<g:condition>new</g:condition>",
      product.product.gtin ? `<g:gtin>${escapeXml(product.product.gtin)}</g:gtin>` : "",
      product.product.mpn ? `<g:mpn>${escapeXml(product.product.mpn)}</g:mpn>` : "",
      product.product.brand ? `<g:brand>${escapeXml(product.product.brand)}</g:brand>` : "",
      // Google's no-identifier signal: neither a GTIN nor brand plus MPN is on file.
      product.product.gtin || (product.product.brand && product.product.mpn) ? "" : "<g:identifier_exists>no</g:identifier_exists>",
      product.shipping ? `<g:shipping>${escapeXml(product.shipping)}</g:shipping>` : "",
      "</item>",
    ].filter(Boolean).join("");
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>${items}</channel></rss>`;
}

export function buildMetaCatalogFeed(products: readonly ProductFeedFacts[]): string {
  const columns = ["id", "retailer_id", "title", "description", "availability", "condition", "price", "link", "image_link", "additional_image_link", "brand", "gtin", "mpn", "shipping"];
  const rows = products.filter((product) => eligible(product, "meta-catalog")).map((product) => [
    product.product.id,
    product.product.id,
    product.content.title,
    product.content.description ?? "",
    availability(product, "meta-catalog"),
    "new",
    price(product),
    product.content.canonicalUrl,
    product.content.imageUrls?.[0] ?? "",
    (product.content.imageUrls ?? []).slice(1, 1 + META_ADDITIONAL_IMAGES).join(","),
    product.product.brand ?? "",
    product.product.gtin ?? "",
    product.product.mpn ?? "",
    product.shipping ?? "",
  ].map(csv).join(","));
  return [columns.map(csv).join(","), ...rows].join("\n") + "\n";
}

export { PRODUCT_FEED_CHANNELS };
