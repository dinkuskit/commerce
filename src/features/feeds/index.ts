export {
  buildGoogleMerchantFeed,
  buildMetaCatalogFeed,
  pageProductFeedRows,
} from "./builder.js";
export {
  loadProductFeedEligibility,
  normalizeProductFeedChannels,
  setProductFeedEligibility,
} from "./eligibility.js";
export {
  PRODUCT_FEED_CHANNELS,
} from "./types.js";
export type {
  ProductFeedBuildOptions,
  ProductFeedChannel,
  ProductFeedContent,
  ProductFeedEligibilityCatalog,
  ProductFeedEligibilityRecord,
  ProductFeedEligibilityStorage,
  ProductFeedFacts,
  ProductFeedPage,
  SetProductFeedEligibilityInput,
} from "./types.js";
