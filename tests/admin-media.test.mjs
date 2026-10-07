import assert from "node:assert/strict";
import test from "node:test";

import { commerceAdmin } from "../dist/admin/index.js";

// Block Kit 1.2.0 renders no media_picker on plugin admin pages, so the sandbox
// admin lists the Media Library itself through media:read. This exercises that
// chooser against the real handler with in-memory storage and a fake media access.
const HAT = "01HAT000000000000000000000";
const SIDE = "01SIDE00000000000000000000";
const BACK = "01BACK00000000000000000000";

function collection(records = []) {
  const map = new Map(records.map(([id, value]) => [id, structuredClone(value)]));
  return {
    map,
    async get(id) { return map.has(id) ? structuredClone(map.get(id)) : null; },
    async getVersioned(id) { return map.has(id) ? { value: structuredClone(map.get(id)), revision: "r" } : null; },
    async put(id, value) { map.set(id, structuredClone(value)); },
    async delete(id) { map.delete(id); },
    async compareAndSet(id, _revision, value) { map.set(id, structuredClone(value)); return { applied: true }; },
    async query() { return { items: [...map].map(([id, data]) => ({ id, data: structuredClone(data) })), hasMore: false }; },
  };
}

const item = {
  recordKind: "catalog-item", itemId: "hat", commandId: "c", creationIntent: { manageStock: false },
  kind: "simple-product", name: "Red hat", sku: "RED-HAT", skuKey: "RED-HAT",
  stockManagement: { mode: "unmanaged" }, state: "draft", createdAt: "2026-10-07T00:00:00.000Z",
};
const library = {
  [HAT]: { id: HAT, filename: "hat.png", mimeType: "image/png", url: "/_emdash/api/media/asset/" + HAT + "/hat.png", alt: "Red hat, front", width: 640, height: 480 },
  [SIDE]: { id: SIDE, filename: "side.png", mimeType: "image/png", url: "/_emdash/api/media/asset/" + SIDE + "/side.png", alt: "", width: 640, height: 480 },
  [BACK]: { id: BACK, filename: "back.png", mimeType: "image/png", url: "/_emdash/api/media/asset/" + BACK + "/back.png", alt: "Back", width: 640, height: 480 },
};

function context({ media = true, pageSize = 12 } = {}) {
  const storage = {
    catalog_items: collection([["hat", item]]),
    catalog_prices: collection([["hat", { recordKind: "catalog-price", recordId: "hat", catalogItemId: "hat", regular: { currency: "USD", minor: "400" } }]]),
    catalog_manual_availability: collection(),
    managed_sku_claims: collection(),
    catalog_media: collection(),
    storefront_out_of_stock_listing: collection(),
    storefront_placeholder_image: collection(),
  };
  const listCalls = [];
  const ctx = {
    plugin: { id: "dinkus-commerce" },
    storage,
    ...(media ? { media: {
      async get(id) { return library[id] ?? null; },
      async list(options) {
        listCalls.push(options);
        const items = Object.values(library);
        const start = options.cursor ? Number(options.cursor) : 0;
        const page = items.slice(start, start + Math.min(options.limit, pageSize));
        const next = start + page.length;
        return { items: page, hasMore: next < items.length, cursor: next < items.length ? String(next) : undefined };
      },
    } } : {}),
  };
  return { ctx, storage, listCalls };
}

const route = (input) => ({ input, user: { role: 50 }, ui: { surface: "admin-page", locale: "en", direction: "ltr" } });
const labels = (response) => response.blocks.flatMap((block) => block.type === "actions" ? block.elements.filter((element) => element.type === "button").map((element) => element.label) : []);
const texts = (response) => response.blocks.map((block) => block.text ?? block.title ?? block.url ?? "").filter(Boolean);
const button = (response, label) => response.blocks.flatMap((block) => block.type === "actions" ? block.elements : []).find((element) => element.label === label);
const act = (ctx, element) => commerceAdmin(route({ type: "block_action", action_id: element.action_id, value: element.value }), ctx);

test("a clerk chooses, reorders and removes product images from the Media Library page", async () => {
  const { ctx, storage, listCalls } = context();
  let page = await commerceAdmin(route({ type: "block_action", action_id: "open", value: "hat" }), ctx);
  assert.ok(texts(page).includes("Images") && texts(page).includes("No image") && texts(page).includes("Gallery (0 of 8)"));
  assert.deepEqual(labels(page).filter((label) => /image|gallery/i.test(label)), ["Choose image", "Add to gallery"]);

  const chooser = await act(ctx, button(page, "Choose image"));
  assert.equal(chooser.blocks[0].text, "Choose an image");
  assert.deepEqual(listCalls.at(-1), { limit: 12, mimeType: "image/" });
  assert.deepEqual(labels(chooser), ["Cancel", "Use hat.png", "Use side.png", "Use back.png"]);
  assert.ok(chooser.blocks.some((block) => block.type === "image" && block.url === library[HAT].url && block.alt === "Red hat, front"));
  page = await act(ctx, button(chooser, "Use hat.png"));
  assert.equal(page.toast.message, "Image saved");
  assert.deepEqual(storage.catalog_media.map.get("hat").image, { mediaId: HAT });
  assert.ok(page.blocks.some((block) => block.type === "image" && block.url === library[HAT].url));
  assert.deepEqual(labels(page).filter((label) => /image|gallery/i.test(label)), ["Change image", "Remove image", "Add to gallery"]);

  const before = JSON.stringify(storage.catalog_media.map.get("hat"));
  const back = await act(ctx, button(await act(ctx, button(page, "Change image")), "Cancel"));
  assert.equal(back.blocks[0].text, "Red hat", "Cancel returns to the product");
  assert.equal(JSON.stringify(storage.catalog_media.map.get("hat")), before, "Cancel writes nothing");

  for (const name of ["side.png", "back.png"]) {
    const add = await act(ctx, button(page, "Add to gallery"));
    assert.equal(add.blocks[0].text, "Add to gallery");
    page = await act(ctx, button(add, "Use " + name));
    assert.equal(page.toast.message, "Added to gallery");
  }
  assert.deepEqual(storage.catalog_media.map.get("hat").gallery, [{ mediaId: SIDE }, { mediaId: BACK }]);
  assert.ok(texts(page).includes("Gallery (2 of 8)"));
  const duplicate = await act(ctx, button(await act(ctx, button(page, "Add to gallery")), "Use side.png"));
  assert.equal(duplicate.toast.type, "error");
  assert.match(duplicate.toast.message, /already in the gallery/);
  assert.equal(duplicate.blocks[0].type, "banner");
  assert.equal(duplicate.blocks[1].text, "Red hat", "a refused choice returns the clerk to the product");
  assert.deepEqual(storage.catalog_media.map.get("hat").gallery, [{ mediaId: SIDE }, { mediaId: BACK }], "a refused choice changes nothing");

  page = await act(ctx, button(page, "Move image 2 up"));
  assert.deepEqual(storage.catalog_media.map.get("hat").gallery, [{ mediaId: BACK }, { mediaId: SIDE }]);
  page = await act(ctx, button(page, "Remove image 1"));
  assert.deepEqual(storage.catalog_media.map.get("hat").gallery, [{ mediaId: SIDE }]);
  page = await act(ctx, button(page, "Remove image"));
  assert.equal(page.toast.message, "Image removed");
  assert.deepEqual(storage.catalog_media.map.get("hat"), { recordKind: "catalog-media", recordId: "hat", catalogItemId: "hat", image: null, gallery: [{ mediaId: SIDE }] });
  assert.deepEqual(storage.catalog_prices.map.get("hat").regular, { currency: "USD", minor: "400" }, "prices stay untouched");

  const forged = await commerceAdmin(route({ type: "block_action", action_id: "media.up", value: { id: "hat", index: 7, m: SIDE } }), ctx);
  assert.equal(forged.toast.type, "error");
  const stale = await commerceAdmin(route({ type: "block_action", action_id: "media.remove", value: { id: "hat", index: 0, m: BACK } }), ctx);
  assert.match(stale.toast.message, /gallery changed/);
  assert.equal(stale.blocks[1].text, "Red hat", "a stale page returns to the product");
  assert.deepEqual(storage.catalog_media.map.get("hat").gallery, [{ mediaId: SIDE }], "a stale page never removes a different image");
});

test("the library page paginates and the placeholder uses the same chooser", async () => {
  const { ctx, storage } = context({ pageSize: 2 });
  let settings = await commerceAdmin(route({ type: "page_load", page: "/settings" }), ctx);
  assert.ok(texts(settings).includes("Placeholder image") && texts(settings).includes("No image"));
  const chooser = await act(ctx, button(settings, "Choose placeholder"));
  assert.equal(chooser.blocks[0].text, "Choose a placeholder image");
  assert.deepEqual(labels(chooser), ["Cancel", "Use hat.png", "Use side.png", "Next"]);
  const next = await act(ctx, button(chooser, "Next"));
  assert.deepEqual(labels(next), ["Cancel", "Use back.png"]);
  settings = await act(ctx, button(next, "Use back.png"));
  assert.equal(settings.toast.message, "Placeholder saved");
  assert.deepEqual(storage.storefront_placeholder_image.map.get("active").image, { mediaId: BACK });
  assert.deepEqual(labels(settings).filter((label) => /placeholder/i.test(label)), ["Change placeholder", "Remove placeholder"]);
  const cancelled = await act(ctx, button(chooser, "Cancel"));
  assert.equal(cancelled.blocks[0].text, "Commerce settings");
  const refused = await commerceAdmin(route({ type: "block_action", action_id: "media.use", value: { t: "placeholder", id: "", m: "not an id!" } }), ctx);
  assert.equal(refused.toast.type, "error");
  assert.equal(refused.blocks[1].text, "Commerce settings", "a refused placeholder choice returns to Settings");
  assert.deepEqual(storage.storefront_placeholder_image.map.get("active").image, { mediaId: BACK });
  settings = await act(ctx, button(settings, "Remove placeholder"));
  assert.equal(settings.toast.message, "Placeholder removed");
  assert.equal(storage.storefront_placeholder_image.map.get("active").image, null);
});

test("without media access the chooser refuses and previews degrade honestly", async () => {
  const { ctx } = context({ media: false });
  const page = await commerceAdmin(route({ type: "block_action", action_id: "open", value: "hat" }), ctx);
  const refused = await act(ctx, button(page, "Choose image"));
  assert.equal(refused.toast.type, "error");
});
