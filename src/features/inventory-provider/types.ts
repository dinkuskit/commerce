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

export interface SetupRequiredManagedStockManagement {
  mode: "managed";
  status: "setup-required";
}

export interface InventorySkuIdentity {
  inventorySkuId: string;
  sku: string;
  displayName: string;
}

export interface NeedsReviewManagedStockManagement {
  mode: "managed";
  status: "needs-review";
  candidate: InventorySkuIdentity;
}

export interface ActiveManagedStockManagement {
  mode: "managed";
  status: "active";
  inventorySkuId: string;
}

export type ManagedStockManagement =
  | SetupRequiredManagedStockManagement
  | NeedsReviewManagedStockManagement
  | ActiveManagedStockManagement;

export type StockManagement = UnmanagedStockManagement | ManagedStockManagement;

export interface ManagedSkuRegistrationInput {
  sku: string;
  productTitle?: string | null;
}

export interface ManagedSkuRegistrationRequest {
  poolId: string;
  sku: string;
  displayNameIfNew: string;
}

export type ManagedSkuRegistrationResult =
  | {
      outcome: "registered";
      inventorySku: InventorySkuIdentity;
    }
  | {
      outcome: "existing";
      inventorySku: InventorySkuIdentity;
    };

export interface InventoryProviderPort {
  registerManagedSku(
    request: ManagedSkuRegistrationRequest,
  ): Promise<ManagedSkuRegistrationResult>;
}
