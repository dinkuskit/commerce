import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BLOCK_FORM, ok, openPanel, openProductPage, setOnSale } from "./product-page.mjs";

// Run by scripts/registry-upgrade-proof.mjs with COMMERCE_UPGRADE_FROM=v0.8.0 and
// COMMERCE_UPGRADE_SPEC=registry-upgrade-permanent-delete.spec.mjs. The "old" phase runs Commerce 0.8.0's Registry
// build: two product pages sell two priced products, a setting is saved, and an order buys the first product. The
// "new" phase restarts on this build against the same database and deletes the first page for good: its product
// and the product's own rows go, freeing its SKU (catalog-permanent-delete-20261122), while the other product, the
// order and the settings stay exactly as 0.8.0 stored them.
const phase = process.env.COMMERCE_UPGRADE_PHASE;
const headers = { "X-EmDash-Request": "1" };
const endpoint = "/_emdash/api/plugins/dinkus-commerce/admin";
const snapshotFile = () => resolve(process.env.COMMERCE_PROOF_ARTIFACTS, "before-upgrade-permanent-delete.json");
const capture = (page, name) => page.screenshot({ path: resolve(process.env.COMMERCE_PROOF_ARTIFACTS, phase + "-" + name + ".png"), animations: "disabled", fullPage: true });
test.use({ viewport: { width: 1440, height: 2200 } });

function storage() {
  const database = new Database(process.env.COMMERCE_PROOF_DB.slice(5));
  const rows = (collection) => Object.fromEntries(database.prepare("SELECT id, data FROM _plugin_storage WHERE plugin_id = ? AND collection = ? ORDER BY id")
    .all("dinkus-commerce", collection).map((row) => [row.id, JSON.parse(row.data)]));
  const raw = (collections) => database.prepare("SELECT * FROM _plugin_storage WHERE plugin_id = ? AND collection IN (" + collections.map(() => "?").join(",") + ") ORDER BY collection, id")
    .all("dinkus-commerce", ...collections);
  return { database, rows, raw };
}
// Everything that holds one product's facts, and what else the store keeps.
const PRODUCT_ROWS = ["catalog_prices", "catalog_manual_availability", "catalog_backorder_policies", "catalog_media", "product_feed_eligibility"];
const COLLECTIONS = ["catalog_items", ...PRODUCT_ROWS, "storefront_out_of_stock_listing", "storefront_availability_settings", "managed_sku_claims", "product_pages"];
const KEPT = ["orders", "order_numbers", "storefront_out_of_stock_listing", "storefront_availability_settings", "managed_sku_claims"];
const items = (rows) => Object.values(rows).filter((row) => row.recordKind === "catalog-item");
const publicCatalog = async (request) => (await (await request.get("/_emdash/api/plugins/dinkus-commerce/catalog/public")).json()).data.products;
const content = (id, suffix = "") => "/_emdash/api/content/products/" + id + suffix;
// An order that bought the cap before the upgrade: Orders' own record, as a paid checkout stores it.
const ORDER_ID = "order:permanent-delete-proof";
const orderRecord = (catalogItemId) => ({ number: 1001, emailKey: "", paidOrder: { schema: "dinkuskit.commerce.paid-order/v1", orderId: ORDER_ID,
  receiptId: "receipt:permanent-delete-proof", attemptId: "attempt:permanent-delete-proof", mode: "test", paidAt: "2026-10-02T12:00:00.000Z",
  lines: [{ catalogItemId, name: "Delete cap", quantity: 1, unitPrice: { currency: "USD", minor: "1200" } }], total: { currency: "USD", minor: "1200" } } });

const legacyRows = (id, regular) => Object.fromEntries(Object.entries({
  catalog_prices: { recordKind: "catalog-price", regular: { currency: "USD", minor: regular } },
  catalog_manual_availability: { recordKind: "catalog-manual-availability", status: "in-stock" },
  catalog_backorder_policies: { recordKind: "catalog-backorder-policy", allowBackorders: false },
  catalog_media: { recordKind: "catalog-media", image: null, gallery: [] },
  product_feed_eligibility: { recordKind: "product-feed-eligibility", channels: [] },
}).map(([name, record]) => [name, { ...record, recordId: id, catalogItemId: id }]));

async function signIn(page, request) {
  expect((await request.get("/_emdash/api/setup/dev-bypass")).status()).toBe(200);
  await page.goto("/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/plugins/dinkus-commerce/settings");
  const start = page.getByRole("button", { name: "Get Started" });
  await start.or(page.getByRole("heading", { name: "Commerce settings" })).first().waitFor({ state: "visible", timeout: 90000 });
  if (await start.isVisible()) await start.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

// As 0.8.0's owner does it: a product page, the panel's first Save makes its product, then prices, then Publish.
async function sellPage(page, rows, title, sku, regular, sale) {
  const { id: pageId, panel } = await openProductPage(page, title);
  await panel.getByRole("textbox", { name: "SKU", exact: true }).fill(sku);
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(panel.getByText("Draft: publish to sell it", { exact: true })).toBeVisible({ timeout: 30000 });
  const form = panel.locator(BLOCK_FORM).filter({ has: page.getByRole("textbox", { name: "Regular", exact: true }) });
  await form.getByRole("textbox", { name: "Regular", exact: true }).fill(regular);
  await form.getByRole("textbox", { name: "Sale", exact: true }).fill(sale);
  await form.getByRole("button", { name: /^Save/ }).click();
  await expect(panel.getByRole("textbox", { name: "Regular", exact: true })).toHaveValue(Number(regular).toFixed(2), { timeout: 30000 });
  const id = items(rows("catalog_items")).find((row) => row.sku === sku).itemId;
  await ok(await page.request.post(content(pageId, "/publish"), { headers }));
  expect(await setOnSale(page.request, { entryId: pageId, onSale: true })).toEqual({ changed: true });
  return { id, pageId };
}

test("Commerce 0.8.0 sells two products from their pages and records an order", async ({ page, request }) => {
  test.skip(phase !== "old");
  await signIn(page, request);
  const { database, rows, raw } = storage();
  await expect.poll(() => database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get("uidx_plugin_dinkus-commerce_catalog_items_skuKey"), { timeout: 90000 }).toBeTruthy();
  const cap = await sellPage(page, rows, "Delete cap", "DELETE-CAP", "15", "12");
  const scarf = await sellPage(page, rows, "Kept scarf", "KEPT-SCARF", "18", "");
  await capture(page, "kept-scarf-on-sale");
  const settingsSaved = await page.request.post(endpoint, { data: { type: "form_submit", action_id: "settings.save", values: { hideOutOfStock: true } }, headers });
  expect(settingsSaved.ok()).toBe(true);
  expect(rows("storefront_out_of_stock_listing").active.hideOutOfStock).toBe(true);
  const columns = database.prepare("PRAGMA table_info(_plugin_storage)").all().map((column) => column.name);
  const now = new Date().toISOString();
  const insert = (collection, id, record) => {
    const row = { plugin_id: "dinkus-commerce", collection, id, data: JSON.stringify(record), created_at: now, updated_at: now,
      ...(columns.includes("revision") ? { revision: crypto.randomUUID() } : {}) };
    const keys = Object.keys(row).filter((key) => columns.includes(key));
    database.prepare("INSERT INTO _plugin_storage (" + keys.join(",") + ") VALUES (" + keys.map(() => "?").join(",") + ")").run(...keys.map((key) => row[key]));
  };
  insert("orders", ORDER_ID, orderRecord(cap.id));
  // 0.8.0 keeps prices and stock on the product itself. A store that came to it through 0.7.0 or earlier still has
  // each product's older rows in their own collections, as registry-upgrade.spec.mjs shows those releases writing them.
  for (const [{ id }, regular] of [[cap, "1500"], [scarf, "1800"]]) for (const [name, record] of Object.entries(legacyRows(id, regular))) insert(name, id, record);
  const shop = await publicCatalog(page.request);
  expect(shop.map((item) => item.id).sort()).toEqual([cap.id, scarf.id].sort());
  const snapshot = { from: process.env.COMMERCE_UPGRADE_FROM, cap, scarf, shop,
    storage: Object.fromEntries(COLLECTIONS.map((name) => [name, rows(name)])), kept: raw(KEPT) };
  expect(snapshot.kept.filter((stored) => stored.collection === "orders")).toHaveLength(1);
  for (const name of PRODUCT_ROWS) expect(Object.keys(snapshot.storage[name]).sort(), name).toEqual([cap.id, scarf.id].sort());
  writeFileSync(snapshotFile(), JSON.stringify(snapshot, null, 2));
  database.close();
});

test("this build deletes an upgraded store's product for good and keeps the rest exactly as 0.8.0 stored it", async ({ page, request }) => {
  test.skip(phase !== "new");
  const before = JSON.parse(readFileSync(snapshotFile(), "utf8"));
  const { cap, scarf } = before;
  await signIn(page, request);
  const { database, rows, raw } = storage();
  // 1. The upgrade rewrites nothing 0.8.0 stored.
  for (const name of COLLECTIONS) expect(rows(name), name).toEqual(before.storage[name]);
  expect(raw(KEPT)).toEqual(before.kept);
  const own = (itemId) => PRODUCT_ROWS.flatMap((name) => itemId in rows(name) ? [name] : []);
  const capRows = own(cap.id);
  expect(capRows).toEqual(PRODUCT_ROWS);

  // 2. Move to trash, then Delete permanently, each followed by the store's publish check.
  await ok(await page.request.delete(content(cap.pageId), { headers }));
  expect(await setOnSale(page.request, { entryId: cap.pageId, onSale: false })).toEqual({ changed: true });
  await ok(await page.request.delete(content(cap.pageId, "/permanent"), { headers }));
  expect(await setOnSale(page.request, { entryId: cap.pageId, onSale: false, deleted: true })).toEqual({ changed: false });

  // 3. The cap, its older rows and its page's links are gone.
  expect(rows("catalog_items")[cap.id]).toBeUndefined();
  expect(own(cap.id)).toEqual([]);
  expect(Object.values(rows("product_pages")).some((link) => link.entryId === cap.pageId)).toBe(false);

  // 4. Everything else is exactly as 0.8.0 stored it: the scarf, its rows and page link, the order, the settings.
  expect(rows("catalog_items")[scarf.id]).toEqual(before.storage.catalog_items[scarf.id]);
  for (const name of PRODUCT_ROWS) expect(rows(name)[scarf.id], name).toEqual(before.storage[name][scarf.id]);
  const scarfLinks = (stored) => Object.entries(stored).filter(([, link]) => link.entryId === scarf.pageId);
  expect(scarfLinks(rows("product_pages"))).toEqual(scarfLinks(before.storage.product_pages));
  expect(raw(KEPT)).toEqual(before.kept);
  expect((await publicCatalog(page.request)).map((item) => item.id)).toEqual([scarf.id]);
  writeFileSync(resolve(process.env.COMMERCE_PROOF_ARTIFACTS, "permanent-delete-after-upgrade.json"), JSON.stringify({ from: before.from,
    cap: { rowsBefore: capRows, itemAfter: rows("catalog_items")[cap.id] ?? null, rowsAfter: own(cap.id) },
    scarfUnchanged: true, keptRowsUnchanged: KEPT, shopAfter: (await publicCatalog(page.request)).map((item) => item.name) }, null, 2));

  // 5. The order still shows the cap it sold.
  await page.goto("/_emdash/admin/plugins/dinkus-commerce/orders");
  await page.getByRole("button", { name: "Inspect #1001 (TEST)", exact: true }).click({ timeout: 60000 });
  await expect(page.getByText("Delete cap", { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await capture(page, "order-after-permanent-delete");

  // 6. The scarf's page still sells it, and the cap's SKU is free for a new page's product.
  await page.goto("/_emdash/admin/content/products/" + scarf.pageId);
  await expect((await openPanel(page)).getByText("On sale", { exact: true })).toBeVisible();
  await capture(page, "kept-scarf-after-permanent-delete");
  const { panel } = await openProductPage(page, "Delete cap again");
  await panel.getByRole("textbox", { name: "SKU", exact: true }).fill("DELETE-CAP");
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(panel.getByText(/^Draft/).first()).toBeVisible({ timeout: 30000 });
  expect(items(rows("catalog_items")).filter((row) => row.sku === "DELETE-CAP")).toHaveLength(1);
  database.close();
});
