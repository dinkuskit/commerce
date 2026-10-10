import { definePlugin, type PluginDescriptor, type PluginRoute, type ResolvedPlugin } from "emdash";

import {
  CATALOG_BACKORDER_POLICIES_COLLECTION,
  CATALOG_MANUAL_AVAILABILITY_COLLECTION,
  CATALOG_MEDIA_COLLECTION,
  CATALOG_PRICES_COLLECTION,
  CATALOG_UNIQUE_INDEXES,
  CLEAR_CATALOG_ITEM_REGULAR_PRICE_ROUTE,
  CLEAR_CATALOG_ITEM_SALE_PRICE_ROUTE,
  COMMERCE_PLUGIN_ID,
  CREATE_CATALOG_ITEM_ROUTE,
  LIST_CATALOG_PRODUCTS_ROUTE,
  SAVE_CATALOG_ITEM_MEDIA_ROUTE,
  SAVE_CATALOG_PRODUCT_PRICES_ROUTE,
  SET_CATALOG_ITEM_SKU_ROUTE,
  SET_CATALOG_ITEM_IDENTIFIERS_ROUTE,
  ADD_CATALOG_VARIANT_OPTION_ROUTE,
  BULK_SAVE_CATALOG_PRODUCT_PRICES_ROUTE,
  UPDATE_CATALOG_VARIANT_LABELS_ROUTE,
  SET_CATALOG_ITEM_BACKORDERS_ROUTE,
  SET_CATALOG_ITEM_MANUAL_AVAILABILITY_ROUTE,
  SET_CATALOG_ITEM_REGULAR_PRICE_ROUTE,
  SET_CATALOG_ITEM_SALE_PRICE_ROUTE,
  clearCatalogItemRegularPriceRoute,
  clearCatalogItemSalePriceRoute,
  createCatalogItemRouteWithLocalStock,
  createListCatalogProductsRouteWithLocalStock,
  createSaveCatalogProductPricesRouteWithLocalStock,
  saveCatalogItemMediaRoute,
  setCatalogItemSkuRoute,
  setCatalogItemIdentifiersRoute,
  setCatalogItemBackordersRoute,
  setCatalogItemManualAvailabilityRoute,
  setCatalogItemRegularPriceRoute,
  setCatalogItemSalePriceRoute,
  addCatalogVariantOptionRoute,
  updateCatalogVariantLabelsRoute,
  bulkSaveCatalogProductPricesRoute,
} from "./features/catalog/index.js";
import {
  PUBLIC_CATALOG_ROUTE,
  PUBLIC_CATALOG_ITEM_ROUTE,
  readPublicCatalog,
  readPublicCatalogItem,
} from "./features/catalog/storefront/index.js";
import {
  SET_STORE_RETURN_POLICY_ROUTE,
  SET_STORE_SHIPPING_POLICY_ROUTE,
  STORE_RETURN_POLICY_COLLECTION,
  STORE_SHIPPING_POLICY_COLLECTION,
  setStoreReturnPolicyRoute,
  setStoreShippingPolicyRoute,
} from "./features/store-policies/index.js";
import {
  MANAGED_SKU_REGISTRATION_CLAIMS_COLLECTION,
  MANAGED_SKU_REGISTRATION_CLAIM_UNIQUE_INDEXES,
} from "./features/inventory-provider/index.js";
import {
  CONFIGURE_INVENTORY_ROUTE,
  STORE_INVENTORY_CONFIGURATIONS_COLLECTION,
  STORE_INVENTORY_CONFIGURATION_UNIQUE_INDEXES,
  createConfigureInventoryRoute,
  type ConfigureInventoryExecution,
} from "./features/inventory-setup/index.js";
import {
  OUT_OF_STOCK_LISTING_ROUTE,
  PLACEHOLDER_IMAGE_ROUTE,
  SET_STOREFRONT_AVAILABILITY_POLICY_ROUTE,
  STOREFRONT_AVAILABILITY_SETTINGS_COLLECTION,
  STOREFRONT_OUT_OF_STOCK_LISTING_COLLECTION,
  STOREFRONT_PLACEHOLDER_IMAGE_COLLECTION,
  outOfStockListingRoute,
  placeholderImageRoute,
  setStorefrontAvailabilityPolicyRoute,
} from "./features/storefront-availability/index.js";
import {
  CHECKOUT_COLLECTION,
  CHECKOUT_GUEST_CAPABILITY_COLLECTION,
  CHECKOUT_PAYMENT_ASSOCIATIONS_COLLECTION,
  GUEST_CHECKOUT_PREPARE_ROUTE,
  GUEST_CHECKOUT_START_ROUTE,
  GUEST_CHECKOUT_STATUS_ROUTE,
  createGuestCheckoutPrepareRoute,
  createGuestCheckoutStartRoute,
  createGuestCheckoutStatusRoute,
  type GuestCheckoutHostOptions,
} from "./features/checkout/index.js";
import { COUPONS_COLLECTION } from "./features/coupons/index.js";
import {
  PRODUCT_FEED_ELIGIBILITY_COLLECTION,
} from "./features/catalog/index.js";
import {
  SET_PRODUCT_FEED_ELIGIBILITY_ROUTE,
  loadProductFeedEligibility,
  setProductFeedEligibilityRoute,
  type ProductFeedEligibilityStorage,
} from "./features/feeds/index.js";
import type { CatalogProductListItem } from "./features/catalog/index.js";
import { ORDER_NUMBERS_COLLECTION, ORDERS_COLLECTION, createPaidOrderReceiver, type OrderNumbers, type OrdersCollection } from "./features/orders/index.js";

export * from "./features/inventory-provider/index.js";

export * from "./features/catalog/index.js";

export * from "./features/feeds/index.js";

export * from "./features/inventory-setup/index.js";

export * from "./features/storefront-availability/index.js";

import { MERCHANT_STORE_SETTINGS_ROUTE, createMerchantStoreSettingsRoute } from "./features/store-settings/index.js";
export * from "./features/store-settings/index.js";

export * from "./features/store-policies/index.js";

export * from "./features/structured-data/index.js";

const COMMERCE_PLUGIN_VERSION = "0.0.0";

const COMMERCE_ADMIN_ENTRY = "@dinkuskit/commerce/admin";
const COMMERCE_PRODUCTS_PAGE = {
  path: "/products",
  label: "Products",
  icon: "storefront",
} as const;
const COMMERCE_STORE_PAGE = {
  path: "/store",
  label: "Store",
  icon: "storefront",
} as const;

export interface CommerceLocalDevelopmentOptions {
  /**
   * Host-owned local-development opt-in for synthetic Manage stock testing.
   * Default false. Not a merchant setting, URL query, or browser override.
   * Admission also requires a trusted loopback request URL and every present
   * trusted site URL to be loopback. A local constructor URL cannot mask a
   * known public or malformed runtime site URL. Missing, blank, or malformed
   * site URL fails closed.
   */
  enableLocalStockManagement?: boolean;
  /**
   * Host-owned configured public site origin. Pass the same loopback URL the
   * host set as EmDash `siteUrl` / `EMDASH_SITE_URL`. Plugin `ctx.site.url` may
   * be empty until the host runtime supplies it; a blank runtime may use this
   * constructor URL. When runtime site URL is present, both sources must be
   * loopback. Do not read this from the browser or request body.
   */
  siteUrl?: string;
}

export function dinkusCommerce(
  options: CommerceLocalDevelopmentOptions = {},
): PluginDescriptor<CommerceLocalDevelopmentOptions> {
  return {
    id: COMMERCE_PLUGIN_ID,
    version: COMMERCE_PLUGIN_VERSION,
    format: "native",
    entrypoint: "@dinkuskit/commerce",
    options: {
      enableLocalStockManagement: options.enableLocalStockManagement === true,
      ...(typeof options.siteUrl === "string" && options.siteUrl.trim() !== ""
        ? { siteUrl: options.siteUrl.trim() }
        : {}),
    },
    adminEntry: COMMERCE_ADMIN_ENTRY,
    adminPages: [COMMERCE_PRODUCTS_PAGE, COMMERCE_STORE_PAGE],
  };
}

export interface CommercePluginOptions extends CommerceLocalDevelopmentOptions {
  inventorySetup?: ConfigureInventoryExecution;
  checkout?: GuestCheckoutHostOptions;
}

// Checkout hands each paid order to Orders, which keeps its own copy.
const paidOrders = (storage: Record<string, unknown>) =>
  createPaidOrderReceiver(storage[ORDERS_COLLECTION] as OrdersCollection, storage[ORDER_NUMBERS_COLLECTION] as OrderNumbers);

/** Products list for the native admin, with each product's feed choices from Feeds. */
function withFeedChannels(route: PluginRoute): PluginRoute {
  return {
    ...route,
    handler: async (ctx) => {
      const listed = await route.handler(ctx) as { products: CatalogProductListItem[] };
      const eligibility = ctx.storage[PRODUCT_FEED_ELIGIBILITY_COLLECTION] as ProductFeedEligibilityStorage | undefined;
      if (!eligibility) return listed;
      const products = [];
      for (const product of listed.products) {
        products.push({ ...product, feedChannels: await loadProductFeedEligibility(eligibility, product.catalogItemId) });
      }
      return { ...listed, products };
    },
  };
}

function nativePublicContext(ctx: Parameters<PluginRoute["handler"]>[0]) {
  return {
    ...ctx,
    storage: {
      ...ctx.storage,
      catalog_items: ctx.storage.catalogItems ?? ctx.storage.catalog_items,
      catalog_prices: ctx.storage.catalogPrices ?? ctx.storage.catalog_prices,
      catalog_manual_availability:
        ctx.storage.catalogManualAvailability ?? ctx.storage.catalog_manual_availability,
      catalog_backorder_policies:
        ctx.storage.catalogBackorderPolicies ?? ctx.storage.catalog_backorder_policies,
      store_inventory_configurations:
        ctx.storage.storeInventoryConfigurations ?? ctx.storage.store_inventory_configurations,
      storefront_availability_settings:
        ctx.storage.storefrontAvailabilitySettings ?? ctx.storage.storefront_availability_settings,
      storefront_out_of_stock_listing:
        ctx.storage.storefrontOutOfStockListing ?? ctx.storage.storefront_out_of_stock_listing,
      catalog_media: ctx.storage.catalogMedia ?? ctx.storage.catalog_media,
      storefront_placeholder_image:
        ctx.storage.storefrontPlaceholderImage ?? ctx.storage.storefront_placeholder_image,
    },
  };
}

const publicCatalogRoute = {
  public: true,
  methods: ["GET"],
  request: { body: "none" },
  cacheControl: "no-store",
  handler: async (ctx: Parameters<PluginRoute["handler"]>[0]) => {
    const query = new URL(ctx.request.url).searchParams;
    if ([...query.keys()].some(key => key !== "cursor") || query.getAll("cursor").length > 1) {
      throw new Error("Invalid catalog query");
    }
    return readPublicCatalog(nativePublicContext(ctx), query.get("cursor") ?? undefined);
  },
} satisfies PluginRoute;

const publicCatalogItemRoute = {
  public: true,
  methods: ["GET"],
  request: { body: "none" },
  cacheControl: "no-store",
  handler: async (ctx: Parameters<PluginRoute["handler"]>[0]) => {
    const query = new URL(ctx.request.url).searchParams;
    if ([...query.keys()].some(key => key !== "itemId") || query.getAll("itemId").length !== 1) {
      throw new Error("Invalid catalog item query");
    }
    return readPublicCatalogItem(nativePublicContext(ctx), query.get("itemId")!);
  },
} satisfies PluginRoute;

export function createPlugin(options: CommercePluginOptions = {}): ResolvedPlugin {
  const localStock = {
    enableLocalStockManagement: options.enableLocalStockManagement === true,
    ...(typeof options.siteUrl === "string" && options.siteUrl.trim() !== ""
      ? { siteUrl: options.siteUrl.trim() }
      : {}),
  };
  const topLevelSiteUrl = options.siteUrl;
  const checkoutSiteUrl = options.checkout?.siteUrl;
  const checkoutHost: GuestCheckoutHostOptions = Object.freeze({
    ...options.checkout,
    topLevelSiteUrl,
    checkoutSiteUrl,
    siteUrl: checkoutSiteUrl ?? topLevelSiteUrl,
  });
  return definePlugin({
    id: COMMERCE_PLUGIN_ID,
    version: COMMERCE_PLUGIN_VERSION,
    // Product media reads alt text and dimensions live from the Media Library.
    capabilities: ["media:read", "network:request"],
    allowedHosts: ["payments.dinkuskit.com"],
    storage: {
      catalogItems: {
        indexes: [],
        uniqueIndexes: [...CATALOG_UNIQUE_INDEXES],
      },
      [CATALOG_BACKORDER_POLICIES_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [],
      },
      [CATALOG_MANUAL_AVAILABILITY_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [],
      },
      [CATALOG_PRICES_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [],
      },
      [PRODUCT_FEED_ELIGIBILITY_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [],
      },
      [CATALOG_MEDIA_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [],
      },
      [MANAGED_SKU_REGISTRATION_CLAIMS_COLLECTION]: {
        indexes: ["catalogItemId"],
        uniqueIndexes: [...MANAGED_SKU_REGISTRATION_CLAIM_UNIQUE_INDEXES],
      },
      [STORE_INVENTORY_CONFIGURATIONS_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [...STORE_INVENTORY_CONFIGURATION_UNIQUE_INDEXES],
      },
      [STOREFRONT_AVAILABILITY_SETTINGS_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [],
      },
      [STOREFRONT_OUT_OF_STOCK_LISTING_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [],
      },
      [STOREFRONT_PLACEHOLDER_IMAGE_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [],
      },
      [CHECKOUT_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [],
      },
      [CHECKOUT_GUEST_CAPABILITY_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [],
      },
      [ORDERS_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [],
      },
      [ORDER_NUMBERS_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [],
      },
      [CHECKOUT_PAYMENT_ASSOCIATIONS_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [],
      },
      [COUPONS_COLLECTION]: {
        indexes: ["normalizedCode"],
        uniqueIndexes: ["normalizedCode"],
      },
      [STORE_SHIPPING_POLICY_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [],
      },
      [STORE_RETURN_POLICY_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [],
      },
    },
    admin: {
      entry: COMMERCE_ADMIN_ENTRY,
      pages: [COMMERCE_PRODUCTS_PAGE, COMMERCE_STORE_PAGE],
    },
    routes: {
      [PUBLIC_CATALOG_ROUTE]: publicCatalogRoute,
      [PUBLIC_CATALOG_ITEM_ROUTE]: publicCatalogItemRoute,
      [MERCHANT_STORE_SETTINGS_ROUTE]: createMerchantStoreSettingsRoute(),
      [CREATE_CATALOG_ITEM_ROUTE]: createCatalogItemRouteWithLocalStock(localStock),
      [SET_CATALOG_ITEM_BACKORDERS_ROUTE]: setCatalogItemBackordersRoute,
      [SET_CATALOG_ITEM_MANUAL_AVAILABILITY_ROUTE]:
        setCatalogItemManualAvailabilityRoute,
      [SET_CATALOG_ITEM_REGULAR_PRICE_ROUTE]: setCatalogItemRegularPriceRoute,
      [SET_CATALOG_ITEM_SALE_PRICE_ROUTE]: setCatalogItemSalePriceRoute,
      [SET_PRODUCT_FEED_ELIGIBILITY_ROUTE]: setProductFeedEligibilityRoute,
      [CLEAR_CATALOG_ITEM_SALE_PRICE_ROUTE]: clearCatalogItemSalePriceRoute,
      [CLEAR_CATALOG_ITEM_REGULAR_PRICE_ROUTE]:
        clearCatalogItemRegularPriceRoute,
      [LIST_CATALOG_PRODUCTS_ROUTE]: withFeedChannels(createListCatalogProductsRouteWithLocalStock(localStock)),
      [SAVE_CATALOG_PRODUCT_PRICES_ROUTE]:
        createSaveCatalogProductPricesRouteWithLocalStock(localStock),
      [SAVE_CATALOG_ITEM_MEDIA_ROUTE]: saveCatalogItemMediaRoute,
      [SET_CATALOG_ITEM_SKU_ROUTE]: setCatalogItemSkuRoute,
      [SET_CATALOG_ITEM_IDENTIFIERS_ROUTE]: setCatalogItemIdentifiersRoute,
      [ADD_CATALOG_VARIANT_OPTION_ROUTE]: addCatalogVariantOptionRoute,
      [UPDATE_CATALOG_VARIANT_LABELS_ROUTE]: updateCatalogVariantLabelsRoute,
      [BULK_SAVE_CATALOG_PRODUCT_PRICES_ROUTE]: bulkSaveCatalogProductPricesRoute,
      [CONFIGURE_INVENTORY_ROUTE]: createConfigureInventoryRoute(
        options.inventorySetup,
      ),
      [SET_STOREFRONT_AVAILABILITY_POLICY_ROUTE]:
        setStorefrontAvailabilityPolicyRoute,
      [OUT_OF_STOCK_LISTING_ROUTE]: outOfStockListingRoute,
      [PLACEHOLDER_IMAGE_ROUTE]: placeholderImageRoute,
      [SET_STORE_SHIPPING_POLICY_ROUTE]: setStoreShippingPolicyRoute,
      [SET_STORE_RETURN_POLICY_ROUTE]: setStoreReturnPolicyRoute,
      [GUEST_CHECKOUT_PREPARE_ROUTE]: createGuestCheckoutPrepareRoute(checkoutHost),
      [GUEST_CHECKOUT_START_ROUTE]: createGuestCheckoutStartRoute(checkoutHost, paidOrders),
      [GUEST_CHECKOUT_STATUS_ROUTE]: createGuestCheckoutStatusRoute(checkoutHost, paidOrders),
    },
  });
}

export default createPlugin;

export * from "./features/checkout/index.js";

export * from "./features/orders/index.js";

export * from "./features/fixed-bundles/index.js";
