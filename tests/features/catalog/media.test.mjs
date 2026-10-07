import assert from "node:assert/strict";
import test from "node:test";

import {
  CATALOG_GALLERY_LIMIT,
  COMMERCE_IMAGE_PRESETS,
  COMMERCE_IMAGE_SIZES,
  CatalogError,
  PLACEHOLDER_IMAGE_ROUTE,
  SAVE_CATALOG_ITEM_MEDIA_ROUTE,
  commerceImageSrcset,
  commerceImageTransformUrl,
  createPlugin,
  createProductImageProjector,
  loadCatalogItemMedia,
  loadStorefrontPlaceholderImage,
  normalizeMediaReference,
  readPublicCatalog,
  saveCatalogItemMedia,
  setStorefrontPlaceholderImage,
} from "../../../dist/index.js";

const HAT = "01HAT000000000000000000000";
const SIDE = "01SIDE00000000000000000000";
const BACK = "01BACK00000000000000000000";

function collection(records = []) {
  const map = new Map(records.map(([id, value]) => [id, structuredClone(value)]));
  return {
    map,
    async get(id) { return map.has(id) ? structuredClone(map.get(id)) : null; },
    async put(id, value) { map.set(id, structuredClone(value)); },
    async delete(id) { map.delete(id); },
    async query() {
      return { items: [...map].map(([id, data]) => ({ id, data: structuredClone(data) })), hasMore: false };
    },
  };
}

const item = {
  recordKind: "catalog-item", itemId: "hat", commandId: "c", creationIntent: { manageStock: false },
  kind: "simple-product", name: "Red hat", sku: "RED-HAT", skuKey: "RED-HAT",
  stockManagement: { mode: "unmanaged" }, state: "draft", createdAt: "2026-10-07T00:00:00.000Z",
};

function mediaStorage() {
  return { catalog: collection([["hat", item]]), media: collection() };
}

test("media references are Media Library media ids only", () => {
  assert.deepEqual(normalizeMediaReference(" " + HAT + " ", "image"), { mediaId: HAT });
  for (const bad of ["", "/_emdash/api/media/file/a.png", "https://cdn.example.test/a.png", "a b", "x".repeat(129), 12, null]) {
    assert.throws(() => normalizeMediaReference(bad, "image"), (error) => error instanceof CatalogError && error.code === "INVALID_INPUT");
  }
});

test("save media keeps omitted fields, clears with null or empty, and refuses bad galleries", async () => {
  const storage = mediaStorage();
  assert.deepEqual(await loadCatalogItemMedia(storage.media, "hat"), { recordKind: "catalog-media", recordId: "hat", catalogItemId: "hat", image: null, gallery: [] });
  const first = await saveCatalogItemMedia(storage, { catalogItemId: "hat", image: HAT });
  assert.equal(first.changed, true);
  assert.deepEqual(first.media.image, { mediaId: HAT });
  assert.equal((await saveCatalogItemMedia(storage, { catalogItemId: "hat", image: HAT })).changed, false);
  const withGallery = await saveCatalogItemMedia(storage, { catalogItemId: "hat", gallery: [SIDE, BACK] });
  assert.deepEqual(withGallery.media.image, { mediaId: HAT }, "gallery save keeps the primary image");
  assert.deepEqual(withGallery.media.gallery, [{ mediaId: SIDE }, { mediaId: BACK }]);
  const reordered = await saveCatalogItemMedia(storage, { catalogItemId: "hat", gallery: [BACK, SIDE] });
  assert.deepEqual(reordered.media.gallery.map((entry) => entry.mediaId), [BACK, SIDE]);
  const cleared = await saveCatalogItemMedia(storage, { catalogItemId: "hat", image: "" });
  assert.equal(cleared.media.image, null);
  assert.equal(cleared.media.gallery.length, 2, "clearing the image keeps the gallery");
  const emptied = await saveCatalogItemMedia(storage, { catalogItemId: "hat", image: null, gallery: [] });
  assert.equal(emptied.changed, true);
  assert.equal(storage.media.map.size, 0, "an empty media record is deleted");
  for (const [input, pattern] of [
    [{ catalogItemId: "hat", gallery: Array.from({ length: CATALOG_GALLERY_LIMIT + 1 }, (_, i) => "m" + i) }, /at most 8/],
    [{ catalogItemId: "hat", gallery: [SIDE, SIDE] }, /already in the gallery/],
    [{ catalogItemId: "hat", gallery: "nope" }, /list of Media Library/],
    [{ catalogItemId: "hat", image: "https://elsewhere.test/a.png" }, /media id/],
    [{ catalogItemId: "hat", alt: "x" }, /accepts only/],
    [{ image: HAT }, /accepts only/],
    ["hat", /accepts only/],
  ]) {
    await assert.rejects(() => saveCatalogItemMedia(storage, input), pattern);
  }
  await assert.rejects(() => saveCatalogItemMedia(storage, { catalogItemId: "missing", image: HAT }), /not found/);
  assert.equal(storage.media.map.size, 0, "refused writes change nothing");
});

test("stored media that no longer parses is a storage fault, never a crash or silent image", async () => {
  const storage = mediaStorage();
  await storage.media.put("hat", { recordKind: "catalog-media", recordId: "hat", catalogItemId: "hat", image: { mediaId: "bad id" }, gallery: [] });
  await assert.rejects(() => loadCatalogItemMedia(storage.media, "hat"), (error) => error.code === "STORAGE_UNAVAILABLE");
  await storage.media.put("hat", { recordKind: "catalog-media", recordId: "other", catalogItemId: "hat", image: null, gallery: [] });
  await assert.rejects(() => loadCatalogItemMedia(storage.media, "hat"), (error) => error.code === "STORAGE_UNAVAILABLE");
  await storage.media.put("hat", { recordKind: "catalog-media", recordId: "hat", catalogItemId: "hat", image: null, gallery: [{ mediaId: SIDE }, { mediaId: SIDE }] });
  await assert.rejects(() => loadCatalogItemMedia(storage.media, "hat"), (error) => error.code === "STORAGE_UNAVAILABLE");
  await assert.rejects(() => loadCatalogItemMedia({ async get() { throw new Error("down"); } }, "hat"), (error) => error.code === "STORAGE_UNAVAILABLE");
});

test("placeholder setting stores one media id or none", async () => {
  const storage = collection();
  assert.deepEqual((await loadStorefrontPlaceholderImage(storage)).image, null);
  const set = await setStorefrontPlaceholderImage(storage, { image: HAT }, { now: () => new Date("2026-10-07T01:00:00.000Z") });
  assert.deepEqual(set.placeholder, {
    recordKind: "storefront-placeholder-image", recordId: "active", image: { mediaId: HAT }, updatedAt: "2026-10-07T01:00:00.000Z",
  });
  assert.equal((await setStorefrontPlaceholderImage(storage, { image: HAT })).changed, false);
  assert.equal((await setStorefrontPlaceholderImage(storage, { image: "" })).placeholder.image, null);
  assert.equal((await setStorefrontPlaceholderImage(storage, { image: null })).changed, false);
  for (const input of [{ image: "not an id!" }, { image: HAT, extra: 1 }, {}, null, "x"]) {
    await assert.rejects(() => setStorefrontPlaceholderImage(storage, input), (error) => error.code === "INVALID_INPUT");
  }
  await storage.put("active", { recordKind: "storefront-placeholder-image", recordId: "active", image: { mediaId: "bad id" }, updatedAt: "2026-10-07T01:00:00.000Z" });
  await assert.rejects(() => loadStorefrontPlaceholderImage(storage), (error) => error.code === "STORAGE_UNAVAILABLE");
});

function mediaAccess(items) {
  const calls = [];
  return {
    calls,
    async get(id) {
      calls.push(id);
      const found = items[id];
      if (found instanceof Error) throw found;
      return found ?? null;
    },
  };
}

const hatItem = { id: HAT, filename: "hat.png", mimeType: "image/png", size: 10, url: "/_emdash/api/media/asset/" + HAT + "/hat.png", createdAt: "", width: 800, height: 600, alt: "  Red hat, front  ", caption: "Front view" };

test("projection reads alt and dimensions live and applies the alt fallback chain", async () => {
  const media = mediaAccess({
    [HAT]: hatItem,
    [SIDE]: { ...hatItem, id: SIDE, alt: "", caption: " Side ", width: 500, height: 500 },
    [BACK]: { ...hatItem, id: BACK, alt: null, caption: null, width: null, height: undefined },
    video: { ...hatItem, id: "video", mimeType: "video/mp4" },
    pending: { ...hatItem, id: "pending", status: "pending" },
    wrong: { ...hatItem, id: "other" },
    down: new Error("bridge down"),
  });
  const projector = createProductImageProjector(media);
  assert.deepEqual(await projector.project({ mediaId: HAT }, "Red hat"), { id: HAT, alt: "Red hat, front", width: 800, height: 600, placeholder: false });
  assert.equal((await projector.project({ mediaId: SIDE }, "Red hat")).alt, "Side", "caption is the second fallback");
  assert.deepEqual(await projector.project({ mediaId: BACK }, "Red hat", true), { id: BACK, alt: "Red hat", width: null, height: null, placeholder: true });
  for (const id of ["video", "pending", "wrong", "down", "missing"]) {
    assert.equal(await projector.project({ mediaId: id }, "Red hat"), null, id);
  }
  await projector.project({ mediaId: HAT }, "Red hat");
  assert.equal(media.calls.filter((id) => id === HAT).length, 1, "one media read per item per request");
  assert.equal(await createProductImageProjector(undefined).project({ mediaId: HAT }, "Red hat"), null, "no media access yields no image");
});

test("storefront helpers build EmDash image-endpoint URLs for the Commerce presets", () => {
  const site = "https://shop.example.test";
  const src = "/_emdash/api/media/file/01KEY.png";
  const href = (width) => `/_image?href=${encodeURIComponent(site + src)}&w=${width}&f=webp`;
  assert.deepEqual(COMMERCE_IMAGE_PRESETS, { thumbnail: 300, single: 600, gallery_thumbnail: 100 });
  assert.equal(COMMERCE_IMAGE_SIZES, "(min-width: 600px) 600px, 100vw");
  assert.equal(commerceImageTransformUrl(src, COMMERCE_IMAGE_PRESETS.thumbnail, site), href(300));
  assert.equal(commerceImageTransformUrl(src, 100), `/_image?href=${encodeURIComponent(src)}&w=100&f=webp`, "relative href without a site URL");
  assert.equal(commerceImageTransformUrl("https://cdn.test/a.png", 300, site), `/_image?href=${encodeURIComponent("https://cdn.test/a.png")}&w=300&f=webp`);
  assert.equal(commerceImageSrcset(src, 800, site), `${href(300)} 300w, ${href(600)} 600w`, "capped at the original width");
  assert.equal(commerceImageSrcset(src, null, site), `${href(300)} 300w, ${href(600)} 600w, ${href(1200)} 1200w`, "unknown width keeps every candidate");
  assert.equal(commerceImageSrcset(src, 120, site), `${href(120)} 120w`, "a small original is its own candidate");
});

function publicContext({ media, mediaRecord = null, placeholder = null } = {}) {
  const empty = collection();
  return {
    site: { url: "https://shop.example.test" },
    media,
    storage: {
      catalog_items: collection([["hat", item]]),
      catalog_prices: collection([["hat", { recordKind: "catalog-price", recordId: "hat", catalogItemId: "hat", regular: { currency: "USD", minor: "400" } }]]),
      catalog_manual_availability: empty,
      catalog_backorder_policies: empty,
      store_inventory_configurations: empty,
      storefront_availability_settings: empty,
      storefront_out_of_stock_listing: empty,
      catalog_media: collection(mediaRecord ? [["hat", mediaRecord]] : []),
      storefront_placeholder_image: collection(placeholder ? [["active", placeholder]] : []),
    },
  };
}

test("public catalog carries image and gallery ids, falls back to the placeholder, and never exposes references it cannot resolve", async () => {
  const media = mediaAccess({ [HAT]: hatItem, [SIDE]: { ...hatItem, id: SIDE, alt: "Side" }, placeholder: { ...hatItem, id: "placeholder", alt: "", caption: null } });
  const record = { recordKind: "catalog-media", recordId: "hat", catalogItemId: "hat", image: { mediaId: HAT }, gallery: [{ mediaId: SIDE }, { mediaId: "gone" }] };
  const [product] = (await readPublicCatalog(publicContext({ media, mediaRecord: record }))).products;
  assert.deepEqual(Object.keys(product).sort(), ["availability", "gallery", "id", "image", "name", "price", "sku"]);
  assert.deepEqual(product.image, { id: HAT, alt: "Red hat, front", width: 800, height: 600, placeholder: false });
  assert.deepEqual(product.gallery, [{ id: SIDE, alt: "Side", width: 800, height: 600, placeholder: false }]);
  const placeholder = { recordKind: "storefront-placeholder-image", recordId: "active", image: { mediaId: "placeholder" }, updatedAt: "2026-10-07T00:00:00.000Z" };
  const [withPlaceholder] = (await readPublicCatalog(publicContext({ media, placeholder }))).products;
  assert.deepEqual([withPlaceholder.image.id, withPlaceholder.image.alt, withPlaceholder.image.placeholder, withPlaceholder.gallery], ["placeholder", "Red hat", true, []]);
  const [brokenImage] = (await readPublicCatalog(publicContext({ media, placeholder, mediaRecord: { ...record, image: { mediaId: "gone" } } }))).products;
  assert.equal(brokenImage.image.placeholder, true, "an unresolvable primary image falls back to the placeholder");
  const [bare] = (await readPublicCatalog(publicContext({ media }))).products;
  assert.deepEqual([bare.image, bare.gallery], [null, []]);
  const [noAccess] = (await readPublicCatalog(publicContext({ media: undefined, mediaRecord: record, placeholder }))).products;
  assert.deepEqual([noAccess.image, noAccess.gallery], [null, []], "without media:read nothing is invented");
});

test("native plugin declares media:read, the media collections, and the save-media and placeholder routes", async () => {
  const plugin = createPlugin();
  assert.deepEqual(plugin.capabilities, ["media:read"]);
  assert.ok(plugin.storage.catalogMedia && plugin.storage.storefrontPlaceholderImage);
  const catalogItems = collection([["hat", item]]);
  const catalogMedia = collection();
  const storefrontPlaceholderImage = collection();
  const ctx = (method, input) => ({ request: new Request("https://shop.example.test/x", { method }), input, storage: { catalogItems, catalogMedia, storefrontPlaceholderImage } });
  const save = plugin.routes[SAVE_CATALOG_ITEM_MEDIA_ROUTE];
  assert.equal(save.permission, "content:edit_any");
  const saved = await save.handler(ctx("POST", { catalogItemId: "hat", image: HAT, gallery: [SIDE] }));
  assert.deepEqual(saved.media.gallery, [{ mediaId: SIDE }]);
  await assert.rejects(() => save.handler(ctx("GET", {})), /POST/);
  await assert.rejects(() => save.handler(ctx("POST", { catalogItemId: "hat", image: "no id" })), (error) => error.code === "INVALID_INPUT" && error.status === 400);
  const placeholder = plugin.routes[PLACEHOLDER_IMAGE_ROUTE];
  assert.equal(placeholder.permission, "content:edit_any");
  assert.equal((await placeholder.handler(ctx("GET", undefined))).image, null);
  assert.deepEqual((await placeholder.handler(ctx("POST", { image: HAT }))).placeholder.image, { mediaId: HAT });
  await assert.rejects(() => placeholder.handler(ctx("POST", { image: "no id" })), (error) => error.status === 400);
  await assert.rejects(() => placeholder.handler(ctx("PUT", {})), /GET or POST/);
});
