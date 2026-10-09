import { mapAvailabilityToSchemaOrg } from "./availability.js";
import { formatMinorUnitsAsDecimal } from "./price.js";
import type {
  BuildProductJsonLdInput,
  JsonLdNode,
  ProductJsonLd,
  StructuredReturnPolicy,
  StructuredShippingPolicy,
} from "./types.js";

function schema(token: string): `https://schema.org/${string}` {
  return `https://schema.org/${token}`;
}

function shippingDetails(policy: StructuredShippingPolicy): JsonLdNode | undefined {
  const node: Record<string, unknown> = { "@type": "OfferShippingDetails" };
  const rateMinor =
    policy.mode === "free"
      ? { currency: "USD" as const, minor: policy.amount?.minor ?? "0" }
      : policy.amount;
  if (rateMinor) {
    node.shippingRate = {
      "@type": "MonetaryAmount",
      value: formatMinorUnitsAsDecimal(rateMinor),
      currency: rateMinor.currency,
    };
  }
  if (policy.shippingDestinationCountries?.length) {
    node.shippingDestination = policy.shippingDestinationCountries.map((country) => ({
      "@type": "DefinedRegion",
      addressCountry: country,
    }));
  }
  const handling = policy.handlingTimeDays;
  const transit = policy.transitTimeDays;
  if (handling || transit) {
    const deliveryTime: Record<string, unknown> = { "@type": "ShippingDeliveryTime" };
    if (handling) {
      deliveryTime.handlingTime = {
        "@type": "QuantitativeValue",
        minValue: handling.min,
        maxValue: handling.max,
        unitCode: "DAY",
      };
    }
    if (transit) {
      deliveryTime.transitTime = {
        "@type": "QuantitativeValue",
        minValue: transit.min,
        maxValue: transit.max,
        unitCode: "DAY",
      };
    }
    node.deliveryTime = deliveryTime;
  }
  // Charge mode alone is enough to emit shippingDetails; never invent destinations or days.
  if (!node.shippingRate && !node.shippingDestination && !node.deliveryTime) {
    return undefined;
  }
  return node as JsonLdNode;
}

function returnPolicy(policy: StructuredReturnPolicy): JsonLdNode | undefined {
  const node: Record<string, unknown> = { "@type": "MerchantReturnPolicy" };
  if (policy.applicableCountry?.length) {
    node.applicableCountry = [...policy.applicableCountry];
  }
  if (policy.returnPolicyCategory) {
    node.returnPolicyCategory = schema(policy.returnPolicyCategory);
  }
  if (typeof policy.merchantReturnDays === "number") {
    node.merchantReturnDays = policy.merchantReturnDays;
  }
  if (policy.returnMethod) {
    node.returnMethod = schema(policy.returnMethod);
  }
  if (policy.returnFees) {
    node.returnFees = schema(policy.returnFees);
  }
  if (policy.policyPageUrl) {
    node.url = policy.policyPageUrl;
  }
  if (Object.keys(node).length === 1) return undefined;
  return node as JsonLdNode;
}

/**
 * Pure Product/Offer JSON-LD builder.
 * No network, no storage. Host supplies canonical URL and page facts; Commerce
 * supplies the public product projection and versioned policy records.
 *
 * Locked GrillTrack jsonld-*-059 (PR #73 comments 6067853218 + 6067895247).
 */
export function buildProductJsonLd(input: BuildProductJsonLdInput): ProductJsonLd {
  const { product, page, policies } = input;
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
    const shipping = policies?.shipping ? shippingDetails(policies.shipping) : undefined;
    if (shipping) offer.shippingDetails = shipping;
    const returns = policies?.returns ? returnPolicy(policies.returns) : undefined;
    if (returns) offer.hasMerchantReturnPolicy = returns;
    result.offers = offer;
  }

  return result as unknown as ProductJsonLd;
}
