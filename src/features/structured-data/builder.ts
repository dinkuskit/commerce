import { mapAvailabilityToSchemaOrg } from "./availability.js";
import { formatMinorUnitsAsDecimal } from "./price.js";
import type { BuildProductJsonLdInput, ProductJsonLd } from "./types.js";

/**
 * Pure Product/Offer JSON-LD builder.
 * No network, no storage. Host supplies canonical URL and page facts; Commerce
 * supplies the public product projection. The Offer carries no shipping or
 * return terms: a store's policies are its EmDash pages, and structured terms
 * are deferred (GrillTrack policy-pages-are-content-20261031).
 *
 * Locked GrillTrack jsonld-builder-export-059 (PR #73 comments 6067853218 + 6067895247).
 */
export function buildProductJsonLd(input: BuildProductJsonLdInput): ProductJsonLd {
  const { product, page } = input;
  if (!page?.url || typeof page.url !== "string") {
    throw new Error("page.url (canonical URL) is required");
  }
  const name = (page.name ?? product.name).trim();
  if (!name) throw new Error("product name is required");
  if (!product.sku) throw new Error("product sku is required");

  const result: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    sku: product.sku,
    url: page.url,
  };
  if (page.description) result.description = page.description;
  if (page.images?.length === 1) result.image = page.images[0];
  else if (page.images && page.images.length > 1) result.image = [...page.images];
  if (product.gtin) result.gtin = product.gtin;
  if (product.mpn) result.mpn = product.mpn;
  if (product.brand) {
    result.brand = { "@type": "Brand", name: product.brand };
  }

  if (product.price) {
    const offer: Record<string, unknown> = {
      "@type": "Offer",
      url: page.url,
      priceCurrency: product.price.currency,
      price: formatMinorUnitsAsDecimal(product.price),
      availability: mapAvailabilityToSchemaOrg(product.availability.status),
    };
    result.offers = offer;
  }

  return result as unknown as ProductJsonLd;
}
