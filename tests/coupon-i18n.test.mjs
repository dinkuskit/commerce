import assert from "node:assert/strict";
import test from "node:test";
import { setupI18n } from "@lingui/core";

import { englishCouponCatalog } from "../dist/admin/coupon-catalog.js";
import { couponText, formatCouponMessage } from "../dist/admin/coupon-i18n.js";

// The Registry artifact no longer ships the Lingui runtime. The pinned catalog
// (scripts/coupon-catalog.mjs) holds only plain strings and single-name
// placeholders, so a local interpolator must match Lingui for every message.
// Deliberate difference not sampled here: Lingui decodes literal \u and \x
// escape sequences in the final string (including interpolated runtime
// values); the local formatter leaves values as typed.
const samples = [
  undefined,
  {},
  { reason: "Storage unavailable", code: "WELCOME" },
  { reason: 0, code: 1234.5 },
  { reason: null, code: undefined },
  { reason: "Only {code} here", code: "{reason}" },
];

test("local interpolation equals @lingui/core for every catalog message and sample values", () => {
  const i18n = setupI18n({ locale: "en", messages: { en: englishCouponCatalog } });
  const messages = Object.keys(englishCouponCatalog);
  assert.ok(messages.length > 40);
  for (const message of messages) {
    for (const values of samples) {
      assert.equal(
        formatCouponMessage(englishCouponCatalog, message, values),
        i18n._(message, values, { message }),
        `${message} with ${JSON.stringify(values)}`,
      );
    }
  }
  assert.equal(formatCouponMessage(englishCouponCatalog, "Not in the catalog {x}", { x: 1 }), i18n._("Not in the catalog {x}", { x: 1 }, { message: "Not in the catalog {x}" }));
});

test("couponText stays host-locale agnostic and formats placeholders", () => {
  const t = couponText({ ui: { locale: "ar", direction: "rtl" } });
  assert.equal(t("Open {code}", { code: "SPRING" }), "Open SPRING");
  assert.equal(t("Coupon changes were not saved. {reason}", { reason: "refused" }), "Coupon changes were not saved. refused");
  assert.equal(t("Coupons"), "Coupons");
});
