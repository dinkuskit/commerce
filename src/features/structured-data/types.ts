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

export interface StructuredDayBounds {
  readonly min: number;
  readonly max: number;
}

export interface StructuredShippingPolicy {
  readonly revision: number;
  readonly configurationId: string;
  readonly mode: "free" | "flat";
  readonly amount?: StructuredMoney;
  readonly shippingDestinationCountries?: readonly string[];
  readonly handlingTimeDays?: StructuredDayBounds;
  readonly transitTimeDays?: StructuredDayBounds;
  readonly policyPageUrl?: string;
}

export interface StructuredReturnPolicy {
  readonly revision: number;
  readonly applicableCountry?: readonly string[];
  readonly returnPolicyCategory?:
    | "MerchantReturnFiniteReturnWindow"
    | "MerchantReturnNotPermitted"
    | "MerchantReturnUnlimitedWindow";
  readonly merchantReturnDays?: number;
  readonly returnMethod?: "ReturnByMail" | "ReturnInStore" | "ReturnAtKiosk";
  readonly returnFees?:
    | "FreeReturn"
    | "ReturnFeesCustomerResponsibility"
    | "ReturnShippingFees";
  readonly policyPageUrl?: string;
}

export interface StructuredPoliciesInput {
  readonly shipping?: StructuredShippingPolicy | null;
  readonly returns?: StructuredReturnPolicy | null;
}

export interface BuildProductJsonLdInput {
  readonly product: StructuredProductInput;
  readonly page: StructuredPageFacts;
  readonly policies?: StructuredPoliciesInput;
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
