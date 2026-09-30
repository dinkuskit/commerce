import type { StorageCollection } from "emdash";

import type {
  CatalogBackorderPolicyStorage,
  CatalogManualAvailabilityStorage,
  CatalogPriceStorage,
  CatalogStorageRecord,
} from "../catalog/kernel/index.js";
import type { StoreInventoryConfigurationStorage } from "../inventory-setup/kernel/index.js";
import type {
  StorefrontAvailabilitySettingsStorage,
  StorefrontOutOfStockListingStorage,
} from "../storefront-availability/kernel/index.js";
import type {
  CheckoutRecord,
  GuestCapabilityRecord,
  GuestCheckoutHostOptions,
  GuestCheckoutRuntime,
} from "./types.js";

export interface GuestCheckoutStorageNames {
  carts: string;
  capabilities: string;
  catalogItems: string;
  prices: string;
  backorderPolicies: string;
  manualAvailability: string;
  configurations: string;
  settings: string;
  listing?: string;
}

export const NATIVE_GUEST_CHECKOUT_STORAGE = {
  carts: "checkoutCarts",
  capabilities: "checkoutGuestCapabilities",
  catalogItems: "catalogItems",
  prices: "catalogPrices",
  backorderPolicies: "catalogBackorderPolicies",
  manualAvailability: "catalogManualAvailability",
  configurations: "storeInventoryConfigurations",
  settings: "storefrontAvailabilitySettings",
  listing: "storefrontOutOfStockListing",
} as const satisfies GuestCheckoutStorageNames;

export const SANDBOX_GUEST_CHECKOUT_STORAGE = {
  carts: "checkout_carts",
  capabilities: "checkout_guest_capabilities",
  catalogItems: "catalog_items",
  prices: "catalog_prices",
  backorderPolicies: "catalog_backorder_policies",
  manualAvailability: "catalog_manual_availability",
  configurations: "store_inventory_configurations",
  settings: "storefront_availability_settings",
  listing: "storefront_out_of_stock_listing",
} as const satisfies GuestCheckoutStorageNames;

export function bindGuestCheckoutRuntime(
  storage: Record<string, unknown>,
  names: GuestCheckoutStorageNames,
  options: { siteUrl?: string; host?: GuestCheckoutHostOptions } = {},
): GuestCheckoutRuntime {
  return {
    carts: storage[names.carts] as Pick<StorageCollection<CheckoutRecord>, "compareAndSet" | "getVersioned">,
    capabilities: storage[names.capabilities] as Pick<
      StorageCollection<GuestCapabilityRecord>,
      "compareAndSet" | "get" | "getVersioned"
    >,
    catalog: {
      catalog: storage[names.catalogItems] as Pick<StorageCollection<CatalogStorageRecord>, "get">,
      prices: storage[names.prices] as CatalogPriceStorage,
      backorderPolicies: storage[names.backorderPolicies] as CatalogBackorderPolicyStorage,
      configurations: storage[names.configurations] as StoreInventoryConfigurationStorage,
      settings: storage[names.settings] as StorefrontAvailabilitySettingsStorage,
      listing: names.listing
        ? storage[names.listing] as StorefrontOutOfStockListingStorage
        : undefined,
      manualAvailability: storage[names.manualAvailability] as CatalogManualAvailabilityStorage,
    },
    siteUrl: options.siteUrl,
    host: options.host ?? {},
  };
}
