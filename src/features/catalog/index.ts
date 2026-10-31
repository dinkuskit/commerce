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
export { setProductPageOnSaleRoute } from "./route.js";
export { setCatalogItemSku } from "./set-sku.js";
export { offShop, renameCatalogProduct, setCatalogProductArchived, setCatalogProductOnSale, editProduct } from "./product-edit.js";
export { PRODUCT_PAGES_COLLECTION, claimProductPage, linkProductPage, pageProduct, productNotFound, setProductPageOnSale } from "./product-pages.js";
export type { ProductPageRecord, ProductPages } from "./product-pages.js";
export type { SetCatalogItemSkuInput, SetCatalogItemSkuResult } from "./set-sku.js";
export { setCatalogItemIdentifiers } from "./set-identifiers.js";
export { CATALOG_WEIGHT_MESSAGE, normalizeWeightOz, setCatalogItemWeight } from "./weight.js";
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
