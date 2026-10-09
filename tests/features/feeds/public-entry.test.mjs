import assert from "node:assert/strict";
import test from "node:test";

import * as commerce from "../../../dist/index.js";
import * as feeds from "../../../dist/features/feeds/index.js";

test("the package root and feature entry expose the same product-feeds contract", () => {
  for (const name of [
    "PRODUCT_FEED_CHANNELS",
    "SET_PRODUCT_FEED_ELIGIBILITY_ROUTE",
    "buildGoogleMerchantFeed",
    "buildMetaCatalogFeed",
    "loadProductFeedEligibility",
    "normalizeProductFeedChannels",
    "pageProductFeedRows",
    "setProductFeedEligibility",
    "setProductFeedEligibilityRoute",
  ]) {
    assert.ok(feeds[name] !== undefined, name);
    assert.equal(feeds[name], commerce[name], name);
  }
});
