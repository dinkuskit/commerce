import type { CatalogWriter } from "../catalog/kernel/index.js";
import type { PublicCatalogProduct } from "../catalog/index.js";

export const PRODUCT_FEED_CHANNELS = ["google-merchant", "meta-catalog"] as const;
export type ProductFeedChannel = (typeof PRODUCT_FEED_CHANNELS)[number];

export interface ProductFeedEligibilityRecord {
  recordKind: "product-feed-eligibility";
  recordId: string;
  catalogItemId: string;
  channels: readonly ProductFeedChannel[];
}

export interface ProductFeedEligibilityStorage {
  get(id: string): Promise<ProductFeedEligibilityRecord | null>;
  put(id: string, value: ProductFeedEligibilityRecord): Promise<unknown>;
}

export type ProductFeedEligibilityCatalog = CatalogWriter;

export interface SetProductFeedEligibilityInput {
  catalogItemId: string;
  channels: readonly ProductFeedChannel[];
}

export interface ProductAiProjection {
  readonly summary?: string;
  readonly highlights?: readonly string[];
  readonly specs?: Readonly<Record<string, string>>;
  readonly shippingSummary?: string;
  readonly returnPolicySummary?: string;
}

export interface ProductFeedContent {
  /** The host's published, canonical product page URL. */
  canonicalUrl: string;
  title: string;
  description?: string;
  imageUrls?: readonly string[];
  aiProjection?: ProductAiProjection;
}

export interface ProductFeedFacts {
  product: PublicCatalogProduct & { readonly fulfillment?: "physical" | "digital" };
  content: ProductFeedContent;
  eligibility: readonly ProductFeedChannel[];
  shipping?: string;
}

export interface StorefrontPolicySummary {
  readonly slug: string;
  readonly title: string;
  readonly url: string;
  readonly body?: string;
}

export interface StorefrontShippingQuoteInput {
  readonly mode: "free" | "flat";
  readonly amount?: { readonly currency: "USD"; readonly minor: string };
  readonly freeOver?: { readonly currency: "USD"; readonly minor: string };
}

export interface StorefrontAgentFeedOptions {
  readonly storeName: string;
  readonly siteOrigin: string;
  readonly description?: string;
  readonly pluginId?: string;
  readonly checkoutBreakdownSelector?: string;
  readonly products: readonly ProductFeedFacts[];
  readonly policies?: readonly StorefrontPolicySummary[];
  readonly shipping?: StorefrontShippingQuoteInput | null;
}

export interface AgentCatalogProductEntry {
  readonly id: string;
  readonly sku: string;
  readonly title: string;
  readonly canonicalUrl: string;
  readonly description?: string;
  readonly imageUrls: readonly string[];
  readonly price?: {
    readonly currency: "USD";
    readonly minor: string;
    readonly formatted: string;
  };
  readonly availability: {
    readonly status: PublicCatalogProduct["availability"]["status"];
    readonly sellable: boolean;
  };
  readonly fulfillment?: "physical" | "digital";
  readonly variants?: {
    readonly productId: string;
    readonly options: NonNullable<PublicCatalogProduct["variants"]>["options"];
    readonly members: readonly {
      readonly catalogItemId: string;
      readonly selections: NonNullable<PublicCatalogProduct["variants"]>["members"][number]["selections"];
      readonly price: {
        readonly currency: "USD";
        readonly minor: string;
        readonly formatted: string;
      };
      readonly availability: {
        readonly status: PublicCatalogProduct["availability"]["status"];
        readonly sellable: boolean;
      };
      readonly fulfillment: "physical" | "digital";
    }[];
  };
  readonly brand?: string;
  readonly gtin?: string;
  readonly mpn?: string;
  readonly aiProjection?: ProductAiProjection;
}

export interface AgentCatalogFeed {
  readonly schema: "dinkuskit.commerce.agent-catalog-feed/v1";
  readonly storeName: string;
  readonly siteOrigin: string;
  readonly description?: string;
  readonly virtualCardSizing: {
    readonly currency: "USD";
    readonly taxMinor: "0";
    readonly taxPolicy: "uncollected-zero";
    readonly shipping: StorefrontShippingQuoteInput | null;
    readonly formula: "subtotalMinor - couponDiscountMinor + shippingMinor + taxMinor(0) = totalMinor";
  };
  readonly products: readonly AgentCatalogProductEntry[];
  readonly policies: readonly StorefrontPolicySummary[];
}

export interface ProductFeedBuildOptions {
  readonly pageSize?: number;
  readonly cursor?: number;
}

export interface ProductFeedPage {
  readonly rows: readonly ProductFeedFacts[];
  readonly nextCursor?: number;
}
