import assert from "node:assert/strict";
import test from "node:test";
import { buildGoogleMerchantFeed, buildMetaCatalogFeed } from "../../../dist/features/feeds/index.js";

const stock = (status = "in-stock", listable = true) => ({ status, listable, sellable: status !== "out-of-stock" });
const member = (id, size, minor, status = "in-stock") => ({
  catalogItemId: id, sku: `SKU-${size}`, price: { currency: "USD", minor },
  availability: stock(status), fulfillment: "physical",
  selections: [{ optionId: "size", optionLabel: "Size", valueId: size.toLowerCase(), valueLabel: size }],
});
function family() {
  return {
    product: {
      id: "tee-m", name: "Field tee", sku: "TEE-M", image: null, gallery: [],
      availability: { ...stock(), sellable: false },
      gtin: "00012345678905", mpn: "DEFAULT-ONLY", brand: "Field & Road",
      variants: {
        schema: "dinkuskit.commerce.product-variants/v1", productId: "tee-m",
        options: [{ optionId: "size", label: "Size", values: ["M", "L", "XL"].map(value => ({ valueId: value.toLowerCase(), label: value })) }],
        members: [member("tee-m", "M", "1400"), member("tee-l", "L", "1600", "available-on-backorder"), member("tee-xl", "XL", "1800", "out-of-stock")],
      },
    },
    content: { canonicalUrl: "https://shop.example.test/products/tee", title: "Field tee",
      description: "Cotton, road & field", imageUrls: ["https://shop.example.test/tee.png"],
      variantUrls: Object.fromEntries(["m", "l", "xl"].map(size => [`tee-${size}`, `https://shop.example.test/products/tee?item=tee-${size}&view=shop`])),
    },
    eligibility: ["google-merchant", "meta-catalog"],
  };
}
const items = xml => [...xml.matchAll(/<item>(.*?)<\/item>/gs)].map(match => match[1]);
const field = (item, name) => item.match(new RegExp(`<g:${name}>(.*?)</g:${name}>`, "s"))?.[1];
// This fixture reader handles quoted fields, doubled quotes and embedded newlines.
function csvRows(text) {
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n")) {
      row.push(cell); cell = "";
      if (c === "\n") { rows.push(row); row = []; }
    } else cell += c;
  }
  assert.equal(quoted, false);
  const [header, ...data] = rows;
  return data.map(cells => Object.fromEntries(header.map((key, i) => [key, cells[i]])));
}

test("option families export each concrete member once, using its own price and stock", () => {
  const row = family();
  // A root/from price must never replace concrete member facts or create a fourth offer.
  row.product.price = { currency: "USD", minor: "999999" };
  const xml = buildGoogleMerchantFeed([row]); const google = items(xml); const meta = csvRows(buildMetaCatalogFeed([row]));
  assert.deepEqual(google.map(item => field(item, "id")), ["tee-m", "tee-l", "tee-xl"]);
  assert.deepEqual(google.map(item => field(item, "price")), ["14.00 USD", "16.00 USD", "18.00 USD"]);
  assert.deepEqual(google.map(item => field(item, "availability")), ["in stock", "backorder", "out of stock"]);
  assert.deepEqual(meta.map(item => item.id), ["tee-m", "tee-l", "tee-xl"]);
  assert.deepEqual(meta.map(item => item.retailer_id), meta.map(item => item.id));
  assert.deepEqual(meta.map(item => item.price), ["14.00 USD", "16.00 USD", "18.00 USD"]);
  assert.deepEqual(meta.map(item => item.availability), ["in stock", "available for order", "out of stock"]);
  assert.equal(xml.includes("9999.99"), false);
  assert.equal(xml.includes("sale_price"), false); // The public input supplies effective money, not a reconstructed Regular/Sale pair.
});

test("group identity, selection labels, host-owned member URLs and images survive serialization", () => {
  const row = family(); const google = items(buildGoogleMerchantFeed([row])); const meta = csvRows(buildMetaCatalogFeed([row]));
  for (const [index, size] of ["M", "L", "XL"].entries()) {
    assert.equal(field(google[index], "item_group_id"), "tee-m");
    assert.equal(field(google[index], "item_group_title"), "Field tee");
    assert.equal(field(google[index], "title"), `Field tee — Size: ${size}`);
    assert.equal(field(google[index], "size"), size);
    assert.match(google[index], new RegExp(`<g:variant_option><g:name>Size</g:name><g:value>${size}</g:value></g:variant_option>`));
    assert.equal(field(google[index], "link"), `https://shop.example.test/products/tee?item=tee-${size.toLowerCase()}&amp;view=shop`);
    assert.equal(meta[index].link, row.content.variantUrls[`tee-${size.toLowerCase()}`]);
    assert.equal(meta[index].size, size);
    assert.equal(meta[index].item_group_id, "tee-m");
    assert.equal(meta[index].image_link, row.content.imageUrls[0]);
  }
  assert.equal(buildGoogleMerchantFeed([row]), buildGoogleMerchantFeed([row]));
  assert.equal(buildMetaCatalogFeed([row]), buildMetaCatalogFeed([row]));
});

test("family identifiers never leak into members, including the default member that shares its id", () => {
  const row = family(); const xml = buildGoogleMerchantFeed([row]); const meta = csvRows(buildMetaCatalogFeed([row]));
  assert.equal(xml.includes("g:gtin"), false); assert.equal(xml.includes("g:mpn"), false);
  assert.equal(xml.includes(row.product.gtin), false); assert.equal(xml.includes(row.product.mpn), false);
  assert.equal([...xml.matchAll(/<g:identifier_exists>no<\/g:identifier_exists>/g)].length, 3);
  assert.ok(meta.every(item => item.gtin === "" && item.mpn === "" && item.brand === row.product.brand));
});

test("channel approval, published content and listability gate the whole family", () => {
  for (const edit of [row => { row.eligibility = []; }, row => { row.product.availability.listable = false; },
    row => { row.content.canonicalUrl = ""; }, row => { row.content.title = ""; }]) {
    const row = family(); edit(row);
    assert.equal(items(buildGoogleMerchantFeed([row])).length, 0);
    assert.equal(csvRows(buildMetaCatalogFeed([row])).length, 0);
  }
  const row = family(); row.eligibility = ["google-merchant"];
  assert.equal(items(buildGoogleMerchantFeed([row])).length, 3);
  assert.equal(csvRows(buildMetaCatalogFeed([row])).length, 0);
});

test("hidden/unpriced members and an explicitly empty member URL do not fall back to a root offer", () => {
  const row = family(); row.product.price = { currency: "USD", minor: "999999" };
  row.product.variants.members.push({ ...member("hidden", "S", "100"), availability: stock("in-stock", false) });
  row.product.variants.members.push({ ...member("unpriced", "XS", "100"), price: null });
  row.product.variants.members.push({ ...member("old-unpriced", "XXS", "100"), price: undefined });
  row.content.variantUrls["tee-l"] = "";
  assert.deepEqual(items(buildGoogleMerchantFeed([row])).map(item => field(item, "id")), ["tee-m", "tee-xl"]);
  assert.deepEqual(csvRows(buildMetaCatalogFeed([row])).map(item => item.id), ["tee-m", "tee-xl"]);
  row.product.variants.members = [];
  assert.equal(items(buildGoogleMerchantFeed([row])).length, 0);
  assert.equal(csvRows(buildMetaCatalogFeed([row])).length, 0);
});

test("legacy host projections with member selections but no option definitions still export concrete rows", () => {
  const row = family(); row.product.variants.options = [];
  assert.deepEqual(items(buildGoogleMerchantFeed([row])).map(item => field(item, "id")), ["tee-m", "tee-l", "tee-xl"]);
  assert.deepEqual(csvRows(buildMetaCatalogFeed([row])).map(item => item.id), ["tee-m", "tee-l", "tee-xl"]);
});

test("older hosts retain their supplied canonical URL; free members are still priced", () => {
  const row = family(); delete row.content.variantUrls;
  row.product.variants.members[0].price.minor = "0";
  assert.ok(items(buildGoogleMerchantFeed([row])).every(item => field(item, "link") === row.content.canonicalUrl));
  assert.equal(field(items(buildGoogleMerchantFeed([row]))[0], "price"), "0.00 USD");
  assert.ok(csvRows(buildMetaCatalogFeed([row])).every(item => item.link === row.content.canonicalUrl));
});

test("arbitrary multi-option labels are escaped as data, not invented XML tags or CSV columns", () => {
  const row = family(); row.content.title = 'Field <tee>, "road"\nEdition';
  for (const m of row.product.variants.members) m.selections.push({ optionId: "memory", optionLabel: 'Memory <&>', valueId: "wide", valueLabel: 'Wide, "road"\n<&>' });
  const xml = buildGoogleMerchantFeed([row]); const meta = csvRows(buildMetaCatalogFeed([row]));
  assert.match(xml, /<g:name>Memory &lt;&amp;&gt;<\/g:name>/);
  assert.match(xml, /<g:value>Wide, &quot;road&quot;\n&lt;&amp;&gt;<\/g:value>/);
  assert.equal(xml.includes("<g:memory"), false);
  assert.ok(meta.every(item => item.title.includes('Memory <&>: Wide, "road"\n<&>')));
  assert.ok(meta.every(item => !Object.hasOwn(item, "memory")));
});

test("simple/default-member products keep their existing identifiers and feed shape", () => {
  const row = family(); row.product.price = { currency: "USD", minor: "1200" };
  row.product.availability.sellable = true; row.product.variants.options = [];
  row.product.variants.members = [{ ...member("tee-m", "M", "1200"), selections: [] }];
  const xml = buildGoogleMerchantFeed([row]); const meta = buildMetaCatalogFeed([row]);
  assert.equal(items(xml).length, 1); assert.equal(field(items(xml)[0], "gtin"), row.product.gtin);
  assert.equal(field(items(xml)[0], "mpn"), row.product.mpn);
  assert.equal(xml.includes("item_group"), false); assert.equal(meta.includes("item_group"), false);
  assert.equal(csvRows(meta)[0].title, row.content.title);
  assert.equal(Object.keys(csvRows(meta)[0]).length, 14);
});
