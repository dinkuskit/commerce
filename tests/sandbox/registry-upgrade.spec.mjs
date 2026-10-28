import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureProductsCollection, openPanel, setOnSale } from "./product-page.mjs";

// Run by scripts/registry-upgrade-proof.mjs. The "old" phase runs an earlier
// release's Registry build and stocks the store through that release's own
// admin; the "new" phase restarts on this build against the same database.
const phase = process.env.COMMERCE_UPGRADE_PHASE;
const headers = { "X-EmDash-Request": "1" };
const endpoint = "/_emdash/api/plugins/dinkus-commerce/admin";
const onSaleRoute = "/_emdash/api/plugins/dinkus-commerce/catalog-items/set-on-sale";
const snapshotFile = () => resolve(process.env.COMMERCE_PROOF_ARTIFACTS, "before-upgrade.json");
const capture = (page, name) => page.screenshot({ path: resolve(process.env.COMMERCE_PROOF_ARTIFACTS, phase + "-" + name + ".png"), animations: "disabled", fullPage: true });

function storage() {
  const database = new Database(process.env.COMMERCE_PROOF_DB.slice(5));
  const rows = (collection) => Object.fromEntries(database.prepare("SELECT id, data FROM _plugin_storage WHERE plugin_id = ? AND collection = ? ORDER BY id")
    .all("dinkus-commerce", collection).map((row) => [row.id, JSON.parse(row.data)]));
  return { database, rows };
}
const COLLECTIONS = ["catalog_items", "catalog_prices", "catalog_manual_availability", "storefront_out_of_stock_listing", "managed_sku_claims"];
const items = (rows) => Object.values(rows).filter((row) => row.recordKind === "catalog-item");
const publicCatalog = async (request) => {
  const body = await (await request.get("/_emdash/api/plugins/dinkus-commerce/catalog/public")).json();
  expect(body.data.cursor).toBeUndefined();
  return body.data.products;
};

async function signIn(page, request) {
  expect((await request.get("/_emdash/api/setup/dev-bypass")).status()).toBe(200);
  await page.goto("/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/plugins/dinkus-commerce/settings");
  const start = page.getByRole("button", { name: "Get Started" });
  await start.or(page.getByRole("heading", { name: "Commerce settings" })).first().waitFor({ state: "visible", timeout: 90000 });
  if (await start.isVisible()) await start.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("the earlier release stocks a Registry store", async ({ page, request }) => {
  test.skip(phase !== "old");
  await signIn(page, request);
  const { database, rows } = storage();
  await expect.poll(() => database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get("uidx_plugin_dinkus-commerce_catalog_items_skuKey"), { timeout: 90000 }).toBeTruthy();
  const admin = async (input) => {
    const response = await page.request.post(endpoint, { data: input, headers });
    const body = await response.json();
    expect(response.ok() && body.success, JSON.stringify(body)).toBe(true);
    if (body.data.toast) expect(body.data.toast.type, input.action_id + " " + JSON.stringify(body.data.toast)).toBe("success");
    return body.data;
  };
  const submit = (blocks, label) => blocks.find((block) => block.type === "form" && block.submit?.label === label)?.submit.action_id;
  // The earlier release's Products page: Add product, then the product's Save and Save weight forms.
  const make = async (name, sku, prices) => {
    const made = await admin({ type: "form_submit", action_id: "create:" + crypto.randomUUID(), values: { name, sku, fulfillment: "physical" } });
    const id = items(rows("catalog_items")).find((row) => row.sku === sku).itemId;
    const saved = await admin({ type: "form_submit", action_id: submit(made.blocks, "Save"), values: prices });
    return { id, blocks: saved.blocks };
  };
  const hat = await make("Red hat", "RED-HAT", { regular: "12", sale: "10", stockStatus: "in-stock" });
  await admin({ type: "form_submit", action_id: submit(hat.blocks, "Save weight"), values: { ["w:" + hat.id]: "6" } });
  const scarf = await make("Blue scarf", "BLUE-SCARF", { regular: "18", sale: "", stockStatus: "out-of-stock" });
  const cap = await make("Old cap", "OLD-CAP", { regular: "9", sale: "", stockStatus: "in-stock" });
  // As the owner does it: open the product, then Archive product.
  await admin({ type: "block_action", action_id: "open", value: cap.id });
  await admin({ type: "block_action", action_id: "archive", value: { id: cap.id, a: true } });
  // Commerce settings: hide out-of-stock products.
  // 0.5.0 saves the toggle first, then redraws the page with its DinkusKit Connect status; that redraw can fail
  // offline, so the proof checks the stored setting rather than the toast.
  const settingsSaved = await page.request.post(endpoint, { data: { type: "form_submit", action_id: "settings.save", values: { hideOutOfStock: true } }, headers });
  expect(settingsSaved.ok()).toBe(true);
  expect(rows("storefront_out_of_stock_listing").active.hideOutOfStock).toBe(true);
  // The template's product page names its product in commerce_item_id, as pages did before the panel.
  await ensureProductsCollection(page.request);
  const created = await page.request.post("/_emdash/api/content/products", { headers, data: { data: { title: "Red hat", commerce_item_id: hat.id } } });
  expect(created.ok()).toBe(true);
  const createdData = (await created.json()).data;
  const pageId = (createdData.item ?? createdData).id;
  const shop = await publicCatalog(page.request);
  expect(shop.map((item) => item.name)).toEqual(["Red hat"]);
  await page.goto("/_emdash/admin/plugins/dinkus-commerce/products");
  await expect(page.getByText("Red hat").first()).toBeVisible({ timeout: 60000 });
  await capture(page, "products");
  const snapshot = { from: process.env.COMMERCE_UPGRADE_FROM, ids: { hat: hat.id, scarf: scarf.id, cap: cap.id }, pageId, shop,
    storage: Object.fromEntries(COLLECTIONS.map((name) => [name, rows(name)])), settingsRows: rows("storefront_availability_settings") };
  expect(Object.keys(snapshot.storage.catalog_prices)).toHaveLength(3);
  expect(items(snapshot.storage.catalog_items).find((row) => row.itemId === cap.id).archivedAt).toBeTruthy();
  writeFileSync(snapshotFile(), JSON.stringify(snapshot, null, 2));
  database.close();
});

test("this build keeps the upgraded store's products, settings, page and sellability", async ({ page, request }) => {
  test.skip(phase !== "new");
  const before = JSON.parse(readFileSync(snapshotFile(), "utf8"));
  const { hat, scarf, cap } = before.ids;
  await signIn(page, request);
  const { database, rows } = storage();
  // 1. Nothing stored by the earlier release is rewritten by the upgrade.
  for (const name of COLLECTIONS) expect(rows(name), name).toEqual(before.storage[name]);
  expect(rows("storefront_availability_settings")).toEqual(before.settingsRows);
  for (const row of items(rows("catalog_items"))) {
    expect(row).not.toHaveProperty("offSale");
    expect(row).not.toHaveProperty("pageId");
  }
  expect(rows("product_pages")).toEqual({});
  // 2. Products sold before the upgrade stay on sale with the same prices; hidden and archived ones stay off.
  expect(await publicCatalog(page.request)).toEqual(before.shop);

  // 3. Commerce settings keeps the saved setting and lists the products no page sells.
  await page.goto("/_emdash/admin/plugins/dinkus-commerce/settings");
  await expect(page.getByRole("switch", { name: "Hide out-of-stock products", exact: true })).toBeChecked({ timeout: 30000 });
  await expect(page.getByRole("heading", { name: "Products without a page" })).toBeVisible();
  await expect(page.getByText("Blue scarf").first()).toBeVisible();
  await expect(page.getByText(/Old cap.*\(archived\)/).first()).toBeVisible();
  await capture(page, "settings");

  // 4. The page made before the panel opens it; linking by SKU shows the product as it was.
  await page.goto("/_emdash/admin/content/products/" + before.pageId);
  const panel = await openPanel(page);
  await panel.getByRole("textbox", { name: "Or its SKU", exact: true }).fill("RED-HAT");
  await panel.getByRole("button", { name: "Sell it here", exact: true }).click();
  await expect(panel.getByRole("textbox", { name: "Regular", exact: true })).toHaveValue("12.00");
  await expect(panel.getByRole("textbox", { name: "Sale", exact: true })).toHaveValue("10.00");
  await expect(panel.getByRole("radio", { name: "In stock", exact: true })).toBeChecked();
  await expect(panel.getByText(/^On sale · SKU RED-HAT/)).toBeVisible();
  expect(rows("catalog_items")[hat]).not.toHaveProperty("offSale");
  // Edited in the panel, the new price reaches the shop.
  const priceForm = panel.locator("form").filter({ has: page.getByRole("textbox", { name: "Regular", exact: true }) });
  await priceForm.getByRole("textbox", { name: "Regular", exact: true }).fill("13");
  await priceForm.getByRole("button", { name: /^Save/ }).click();
  await expect(priceForm.getByRole("textbox", { name: "Regular", exact: true })).toHaveValue("13.00");
  await capture(page, "panel");
  await expect.poll(() => rows("catalog_items")[hat].catalogData.items[hat].price.regular).toEqual({ currency: "USD", minor: "1300" });

  // 5. The page's next publish check claims its product; another page is refused; unpublishing takes it off the shop.
  // Already on sale from before the upgrade, so nothing changes for shoppers; the page is recorded as its seller.
  expect(await setOnSale(page.request, { catalogItemId: hat, entryId: before.pageId, onSale: true })).toEqual({ changed: false });
  expect(rows("catalog_items")[hat].pageId).toBe(before.pageId);
  const competing = await page.request.post(onSaleRoute, { data: { catalogItemId: hat, entryId: "01COMPETINGPAGE000000000000", onSale: false }, headers });
  expect(competing.status()).toBe(400);
  expect(JSON.stringify(await competing.json())).toContain("Another page sells this product");
  expect((await publicCatalog(page.request)).map((item) => item.name)).toEqual(["Red hat"]);
  expect(await setOnSale(page.request, { catalogItemId: hat, entryId: before.pageId, onSale: false })).toEqual({ changed: true });
  expect(rows("catalog_items")[hat].offSale).toBe(true);
  expect(await publicCatalog(page.request)).toEqual([]);

  // 6. Products no page sells were left exactly as they were.
  for (const id of [scarf, cap]) expect(rows("catalog_items")[id]).toEqual(before.storage.catalog_items[id]);
  database.close();
});
