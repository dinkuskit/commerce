import type { CatalogItemReadStorage } from "../catalog/index.js";

export const FIXED_BUNDLES_FEATURE_ID = "dinkus.fixed-bundles";

export interface FixedBundleComponent {
  catalogItemId: string;
  quantityPerBundle: number;
}

export interface FixedBundleDefinition {
  definitionId: string;
  components: readonly FixedBundleComponent[];
}

export interface FixedBundleComponentSnapshot {
  catalogItemId: string;
  sku: string;
  name: string;
  quantityPerBundle: number;
  totalQuantity: number;
}

export interface FixedBundleFulfillmentSnapshot {
  definitionId: string;
  purchasedBundleQuantity: number;
  components: FixedBundleComponentSnapshot[];
}

export type FixedBundleCatalogRead = CatalogItemReadStorage;
