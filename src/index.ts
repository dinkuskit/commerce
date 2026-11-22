/**
 * The package root: Commerce's feature libraries, for host apps that import them (storefronts, feeds, tests).
 * It is not an EmDash plugin entry. EmDash sites install Commerce as the Registry (sandboxed) build, from
 * `@dinkuskit/commerce/sandbox` and `@dinkuskit/commerce/descriptor`; the native entry (`createPlugin`,
 * `dinkusCommerce`) is gone (commerce-remove-native-entry-20261101).
 */
export * from "./features/inventory-provider/index.js";

export * from "./features/catalog/index.js";

export * from "./features/feeds/index.js";

export * from "./features/inventory-setup/index.js";

export * from "./features/storefront-availability/index.js";

export * from "./features/store-settings/index.js";

export * from "./features/structured-data/index.js";

export * from "./features/checkout/index.js";

export * from "./features/orders/index.js";
export { CATALOG_API_ROUTE } from "./admin/index.js";


export * from "./features/fixed-bundles/index.js";
