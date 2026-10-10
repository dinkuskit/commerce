// Registry-safe public entry: no native routes or host-side feed builders.
export {
  loadProductFeedEligibility,
  normalizeProductFeedChannels,
  setProductFeedEligibility,
} from "../eligibility.js";
export { PRODUCT_FEED_CHANNELS } from "../types.js";
export type {
  ProductFeedChannel,
  ProductFeedEligibilityCatalog,
  ProductFeedEligibilityRecord,
  ProductFeedEligibilityStorage,
} from "../types.js";
