import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoogleMerchantFeed,
  buildMetaCatalogFeed,
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
  const catalog = { get: async () => ({ recordKind: "catalog-item" }) };
  const storage = {
    get: async (id) => records.get(id) ?? null,
    put: async (id, value) => records.set(id, value),
  };
  assert.deepEqual(await loadProductFeedEligibility(storage, "item-hat"), []);
  await setProductFeedEligibility(storage, catalog, { catalogItemId: "item-hat", channels: [] });
  assert.deepEqual(await loadProductFeedEligibility(storage, "item-hat"), []);
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

test("optional identifiers and images are not invented", () => {
  const row = facts({
    content: { canonicalUrl: "https://shop.example.test/products/hat", title: "Hat" },
  });
  const google = buildGoogleMerchantFeed([row]);
  const meta = buildMetaCatalogFeed([row]);
  assert.equal(google.includes("g:image_link"), false);
  assert.equal(google.includes("g:gtin"), false);
  assert.equal(meta.includes("https://cdn.example.test"), false);
  assert.equal(meta.includes('"" ,""'), false);
});

test("feed paging is bounded and deterministic", () => {
  const rows = [facts({ product: product({ id: "one" }) }), facts({ product: product({ id: "two" }) })];
  assert.deepEqual(pageProductFeedRows(rows, { pageSize: 1 }), { rows: [rows[0]], nextCursor: 1 });
  assert.deepEqual(pageProductFeedRows(rows, { pageSize: 1, cursor: 1 }), { rows: [rows[1]] });
  assert.equal(pageProductFeedRows(rows, { pageSize: 9999 }).rows.length, 2);
});
