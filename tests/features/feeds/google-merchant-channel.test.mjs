import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { buildGoogleMerchantFeed } from "../../../dist/features/feeds/index.js";

const channel = {
  title: `Field & "Camp"`,
  link: "https://shop.example.test/?a=1&b=2",
  description: "Gear <notes> & more",
};
const metadata = "<title>Field &amp; &quot;Camp&quot;</title>" +
  "<link>https://shop.example.test/?a=1&amp;b=2</link>" +
  "<description>Gear &lt;notes&gt; &amp; more</description>";
const now = new Date("2026-11-25T01:00:00Z");
const row = {
  product: {
    id: "field-mug", name: "Field Mug", price: { currency: "USD", minor: "1800" },
    availability: { status: "available-on-backorder", sellable: true, listable: true, shipBy: "2026-12-02" },
  },
  content: { canonicalUrl: "https://shop.example.test/products/field-mug", title: "Field Mug" },
  eligibility: ["google-merchant"],
};

test("channel metadata stays present when no products are eligible", () => {
  const empty = buildGoogleMerchantFeed([], { channel, now });
  assert.ok(empty.endsWith(`<channel>${metadata}</channel></rss>`));
  assert.equal(buildGoogleMerchantFeed([{ ...row, eligibility: [] }], { channel, now }), empty);
});

test("channel metadata precedes unchanged product rows and respects the supplied clock", () => {
  const old = buildGoogleMerchantFeed([row], now);
  assert.match(old, /<g:availability_date>2026-12-02T00:00:00Z<\/g:availability_date>/);
  assert.equal(buildGoogleMerchantFeed([row], { channel, now }), old.replace("<channel>", `<channel>${metadata}`));
});

test("the channel serializes the same absolute link that was validated", () => {
  const xml = buildGoogleMerchantFeed([], { channel: { ...channel, link: "https:shop.example.test?a=1&b=2" } });
  assert.match(xml, /<link>https:\/\/shop\.example\.test\/\?a=1&amp;b=2<\/link>/);
});

test("the legacy overload accepts a Date from another realm without changing the feed", () => {
  const foreignDate = runInNewContext("new Date('2026-11-25T01:00:00Z')");
  assert.equal(buildGoogleMerchantFeed([row], foreignDate), buildGoogleMerchantFeed([row], now));
});

test("supplied channel metadata must have text and an absolute web link", () => {
  for (const fields of [{ title: " " }, { description: "" }, { link: "/" }, { link: "ftp://shop.example.test" }, { link: "https://user:pass@shop.example.test" }]) {
    assert.throws(() => buildGoogleMerchantFeed([], { channel: { ...channel, ...fields } }), /Google Merchant RSS needs/);
  }
});
