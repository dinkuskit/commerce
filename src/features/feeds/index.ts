export {
  buildAgentCatalogFeed,
  buildGoogleMerchantFeed,
  buildMetaCatalogFeed,
  buildStorefrontAgentsMd,
  buildStorefrontLlmsFullTxt,
  buildStorefrontLlmsTxt,
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
  AgentCatalogFeed,
  AgentCatalogProductEntry,
  ProductAiProjection,
  ProductFeedBuildOptions,
  ProductFeedChannel,
  ProductFeedContent,
  ProductFeedEligibilityCatalog,
  ProductFeedEligibilityRecord,
  ProductFeedEligibilityStorage,
  ProductFeedFacts,
  ProductFeedPage,
  SetProductFeedEligibilityInput,
  StorefrontAgentFeedOptions,
  StorefrontPolicySummary,
  StorefrontShippingQuoteInput,
} from "./types.js";
