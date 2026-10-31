import { definePlugin, PluginRouteError, type PluginDescriptor, type PluginRoute, type ResolvedPlugin } from "emdash";
import { CATALOG_API_ROUTE, catalogApi, commerceAdmin, productMediaPanel, productPanel } from "./admin/index.js";
import { CatalogError } from "./features/catalog/kernel/index.js";

import {
  CATALOG_BACKORDER_POLICIES_COLLECTION,
  CATALOG_MANUAL_AVAILABILITY_COLLECTION,
  CATALOG_MEDIA_COLLECTION,
  CATALOG_PRICES_COLLECTION,
  CATALOG_UNIQUE_INDEXES,
  COMMERCE_PLUGIN_ID,
  PRODUCT_PAGE_ON_SALE_ROUTE,
  PRODUCT_PAGES_COLLECTION,
  setProductPageOnSaleRoute,
} from "./features/catalog/index.js";
import {
  PUBLIC_CATALOG_ROUTE,
  PUBLIC_CATALOG_ITEM_ROUTE,
  readPublicCatalog,
  readPublicCatalogItem,
} from "./features/catalog/storefront/index.js";
import {
  STORE_RETURN_POLICY_COLLECTION,
  STORE_SHIPPING_POLICY_COLLECTION,
} from "./features/store-policies/index.js";
import {
  MANAGED_SKU_REGISTRATION_CLAIMS_COLLECTION,
  MANAGED_SKU_REGISTRATION_CLAIM_UNIQUE_INDEXES,
} from "./features/inventory-provider/index.js";
import {
  STORE_INVENTORY_CONFIGURATIONS_COLLECTION,
  STORE_INVENTORY_CONFIGURATION_UNIQUE_INDEXES,
} from "./features/inventory-setup/index.js";
import {
  STOREFRONT_AVAILABILITY_SETTINGS_COLLECTION,
  STOREFRONT_OUT_OF_STOCK_LISTING_COLLECTION,
  STOREFRONT_PLACEHOLDER_IMAGE_COLLECTION,
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
import { ORDER_NUMBERS_COLLECTION, ORDERS_COLLECTION, createPaidOrderReceiver, listOrdersForEmail, type OrderNumbers, type OrdersCollection } from "./features/orders/index.js";
import {
  NATIVE_CUSTOMERS_COLLECTION,
  NATIVE_CUSTOMER_LOGIN_CODES_COLLECTION,
  NATIVE_CUSTOMER_SESSIONS_COLLECTION,
  SHOPPER_ACCOUNT_ORDERS_ROUTE,
  SHOPPER_ACCOUNT_PROFILE_ROUTE,
  SHOPPER_SIGN_IN_START_ROUTE,
  SHOPPER_SIGN_IN_VERIFY_ROUTE,
  SHOPPER_SIGN_OUT_ROUTE,
  createShopperAccountOrdersRoute,
  createShopperAccountProfileRoute,
  createShopperSignInStartRoute,
  createShopperSignInVerifyRoute,
  createShopperSignOutRoute,
  type ShopperAccountHostOptions,
} from "./features/customers/index.js";

export * from "./features/inventory-provider/index.js";

export * from "./features/catalog/index.js";

export * from "./features/feeds/index.js";

export * from "./features/inventory-setup/index.js";

export * from "./features/storefront-availability/index.js";

import { MERCHANT_STORE_SETTINGS_ROUTE } from "./features/store-settings/index.js";
export * from "./features/store-settings/index.js";

export * from "./features/store-policies/index.js";

export * from "./features/structured-data/index.js";

const COMMERCE_PLUGIN_VERSION = "0.2.0";

// Every install, native or Registry, gets the same Block Kit pages and product page panel (commerce-admin-block-kit-only-20261024).
const COMMERCE_ADMIN_PAGES = [
  { path: "/orders", label: "Orders", icon: "storefront", group: "Dinkus Commerce" },
  { path: "/settings", label: "Commerce settings", icon: "settings", group: "Dinkus Commerce" },
];
const COMMERCE_EDITOR_PANELS = [{
  id: "product",
  title: "Dinkus Commerce",
  route: "product-panel",
  collections: ["products"],
  // It reads only the title, to name a new product; the page-to-product link lives in Commerce.
  draft: { read: { fields: ["title"] } },
}, {
  // The product's Commerce picture and gallery, in their own sidebar card (catalog-media-panel-20261027).
  id: "product-media",
  title: "Product image & gallery",
  route: "product-media-panel",
  collections: ["products"],
}];

/**
 * Options a site passes the native entry. The native entry is a development setup for the one place that
 * still runs it, the Template Store's playground; every other store runs the Registry build
 * (commerce-one-build-registry-20261031), and the two serve the same routes. The local Manage stock test
 * aid (`enableLocalStockManagement`) is gone with the native-only routes; a leftover option is ignored.
 */
export interface CommerceLocalDevelopmentOptions {
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
      ...(typeof options.siteUrl === "string" && options.siteUrl.trim() !== ""
        ? { siteUrl: options.siteUrl.trim() }
        : {}),
    },
    adminPages: COMMERCE_ADMIN_PAGES,
    editorPanels: COMMERCE_EDITOR_PANELS,
  };
}

export interface CommercePluginOptions extends CommerceLocalDevelopmentOptions {
  checkout?: GuestCheckoutHostOptions;
  customers?: ShopperAccountHostOptions;
}

// Checkout hands each paid order to Orders, which keeps its own copy.
const paidOrders = (storage: Record<string, unknown>) =>
  createPaidOrderReceiver(storage[ORDERS_COLLECTION] as OrdersCollection, storage[ORDER_NUMBERS_COLLECTION] as OrderNumbers);
const nativeOrdersForEmail = (storage: Record<string, unknown>, emailKey: string) =>
  listOrdersForEmail(storage[ORDERS_COLLECTION] as OrdersCollection, emailKey);

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
      product_feed_eligibility:
        ctx.storage[PRODUCT_FEED_ELIGIBILITY_COLLECTION] ?? ctx.storage.product_feed_eligibility,
    },
  };
}

/** Native storage names some collections in camelCase; the Block Kit admin reads them by their Registry (snake_case) names. */
function nativeAdminContext(ctx: Parameters<PluginRoute["handler"]>[0]) {
  const storage: Record<string, unknown> = { ...ctx.storage };
  for (const [name, collection] of Object.entries(ctx.storage)) storage[name.replace(/[A-Z]/g, letter => "_" + letter.toLowerCase())] ??= collection;
  return { ...ctx, storage };
}

/** A private Block Kit route (admin pages or the product page panel), handed the same route shape the Registry build gets. */
function nativeBlockKitRoute(handler: typeof commerceAdmin): PluginRoute {
  return {
    public: false,
    permission: "content:edit_any",
    methods: ["POST"],
    handler: async (ctx) => {
      // DinkusKit Connect only accepts Registry installs, so a native store's Settings has no Connect to press.
      const action = (ctx.input as { type?: unknown; action_id?: unknown } | null)?.action_id;
      const input = typeof action === "string" && action.startsWith("connect") ? { type: "page_load", page: "/settings" } : ctx.input;
      const response = await handler({ input, user: ctx.user, ui: ctx.ui,
        request: { method: ctx.request.method, url: ctx.request.url, headers: {} } } as never, nativeAdminContext(ctx) as never);
      return withoutConnect(response);
    },
  };
}

/** Swaps Settings' DinkusKit section for a note marked (DEV): Connect is for Registry stores. */
function withoutConnect<T>(response: T): T {
  const blocks = (response as { blocks?: { type: string; text?: unknown }[] } | null)?.blocks;
  const start = blocks?.findIndex(block => block.type === "header" && block.text === "DinkusKit") ?? -1;
  if (!blocks || start < 0) return response;
  let end = start + 1;
  while (end < blocks.length && blocks[end].type !== "header") end++;
  const note = { type: "context", text: "(DEV) This store runs Commerce from source. DinkusKit Connect is on Registry stores only." };
  return { ...response, blocks: [...blocks.slice(0, start), note, ...blocks.slice(end)] };
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
    // Exactly one itemId, or exactly one pageId for the product a published page sells.
    const query = new URL(ctx.request.url).searchParams, key = query.has("pageId") ? "pageId" : "itemId";
    if ([...query.keys()].some(name => name !== key) || query.getAll(key).length !== 1) {
      throw new Error("Invalid catalog item query");
    }
    return readPublicCatalogItem(nativePublicContext(ctx), query.get(key)!, key === "pageId");
  },
} satisfies PluginRoute;

export function createPlugin(options: CommercePluginOptions = {}): ResolvedPlugin {
  const topLevelSiteUrl = options.siteUrl;
  const checkoutSiteUrl = options.checkout?.siteUrl;
  const checkoutHost: GuestCheckoutHostOptions = Object.freeze({
    ...options.checkout,
    topLevelSiteUrl,
    checkoutSiteUrl,
    siteUrl: checkoutSiteUrl ?? topLevelSiteUrl,
  });
  const customersHost: ShopperAccountHostOptions = Object.freeze({
    ...options.customers,
    topLevelSiteUrl,
    siteUrl: options.customers?.siteUrl ?? checkoutSiteUrl ?? topLevelSiteUrl,
  });
  return definePlugin({
    id: COMMERCE_PLUGIN_ID,
    version: COMMERCE_PLUGIN_VERSION,
    // Product media reads alt text and dimensions live from the Media Library.
    capabilities: ["media:read", "network:request", "email:send", "admin.editor-draft:read"],
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
        indexes: ["emailKey"],
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
      [NATIVE_CUSTOMERS_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [],
      },
      [NATIVE_CUSTOMER_LOGIN_CODES_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [],
      },
      [NATIVE_CUSTOMER_SESSIONS_COLLECTION]: {
        indexes: [],
        uniqueIndexes: [],
      },
      [PRODUCT_PAGES_COLLECTION]: {
        indexes: ["entryId"],
        uniqueIndexes: [],
      },
    },
    admin: {
      pages: COMMERCE_ADMIN_PAGES,
      editorPanels: COMMERCE_EDITOR_PANELS,
    },
    routes: {
      [MERCHANT_STORE_SETTINGS_ROUTE]: nativeBlockKitRoute(commerceAdmin),
      "product-panel": nativeBlockKitRoute(productPanel),
      "product-media-panel": nativeBlockKitRoute(productMediaPanel),
      // The Registry build's catalog API (catalog-api-20261027), so the CLI works on a native store too.
      [CATALOG_API_ROUTE]: { public: false, permission: "content:edit_any", methods: ["POST"], handler: async (ctx) => {
        try {
          return await catalogApi({ input: ctx.input } as never, nativeAdminContext(ctx) as never);
        } catch (error) {
          if (error instanceof CatalogError) throw new PluginRouteError(error.code, error.message, error.status);
          throw error;
        }
      } },
      [PUBLIC_CATALOG_ROUTE]: publicCatalogRoute,
      [PUBLIC_CATALOG_ITEM_ROUTE]: publicCatalogItemRoute,
      // The store's publish check, as on the Registry build. The native-only catalog, settings and policy
      // routes are gone (commerce-one-build-registry-20261031): products are managed through the product
      // panels and the catalog route on both builds.
      [PRODUCT_PAGE_ON_SALE_ROUTE]: setProductPageOnSaleRoute,
      [GUEST_CHECKOUT_PREPARE_ROUTE]: createGuestCheckoutPrepareRoute(checkoutHost),
      [GUEST_CHECKOUT_START_ROUTE]: createGuestCheckoutStartRoute(checkoutHost, paidOrders),
      [GUEST_CHECKOUT_STATUS_ROUTE]: createGuestCheckoutStatusRoute(checkoutHost, paidOrders),
      [SHOPPER_SIGN_IN_START_ROUTE]: createShopperSignInStartRoute(customersHost),
      [SHOPPER_SIGN_IN_VERIFY_ROUTE]: createShopperSignInVerifyRoute(customersHost, nativeOrdersForEmail),
      [SHOPPER_SIGN_OUT_ROUTE]: createShopperSignOutRoute(customersHost),
      [SHOPPER_ACCOUNT_ORDERS_ROUTE]: createShopperAccountOrdersRoute(customersHost, nativeOrdersForEmail),
      [SHOPPER_ACCOUNT_PROFILE_ROUTE]: createShopperAccountProfileRoute(customersHost, nativeOrdersForEmail),
    },
  });
}

export default createPlugin;

export * from "./features/checkout/index.js";

export * from "./features/orders/index.js";
export { CATALOG_API_ROUTE } from "./admin/index.js";

export * from "./features/customers/index.js";

export * from "./features/fixed-bundles/index.js";
