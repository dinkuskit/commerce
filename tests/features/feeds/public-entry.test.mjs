import assert from "node:assert/strict";
import test from "node:test";

import * as commerce from "../../../dist/index.js";
import * as feeds from "../../../dist/features/feeds/index.js";

test("the package root and feature entry expose the same product-feeds contract", () => {
  for (const name of [
    "PRODUCT_FEED_CHANNELS",
    "buildAgentCatalogFeed",
    "buildGoogleMerchantFeed",
    "buildMetaCatalogFeed",
    "buildStorefrontAgentsMd",
    "buildStorefrontLlmsFullTxt",
    "buildStorefrontLlmsTxt",
    "loadProductFeedEligibility",
    "normalizeProductFeedChannels",
    "pageProductFeedRows",
    "setProductFeedEligibility",
  ]) {
    assert.ok(feeds[name] !== undefined, name);
    assert.equal(feeds[name], commerce[name], name);
  }
});
