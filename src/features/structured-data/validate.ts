import type { ProductJsonLd } from "./types.js";

const SCHEMA_TYPES = new Set([
  "Product",
  "Offer",
  "Brand",
  "OfferShippingDetails",
  "MonetaryAmount",
  "DefinedRegion",
  "ShippingDeliveryTime",
  "QuantitativeValue",
  "MerchantReturnPolicy",
]);

function assertType(node: unknown, expected: string, path: string): asserts node is Record<string, unknown> {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new Error(`${path} must be an object`);
  }
  const value = node as Record<string, unknown>;
  if (value["@type"] !== expected) {
    throw new Error(`${path} @type must be ${expected}, got ${String(value["@type"])}`);
  }
  if (!SCHEMA_TYPES.has(expected)) {
    throw new Error(`${path} uses unknown schema.org type ${expected}`);
  }
}

/**
 * Offline schema.org-shape validation for Product/Offer JSON-LD.
 * No network fetch of the schema.org vocabulary.
 */
export function assertProductJsonLdShape(value: unknown): asserts value is ProductJsonLd {
  assertType(value, "Product", "Product");
  if (value["@context"] !== "https://schema.org") {
    throw new Error("Product @context must be https://schema.org");
  }
  for (const key of ["name", "sku", "url"] as const) {
    if (typeof value[key] !== "string" || !value[key]) {
      throw new Error(`Product.${key} must be a non-empty string`);
    }
  }
  if (value.gtin !== undefined && typeof value.gtin !== "string") {
    throw new Error("Product.gtin must be a string when present");
  }
  if (value.mpn !== undefined && typeof value.mpn !== "string") {
    throw new Error("Product.mpn must be a string when present");
  }
  if (value.brand !== undefined) {
    assertType(value.brand, "Brand", "Product.brand");
    if (typeof value.brand.name !== "string" || !value.brand.name) {
      throw new Error("Product.brand.name is required");
    }
  }
  if (value.offers !== undefined) {
    assertType(value.offers, "Offer", "Product.offers");
    const offer = value.offers;
    if (typeof offer.price !== "string" || !/^\d+\.\d{2}$/.test(offer.price)) {
      throw new Error("Offer.price must be an exact decimal string");
    }
    if (offer.priceCurrency !== "USD") {
      throw new Error("Offer.priceCurrency must be USD");
    }
    if (typeof offer.availability !== "string" || !offer.availability.startsWith("https://schema.org/")) {
      throw new Error("Offer.availability must be a schema.org URL");
    }
    if (offer.availability === "https://schema.org/InStock" && value) {
      // availability-unavailable must never reach InStock; callers assert mapping separately.
    }
    if (offer.shippingDetails !== undefined) {
      assertType(offer.shippingDetails, "OfferShippingDetails", "Offer.shippingDetails");
      const shipping = offer.shippingDetails;
      if (shipping.shippingRate !== undefined) {
        assertType(shipping.shippingRate, "MonetaryAmount", "shippingRate");
      }
      if (shipping.shippingDestination !== undefined) {
        const destinations = Array.isArray(shipping.shippingDestination)
          ? shipping.shippingDestination
          : [shipping.shippingDestination];
        for (const [index, destination] of destinations.entries()) {
          assertType(destination, "DefinedRegion", `shippingDestination[${index}]`);
        }
      }
      if (shipping.deliveryTime !== undefined) {
        assertType(shipping.deliveryTime, "ShippingDeliveryTime", "deliveryTime");
      }
    }
    if (offer.hasMerchantReturnPolicy !== undefined) {
      assertType(
        offer.hasMerchantReturnPolicy,
        "MerchantReturnPolicy",
        "Offer.hasMerchantReturnPolicy",
      );
    }
  }
}
