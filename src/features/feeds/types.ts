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

export interface ProductFeedContent {
  /** The host's published, canonical product page URL. */
  canonicalUrl: string;
  title: string;
  description?: string;
  imageUrls?: readonly string[];
}

export interface ProductFeedFacts {
  product: PublicCatalogProduct;
  content: ProductFeedContent;
  eligibility: readonly ProductFeedChannel[];
  shipping?: string;
}

export interface ProductFeedBuildOptions {
  /** Defaults to 100; clamped to 1–500 before slicing. NaN throws RangeError. */
  readonly pageSize?: number;
  /** Nonnegative safe integer offset, defaulting to zero; invalid values throw RangeError. */
  readonly cursor?: number;
}

export interface ProductFeedPage {
  readonly rows: readonly ProductFeedFacts[];
  readonly nextCursor?: number;
}
