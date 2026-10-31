/**
 * Host-side structured-data input types.
 * Deliberately duplicated from public projections so this module never imports
 * storage or sandbox routes — the builder stays out of the Registry backend graph.
 */

export type StructuredAvailabilityStatus =
  | "in-stock"
  | "low-stock"
  | "out-of-stock"
  | "available-on-backorder"
  | "availability-unavailable";

export interface StructuredMoney {
  readonly currency: "USD";
  readonly minor: string;
}

export interface StructuredProductInput {
  /** Permanent Commerce itemId (lookup key). Not emitted as schema.org sku. */
  readonly id: string;
  readonly name: string;
  /** Editable merchant SKU attribute. */
  readonly sku: string;
  readonly price?: StructuredMoney;
  readonly availability: {
    readonly status: StructuredAvailabilityStatus;
    readonly sellable: boolean;
    readonly listable: boolean;
  };
  readonly gtin?: string;
  readonly mpn?: string;
  readonly brand?: string;
}

export interface StructuredPageFacts {
  /** Canonical product page URL supplied by the host. */
  readonly url: string;
  /** Optional display overrides; defaults to catalog name. */
  readonly name?: string;
  readonly description?: string;
  /** Absolute image URLs resolved by the host from media ids. */
  readonly images?: readonly string[];
}

export interface BuildProductJsonLdInput {
  readonly product: StructuredProductInput;
  readonly page: StructuredPageFacts;
}

/** Page facts for an editorial product preview with no Commerce identity. */
export interface BuildProductPreviewJsonLdInput extends StructuredPageFacts {
  readonly name: string;
}

export interface ProductPreviewJsonLd {
  readonly "@context": "https://schema.org";
  readonly "@type": "Product";
  readonly name: string;
  readonly url: string;
  readonly description?: string;
  readonly image?: string | readonly string[];
}

export type JsonLdNode = {
  readonly "@type": string;
  readonly [key: string]: unknown;
};

export interface ProductJsonLd {
  readonly "@context": "https://schema.org";
  readonly "@type": "Product";
  readonly name: string;
  readonly sku: string;
  readonly url: string;
  readonly description?: string;
  readonly image?: string | readonly string[];
  readonly gtin?: string;
  readonly mpn?: string;
  readonly brand?: JsonLdNode;
  readonly offers?: JsonLdNode;
}
