export const INVENTORY_PROVIDER_FEATURE_ID = "dinkus.inventory-provider";

export interface InventoryProviderBindingInput {
  providerRef: string;
  poolId: string;
  defaultFulfillmentLocationId: string;
}

export interface InventoryProviderBinding {
  providerRef: string;
  poolId: string;
  defaultFulfillmentLocationId: string;
}

export interface UnmanagedStockManagement {
  mode: "unmanaged";
}

export type ManagedStockStatus = "setup-required" | "needs-review" | "active";

export interface ManagedStockManagement {
  mode: "managed";
  status: ManagedStockStatus;
}

export type StockManagement = UnmanagedStockManagement | ManagedStockManagement;
