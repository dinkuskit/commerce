export * from "./kernel/index.js";

/** Native-only catalog surface (not part of the sandbox kernel). */
export { setCatalogItemBackorders } from "./set-backorders.js";
export {
  clearCatalogItemRegularPrice,
  clearCatalogItemSalePrice,
  setCatalogItemRegularPrice,
  setCatalogItemSalePrice,
} from "./price.js";
export {
  LOCAL_STOCK_MANAGEMENT_OPTION,
  isLocalLoopbackContext,
  isLocalStockManagementEnabled,
  isLoopbackUrl,
  manageStockControlFromAdmission,
  manageStockMutationsAllowed,
  normalizeHostLocalStockOption,
  readLocalStockAdmission,
  trustedSiteUrlSources,
} from "./local-stock-development.js";
export type {
  LocalStockAdmissionContext,
  LocalStockHostOptions,
  ManageStockControl,
} from "./local-stock-development.js";
export {
  COMMERCE_IMAGE_ENDPOINT_ROUTE,
  COMMERCE_IMAGE_PRESETS,
  COMMERCE_IMAGE_SIZES,
  COMMERCE_IMAGE_SRCSET_WIDTHS,
  commerceImageSrcset,
  commerceImageTransformUrl,
} from "./media-projection.js";
export {
  PUBLIC_CATALOG_ITEM_ROUTE,
  PUBLIC_CATALOG_ROUTE,
  readPublicCatalog,
  readPublicCatalogItem,
} from "./public.js";
export type {
  PublicCatalogProduct,
  PublicCatalogResponse,
} from "./public.js";
export {
  clearCatalogItemRegularPriceRoute,
  addCatalogVariantOptionRoute,
  bulkSaveCatalogProductPricesRoute,
  clearCatalogItemSalePriceRoute,
  createCatalogItemRoute,
  createCatalogItemRouteWithLocalStock,
  createListCatalogProductsRouteWithLocalStock,
  createSaveCatalogProductPricesRouteWithLocalStock,
  listCatalogProductsRoute,
  saveCatalogItemMediaRoute,
  setCatalogItemSkuRoute,
  setCatalogItemIdentifiersRoute,
  saveCatalogProductPricesRoute,
  setCatalogItemBackordersRoute,
  setCatalogItemManualAvailabilityRoute,
  setCatalogItemRegularPriceRoute,
  setCatalogItemSalePriceRoute,
  updateCatalogVariantLabelsRoute,
} from "./route.js";
export { setCatalogItemSku } from "./set-sku.js";
export type { SetCatalogItemSkuInput, SetCatalogItemSkuResult } from "./set-sku.js";
export { setCatalogItemIdentifiers } from "./set-identifiers.js";
export type {
  SetCatalogItemIdentifiersInput,
  SetCatalogItemIdentifiersResult,
} from "./set-identifiers.js";
export {
  normalizeGtin,
  normalizeIdentifierPatch,
  projectIdentifiers,
} from "./identifiers.js";
export type { CatalogProductIdentifiers } from "./identifiers.js";
