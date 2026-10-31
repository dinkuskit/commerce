import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentCatalogFeed,
  buildGoogleMerchantFeed,
  buildMetaCatalogFeed,
  buildStorefrontAgentsMd,
  buildStorefrontLlmsFullTxt,
  buildStorefrontLlmsTxt,
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
    product: product({ availability: { status: "available-on-backorder", sellable: true, listable: true } }),
  });
  const jsonLd = buildProductJsonLd({
    product: { id: row.product.id, name: row.product.name, sku: row.product.sku, price: row.product.price, availability: row.product.availability },
    page: { url: row.content.canonicalUrl, name: row.content.title },
  });
  assert.equal(jsonLd.offers.availability, "https://schema.org/BackOrder");
  const google = buildGoogleMerchantFeed([row]);
  const meta = buildMetaCatalogFeed([row]);
  assert.match(google, /<g:availability>backorder<\/g:availability>/);
  assert.equal(google.includes("preorder"), false);
  assert.match(meta, /"available for order"/);
  assert.equal(meta.includes("preorder"), false);
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

test("feed paging is bounded and deterministic", () => {
  const rows = [facts({ product: product({ id: "one" }) }), facts({ product: product({ id: "two" }) })];
  assert.deepEqual(pageProductFeedRows(rows, { pageSize: 1 }), { rows: [rows[0]], nextCursor: 1 });
  assert.deepEqual(pageProductFeedRows(rows, { pageSize: 1, cursor: 1 }), { rows: [rows[1]] });
  assert.equal(pageProductFeedRows(rows, { pageSize: 9999 }).rows.length, 2);
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
  assert.match(agentsMd, /\/_emdash\/api\/plugins\/r_gshdrqaldna3r7sn\/checkout\/guest\/status/);
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
