import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentCatalogFeed,
  buildGoogleMerchantFeed,
  buildMetaCatalogFeed,
  buildStorefrontAgentsMd,
  buildStorefrontLlmsFullTxt,
  buildStorefrontLlmsTxt,
  backorderShipDate,
  loadProductFeedEligibility,
  pageProductFeedRows,
  setProductFeedEligibility,
} from "../../../dist/features/feeds/index.js";
import { buildProductJsonLd } from "../../../dist/features/structured-data/index.js";

function product(overrides = {}) {
  return {
    id: "item-hat",
    name: "Hat",
    sku: "HAT-1",
    price: { currency: "USD", minor: "1999" },
    availability: { status: "in-stock", sellable: true, listable: true },
    image: null,
    gallery: [],
    ...overrides,
  };
}

function facts(overrides = {}) {
  return {
    product: product(),
    content: {
      canonicalUrl: "https://shop.example.test/products/hat",
      title: "A wool hat",
      description: "Warm and useful",
      imageUrls: ["https://cdn.example.test/hat.jpg"],
    },
    eligibility: ["google-merchant", "meta-catalog"],
    ...overrides,
  };
}

test("new products are not eligible until explicitly opted in", async () => {
  const records = new Map();
  let item = { recordKind: "catalog-item", itemId: "item-hat" }, revision = "a";
  const catalog = {
    get: async () => structuredClone(item),
    getVersioned: async () => ({ value: structuredClone(item), revision }),
    compareAndSet: async (id, expected, next) => { if (expected !== revision) return { applied: false }; item = next; revision += "b"; return { applied: true, revision }; },
  };
  const storage = {
    get: async (id) => records.get(id) ?? null,
    put: async (id, value) => records.set(id, value),
  };
  assert.deepEqual(await loadProductFeedEligibility(storage, "item-hat", catalog), []);
  await setProductFeedEligibility(storage, catalog, { catalogItemId: "item-hat", channels: [] });
  assert.deepEqual(await loadProductFeedEligibility(storage, "item-hat", catalog), []);
});

test("opt-in and opt-out are reflected in both deterministic feeds", async () => {
  const row = facts();
  const google = buildGoogleMerchantFeed([row]);
  const meta = buildMetaCatalogFeed([row]);
  assert.match(google, /<g:id>item-hat<\/g:id>/);
  assert.match(google, /<g:price>19\.99 USD<\/g:price>/);
  assert.match(meta, /"item-hat","item-hat"/);
  assert.match(meta, /"19\.99 USD"/);
  assert.equal(buildGoogleMerchantFeed([{ ...row, eligibility: [] }]).includes("item-hat"), false);
  assert.equal(buildMetaCatalogFeed([{ ...row, eligibility: [] }]).split("\n").length, 2);
});

test("catalog facts, JSON-LD and feeds share price and availability", () => {
  const row = facts();
  const jsonLd = buildProductJsonLd({
    product: {
      id: row.product.id,
      name: row.product.name,
      sku: row.product.sku,
      price: row.product.price,
      availability: row.product.availability,
    },
    page: { url: row.content.canonicalUrl, name: row.content.title, description: row.content.description },
  });
  assert.equal(row.product.price.minor, "1999");
  assert.equal(jsonLd.offers.price, "19.99");
  assert.equal(jsonLd.offers.availability, "https://schema.org/InStock");
  assert.match(buildGoogleMerchantFeed([row]), /19\.99 USD/);
  assert.match(buildMetaCatalogFeed([row]), /19\.99 USD/);
  assert.match(buildGoogleMerchantFeed([row]), /in stock/);
  assert.match(buildMetaCatalogFeed([row]), /in stock/);
});

test("backorder rows keep backorder availability, matching JSON-LD BackOrder", () => {
  const row = facts({
    product: product({ availability: { status: "available-on-backorder", sellable: true, listable: true, shipBy: "2026-12-12" } }),
  });
  const jsonLd = buildProductJsonLd({
    product: { id: row.product.id, name: row.product.name, sku: row.product.sku, price: row.product.price, availability: row.product.availability },
    page: { url: row.content.canonicalUrl, name: row.content.title },
  });
  assert.equal(jsonLd.offers.availability, "https://schema.org/BackOrder");
  const google = buildGoogleMerchantFeed([row], new Date("2026-11-25T01:00:00Z"));
  const meta = buildMetaCatalogFeed([row]);
  assert.match(google, /<g:availability>backorder<\/g:availability><g:availability_date>2026-12-12T00:00:00Z<\/g:availability_date>/);
  assert.equal(google.includes("preorder"), false);
  assert.match(meta, /"available for order"/);
  assert.equal(meta.includes("preorder"), false);
});

test("Google needs a ship date on a backorder row: none, a passed one or one over a year ahead leaves the row out of Google only", () => {
  const now = new Date("2026-11-25T01:00:00Z");
  const row = shipBy => facts({ product: product({ availability: { status: "available-on-backorder", sellable: true, listable: true, ...(shipBy ? { shipBy } : {}) } }) });
  const sent = shipBy => buildGoogleMerchantFeed([row(shipBy)], now).includes("<g:id>item-hat</g:id>");
  assert.deepEqual([undefined, "2026-11-24", "2026-11-25", "2026-11-26", "2027-11-25", "2027-11-26", "12/12/2026"].map(sent),
    [false, false, false, true, true, false, false], "only tomorrow up to a year from today counts");
  for (const shipBy of [undefined, "2026-11-24"]) assert.match(buildMetaCatalogFeed([row(shipBy)]), /"available for order"/, "Meta needs no date");
  assert.equal(backorderShipDate({ status: "in-stock", shipBy: "2026-12-12" }, now), undefined, "a date on an item no longer on backorder is not shown");
  assert.equal(backorderShipDate({ status: "available-on-backorder", shipBy: "2026-12-12" }, now), "2026-12-12");
  for (const shipBy of ["2027-02-31", "2026-13-01", "12/12/2026", ["2026-12-12"]]) assert.equal(backorderShipDate({ status: "available-on-backorder", shipBy }, now), undefined, `${shipBy} is not a calendar day`);
  assert.equal(buildGoogleMerchantFeed([facts()], now).includes("availability_date"), false, "an in-stock row carries no date");
});

test("secondary images are kept as additional image links in both feeds", () => {
  const urls = Array.from({ length: 23 }, (_, index) => `https://cdn.example.test/hat-${index}.jpg`);
  const row = facts({ content: { ...facts().content, imageUrls: urls } });
  const google = buildGoogleMerchantFeed([row]);
  assert.match(google, /<g:image_link>https:\/\/cdn\.example\.test\/hat-0\.jpg<\/g:image_link>/);
  const googleExtra = [...google.matchAll(/<g:additional_image_link>([^<]+)<\/g:additional_image_link>/g)].map((match) => match[1]);
  assert.deepEqual(googleExtra, urls.slice(1, 11));
  const meta = buildMetaCatalogFeed([row]);
  const [header] = meta.split("\n");
  assert.match(header, /"image_link","additional_image_link"/);
  assert.equal(meta.includes(`"${urls.slice(1, 21).join(",")}"`), true);
  assert.equal(meta.includes("hat-21.jpg"), false);
  const single = buildGoogleMerchantFeed([facts()]);
  assert.equal(single.includes("g:additional_image_link"), false);
});

test("optional identifiers and images are not invented", () => {
  const row = facts({
    content: { canonicalUrl: "https://shop.example.test/products/hat", title: "Hat" },
  });
  const google = buildGoogleMerchantFeed([row]);
  const meta = buildMetaCatalogFeed([row]);
  assert.equal(google.includes("g:image_link"), false);
  assert.equal(google.includes("g:gtin"), false);
  assert.match(google, /<g:condition>new<\/g:condition>/);
  assert.match(google, /<g:identifier_exists>no<\/g:identifier_exists>/);
  assert.equal(meta.includes("https://cdn.example.test"), false);
  assert.equal(meta.includes('"" ,""'), false);
});

test("identifiers come from the catalog public product, including MPN", () => {
  const row = facts({ product: product({ gtin: "00012345678905", mpn: "HAT-MPN-7", brand: "Acme Wool" }) });
  const google = buildGoogleMerchantFeed([row]);
  assert.match(google, /<g:gtin>00012345678905<\/g:gtin>/);
  assert.match(google, /<g:mpn>HAT-MPN-7<\/g:mpn>/);
  assert.match(google, /<g:brand>Acme Wool<\/g:brand>/);
  assert.match(google, /<g:condition>new<\/g:condition>/);
  assert.equal(google.includes("g:identifier_exists"), false);
  const brandAndMpn = buildGoogleMerchantFeed([facts({ product: product({ mpn: "HAT-MPN-7", brand: "Acme Wool" }) })]);
  assert.equal(brandAndMpn.includes("g:identifier_exists"), false);
  const brandOnly = buildGoogleMerchantFeed([facts({ product: product({ brand: "Acme Wool" }) })]);
  assert.match(brandOnly, /<g:identifier_exists>no<\/g:identifier_exists>/);
  const [header, line] = buildMetaCatalogFeed([row]).trim().split("\n");
  const columns = header.split(",").map((cell) => cell.replaceAll('"', ""));
  const cells = line.split(",").map((cell) => cell.replaceAll('"', ""));
  assert.equal(cells[columns.indexOf("gtin")], "00012345678905");
  assert.equal(cells[columns.indexOf("mpn")], "HAT-MPN-7");
  assert.equal(cells[columns.indexOf("brand")], "Acme Wool");
  const hostOnly = facts({ gtin: "99999999999999", brand: "Host Brand" });
  assert.equal(buildGoogleMerchantFeed([hostOnly]).includes("99999999999999"), false);
  assert.equal(buildMetaCatalogFeed([hostOnly]).includes("Host Brand"), false);
});

// template-product-category-feeds-20261124: Google and Meta get Google's category id from Shopify's
// map and the store's own category as product_type; the agent feed gets Shopify's id and name.
test("a standard category reaches every feed, and Uncategorized sends none", () => {
  const hats = { taxonomy: "shopify", version: "2026-11", id: "aa-2-17", name: "Hats", googleId: "173" };
  const row = facts({ content: { ...facts().content, standardCategory: hats, productType: "Winter & hats" } });
  const google = buildGoogleMerchantFeed([row]);
  assert.match(google, /<g:google_product_category>173<\/g:google_product_category>/);
  assert.match(google, /<g:product_type>Winter &amp; hats<\/g:product_type>/);
  const [header, line] = buildMetaCatalogFeed([row]).trim().split("\n");
  const columns = header.split(",").map((cell) => cell.replaceAll('"', ""));
  const cells = line.split(",").map((cell) => cell.replaceAll('"', ""));
  assert.equal(cells[columns.indexOf("google_product_category")], "173");
  assert.equal(cells[columns.indexOf("product_type")], "Winter & hats");
  const agent = buildAgentCatalogFeed({ storeName: "Shop", siteOrigin: "https://shop.example.test", products: [row] });
  assert.deepEqual(agent.products[0].category, { taxonomy: "shopify", version: "2026-11", id: "aa-2-17", name: "Hats" });
  assert.match(buildStorefrontLlmsFullTxt({ storeName: "Shop", siteOrigin: "https://shop.example.test", products: [row] }), /- Category: Hats \(Shopify `aa-2-17`\)/);

  // A category Shopify maps to nothing keeps its agent entry and sends Google nothing, never a guess.
  const seeds = { taxonomy: "shopify", version: "2026-11", id: "fb-4-3-2", name: "Non-Viable Seeds" };
  const unmapped = facts({ content: { ...facts().content, standardCategory: seeds } });
  assert.equal(buildGoogleMerchantFeed([unmapped]).includes("google_product_category"), false);
  assert.equal(buildMetaCatalogFeed([unmapped]).includes("google_product_category"), false);

  // Uncategorized: no category anywhere, and Meta's header is what it was.
  const plain = facts();
  assert.equal(/google_product_category|product_type/.test(buildGoogleMerchantFeed([plain])), false);
  assert.equal(buildMetaCatalogFeed([plain]).split("\n")[0].includes("product_type"), false);
  assert.equal("category" in buildAgentCatalogFeed({ storeName: "Shop", siteOrigin: "https://shop.example.test", products: [plain] }).products[0], false);
});

test("feed paging is bounded and deterministic", () => {
  const rows = [facts({ product: product({ id: "one" }) }), facts({ product: product({ id: "two" }) })];
  assert.deepEqual(pageProductFeedRows(rows, { pageSize: 1 }), { rows: [rows[0]], nextCursor: 1 });
  assert.deepEqual(pageProductFeedRows(rows, { pageSize: 1, cursor: 1 }), { rows: [rows[1]] });
  assert.equal(pageProductFeedRows(rows, { pageSize: 9999 }).rows.length, 2);
  // A page size that is not a whole number is refused rather than handing back the same cursor forever.
  for (const pageSize of [Number("abc"), 1.5, Infinity, "2"]) {
    assert.throws(() => pageProductFeedRows(rows, { pageSize }), /invalid feed page size/, String(pageSize));
  }
});

test("XML-illegal characters in product text are dropped, so one product cannot break the whole feed", () => {
  const bad = facts({ content: { ...facts().content, title: "Wool\u0000 hat\u000B\uD800", description: "Warm\u001F and \uD83E\uDDE2 useful\uFFFF" } });
  const google = buildGoogleMerchantFeed([bad, facts({ product: product({ id: "item-scarf" }) })]);
  assert.doesNotMatch(google, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/);
  assert.doesNotMatch(google, /[\uD800-\uDFFF]/u, "no lone surrogate is left");
  assert.match(google, /Wool hat/);
  assert.match(google, /Warm and \uD83E\uDDE2 useful/, "a real emoji (a surrogate pair) is kept");
  assert.match(google, /item-scarf/, "the next product is still in the feed");
  const meta = buildMetaCatalogFeed([bad]);
  assert.doesNotMatch(meta, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/);
  assert.match(meta, /Wool hat/);
});

test("storefront agent feeds project aiProjection, policies, and virtual-card minor-unit sizing deterministically", () => {
  const row = facts({
    product: product({ id: "item-hat", sku: "HAT-1", fulfillment: "physical", brand: "Dinkus" }),
    content: {
      canonicalUrl: "https://shop.example.test/products/hat",
      title: "A wool hat",
      description: "Warm and useful",
      imageUrls: ["https://cdn.example.test/hat.jpg"],
      aiProjection: {
        summary: "Merino wool watch cap for cold weather.",
        highlights: ["100% merino wool", "Made in USA"],
        specs: { Material: "Merino wool", Weight: "95g" },
        shippingSummary: "Ships in 1-2 business days.",
        returnPolicySummary: "30-day returns on unworn items.",
      },
    },
  });
  const unlisted = facts({
    product: product({ id: "item-hidden", availability: { status: "out-of-stock", sellable: false, listable: false } }),
  });
  const optedOut = facts({
    product: product({ id: "item-opted-out", sku: "OPT-OUT" }),
    eligibility: [],
  });
  const variantFamily = facts({
    product: {
      id: "family-hoodie",
      name: "Hoodie",
      sku: "HOODIE",
      availability: { status: "in-stock", sellable: false, listable: true },
      image: null,
      gallery: [],
      variants: {
        schema: "dinkuskit.commerce.product-variants/v1",
        productId: "family-hoodie",
        options: [
          {
            optionId: "size",
            label: "Size",
            values: [
              { valueId: "l", label: "Large" },
              { valueId: "s", label: "Small" },
            ],
          },
        ],
        members: [
          {
            catalogItemId: "member-hoodie-l",
            selections: [{ optionId: "size", optionLabel: "Size", valueId: "l", valueLabel: "Large" }],
            price: { currency: "USD", minor: "4500" },
            availability: { status: "in-stock", sellable: true, listable: true },
            fulfillment: "digital",
          },
          {
            catalogItemId: "member-hoodie-s",
            selections: [{ optionId: "size", optionLabel: "Size", valueId: "s", valueLabel: "Small" }],
            price: { currency: "USD", minor: "1000" },
            availability: { status: "in-stock", sellable: true, listable: true },
            fulfillment: "digital",
          },
        ],
      },
    },
    content: {
      canonicalUrl: "https://shop.example.test/products/hoodie",
      title: "Digital Pattern Hoodie",
    },
    eligibility: ["google-merchant"],
  });
  const unfulfilledSimple = facts({
    product: product({ id: "item-no-fulfillment", sku: "PLAIN-1" }),
    content: {
      canonicalUrl: "https://shop.example.test/products/plain",
      title: "Plain Item",
    },
    eligibility: ["meta-catalog"],
  });
  const options = {
    storeName: "Example Store",
    siteOrigin: "https://shop.example.test/",
    description: "Curated outdoor essentials.",
    pluginId: "r_gshdrqaldna3r7sn",
    checkoutBreakdownSelector: "[data-checkout-breakdown]",
    products: [row, unlisted, optedOut, variantFamily, unfulfilledSimple],
    shipping: {
      mode: "flat",
      amount: { currency: "USD", minor: "700" },
      freeOver: { currency: "USD", minor: "5000" },
    },
    policies: [
      {
        slug: "refund-policy",
        title: "Refund & Return Policy",
        url: "https://shop.example.test/policies/refund-policy",
        body: "Unworn items may be returned within 30 days.",
      },
    ],
  };

  const agentFeed = buildAgentCatalogFeed(options);
  assert.equal(agentFeed.schema, "dinkuskit.commerce.agent-catalog-feed/v1");
  assert.equal(agentFeed.siteOrigin, "https://shop.example.test");
  assert.deepEqual(
    agentFeed.products.map((item) => item.id),
    ["item-hat", "family-hoodie", "item-no-fulfillment"],
  );
  assert.equal(agentFeed.products[0].price.minor, "1999");
  assert.equal(agentFeed.products[0].price.formatted, "$19.99 USD");
  assert.equal(agentFeed.products[0].fulfillment, "physical");
  assert.deepEqual(agentFeed.products[0].aiProjection?.highlights, ["100% merino wool", "Made in USA"]);
  assert.equal(agentFeed.products[1].price, undefined);
  assert.equal(agentFeed.products[1].fulfillment, "digital");
  assert.equal(agentFeed.products[1].variants?.members[0]?.catalogItemId, "member-hoodie-l");
  assert.equal(agentFeed.products[1].variants?.members[0]?.price.minor, "4500");
  assert.equal(agentFeed.products[1].variants?.members[1]?.catalogItemId, "member-hoodie-s");
  assert.equal(agentFeed.products[1].variants?.members[1]?.price.minor, "1000");
  assert.equal(agentFeed.products[2].fulfillment, undefined);
  assert.equal(agentFeed.virtualCardSizing.taxMinor, "0");

  const llmsTxt = buildStorefrontLlmsTxt(options);
  assert.match(llmsTxt, /# Example Store/);
  assert.match(llmsTxt, /\[A wool hat\]\(https:\/\/shop\.example\.test\/products\/hat\): \$19\.99 USD \(1999 minor units\), in-stock, SKU `HAT-1`, physical — Merino wool watch cap for cold weather\./);
  assert.match(llmsTxt, /\[Digital Pattern Hoodie\]\(https:\/\/shop\.example\.test\/products\/hoodie\): from \$10\.00 USD \(2 variants\), in-stock, SKU `HOODIE`, digital/);
  assert.equal(llmsTxt.includes("OPT-OUT"), false);
  assert.match(llmsTxt, /Tax: `0` minor units/);
  assert.match(llmsTxt, />= 5000 minor units, inclusive, after coupon discounts/);

  const llmsFullTxt = buildStorefrontLlmsFullTxt(options);
  assert.match(llmsFullTxt, /## Detailed Product Projections/);
  assert.match(llmsFullTxt, /- Highlights: 100% merino wool; Made in USA/);
  assert.match(llmsFullTxt, /- Specs: Material: Merino wool, Weight: 95g/);
  assert.match(llmsFullTxt, /catalogItemId: "member-hoodie-s"/);
  assert.match(llmsFullTxt, /### Refund & Return Policy/);
  assert.match(llmsFullTxt, /Unworn items may be returned within 30 days\./);

  const agentsMd = buildStorefrontAgentsMd(options);
  assert.match(agentsMd, /data-checkout-total-minor/);
  assert.match(agentsMd, /tax: \{ currency: "USD", minor: "0" \}/);
  assert.match(agentsMd, /\/_emdash\/api\/plugins\/r_gshdrqaldna3r7sn\/catalog\/public/);
  assert.match(agentsMd, /\/_emdash\/api\/plugins\/r_gshdrqaldna3r7sn\/checkout\/guest\/prepare/);
  assert.match(agentsMd, /\/_emdash\/api\/plugins\/r_gshdrqaldna3r7sn\/checkout\/guest\/start/);
  assert.match(agentsMd, /\/_emdash\/api\/plugins\/r_gshdrqaldna3r7sn\/checkout\/guest\/cart/);
  assert.doesNotMatch(agentsMd, /checkout\/guest\/status/);
  assert.match(agentsMd, /Checkout starts from the saved cart, so send no `lines`/);
  assert.match(agentsMd, /data\.capability\.capability/);
  assert.match(agentsMd, /data\.checkout\.pricing\.finalTotal\.minor/);
  assert.match(agentsMd, /data\.checkout\.redirectUrl/);
  assert.match(agentsMd, /data\.checkout\.state === "paid"/);
  assert.match(agentsMd, /data\.checkout\.order/);
  assert.equal(agentsMd.includes("shippingCountries"), false);
  assert.equal(agentsMd.includes("sessionId"), false);
  assert.equal(agentsMd.includes("paymentSession"), false);
  assert.match(agentsMd, /`billing`: required on every checkout/);

  const agentsMdWithoutDom = buildStorefrontAgentsMd({ ...options, checkoutBreakdownSelector: undefined });
  assert.equal(agentsMdWithoutDom.includes("data-checkout-total-minor"), false);
});

test("agent guide sizes cards from frozen start pricing, not optional DOM estimates", () => {
  const options = { storeName: "Example Store", siteOrigin: "https://shop.example.test", products: [facts()] };
  for (const checkoutBreakdownSelector of [undefined, "[data-checkout-breakdown]"]) {
    const guide = buildStorefrontAgentsMd({ ...options, checkoutBreakdownSelector });
    assert.match(guide, /final card limit exclusively from Commerce's authoritative frozen `data\.checkout\.pricing\.finalTotal\.minor`/);
    if (checkoutBreakdownSelector) {
      assert.match(guide, /pre-start \*\*estimate\*\* attributes/);
      assert.match(guide, /before Commerce applies coupons, free-shipping thresholds, or authoritative start pricing/);
      assert.match(guide, /5000-cent basket.*5500.*5000-cent free-shipping threshold/);
    } else {
      assert.equal(guide.includes("data-checkout-total-minor"), false);
    }
  }
});

test("agent guide distinguishes an unresolved attempt from an authoritative release", () => {
  const guide = buildStorefrontAgentsMd({ storeName: "Example Store", siteOrigin: "https://shop.example.test", products: [facts()] });
  const recovery = guide.split("\n").find(line => line.includes('state === "recoverable-failure"'));
  assert.ok(recovery);
  assert.match(recovery, /do not treat the attempt as released or issue a fresh/);
  assert.match(recovery, /preserve the active `attemptId`/);
  assert.match(recovery, /same attempt/);
  const release = guide.split("\n").find(line => line.includes('state === "released-retry"'));
  assert.ok(release);
  assert.notEqual(recovery, release);
  assert.match(release, /data\.checkout\.retryAfter === data\.checkout\.attemptId/);
  assert.match(release, /retain the existing `x-commerce-guest-capability`/);
  assert.match(release, /successor/);
  assert.match(guide, /at most 5 checks per attempt/);
  assert.match(guide, /data\.checkout\.state === "paid".*data\.checkout\.order/);
});
