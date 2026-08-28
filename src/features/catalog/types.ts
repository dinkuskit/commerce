import type { StorageCollection } from "emdash";

export const CATALOG_FEATURE_ID = "dinkus.catalog";
export const CATALOG_COLLECTION = "catalogItems";
// EmDash mounts plugin IDs as one URL segment and uses them in storage-index
// provisioning. Keep the scoped npm package identity separate from this
// runtime slug so both the HTTP route and declared unique indexes materialize.
export const COMMERCE_PLUGIN_ID = "dinkus-commerce";

export const CATALOG_UNIQUE_INDEXES = ["commandId", "skuKey"] as const;

export interface CreateCatalogItemInput {
  commandId: string;
  name: string;
  sku: string;
}

export interface NormalizedCreateCatalogItemInput {
  commandId: string;
  kind: "simple-product";
  name: string;
  sku: string;
  skuKey: string;
}

export interface CatalogItemRecord extends NormalizedCreateCatalogItemInput {
  recordKind: "catalog-item";
  itemId: string;
  state: "draft";
  createdAt: string;
}

export interface CatalogIntegrityProbeRecord {
  recordKind: "integrity-probe";
  itemId: string;
  commandId: string;
  kind: "integrity-probe";
  name: string;
  sku: string;
  skuKey: string;
  state: "internal";
  createdAt: string;
}

export type CatalogStorageRecord = CatalogItemRecord | CatalogIntegrityProbeRecord;

export type CatalogStorage = Pick<
  StorageCollection<CatalogStorageRecord>,
  "delete" | "put" | "query"
>;

export interface CreateCatalogItemResult {
  created: boolean;
  item: CatalogItemRecord;
}
