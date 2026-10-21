import type { BuildProductPreviewJsonLdInput, ProductPreviewJsonLd } from "./types.js";

/**
 * Host-only Product metadata for an editorial preview without a Commerce item.
 * Copies only page facts; never infers identity, sellability, or an Offer.
 */
export function buildProductPreviewJsonLd(
  input: BuildProductPreviewJsonLdInput,
): ProductPreviewJsonLd {
  if (typeof input?.url !== "string" || !input.url.trim()) {
    throw new Error("url (canonical URL) is required");
  }
  if (typeof input.name !== "string" || !input.name.trim()) {
    throw new Error("display name is required");
  }

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name.trim(),
    url: input.url,
    ...(input.description ? { description: input.description } : {}),
    ...(input.images?.length
      ? { image: input.images.length === 1 ? input.images[0] : [...input.images] }
      : {}),
  };
}
