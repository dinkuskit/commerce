import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BLOCK_FORM, ok, openPanel, openProductPage, setOnSale } from "./product-page.mjs";

// Run by scripts/registry-upgrade-proof.mjs with COMMERCE_UPGRADE_FROM=v0.8.0 and
// COMMERCE_UPGRADE_SPEC=registry-upgrade-linked-archive.spec.mjs. The "old" phase runs Commerce 0.8.0's Registry
// build: a product page sells a priced product, then 0.8.0's own Archive product button archives it while its page
// stays published. The "new" phase restarts on this build against the same database. This build keeps no archive
// mark of its own (commerce-archive-state-removed-20261118), so, as Ronald accepted, that product is on sale again
// after the update, with the same id, SKU, prices and page; moving its page to the trash archives it again.
const phase = process.env.COMMERCE_UPGRADE_PHASE;
const headers = { "X-EmDash-Request": "1" };
const endpoint = "/_emdash/api/plugins/dinkus-commerce/admin";
const snapshotFile = () => resolve(process.env.COMMERCE_PROOF_ARTIFACTS, "before-upgrade-linked.json");
const capture = (page, name) => page.screenshot({ path: resolve(process.env.COMMERCE_PROOF_ARTIFACTS, phase + "-" + name + ".png"), animations: "disabled", fullPage: true });
const TITLE = "Linked cap";
// Tall enough that the editor's settings sidebar shows the whole Dinkus Commerce panel in each capture.
test.use({ viewport: { width: 1440, height: 2200 } });

function storage() {
  const database = new Database(process.env.COMMERCE_PROOF_DB.slice(5));
  const rows = (collection) => Object.fromEntries(database.prepare("SELECT id, data FROM _plugin_storage WHERE plugin_id = ? AND collection = ? ORDER BY id")
    .all("dinkus-commerce", collection).map((row) => [row.id, JSON.parse(row.data)]));
  return { database, rows };
}
const COLLECTIONS = ["catalog_items", "catalog_prices", "catalog_manual_availability", "storefront_out_of_stock_listing", "managed_sku_claims", "product_pages"];
const items = (rows) => Object.values(rows).filter((row) => row.recordKind === "catalog-item");
const publicCatalog = async (request) => (await (await request.get("/_emdash/api/plugins/dinkus-commerce/catalog/public")).json()).data.products;
const content = (id, suffix = "") => "/_emdash/api/content/products/" + id + suffix;

async function signIn(page, request) {
  expect((await request.get("/_emdash/api/setup/dev-bypass")).status()).toBe(200);
  await page.goto("/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/plugins/dinkus-commerce/settings");
  const start = page.getByRole("button", { name: "Get Started" });
  await start.or(page.getByRole("heading", { name: "Commerce settings" })).first().waitFor({ state: "visible", timeout: 90000 });
  if (await start.isVisible()) await start.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function savePrices(page, panel, regular, sale) {
  const form = panel.locator(BLOCK_FORM).filter({ has: page.getByRole("textbox", { name: "Regular", exact: true }) });
  await form.getByRole("textbox", { name: "Regular", exact: true }).fill(regular);
  await form.getByRole("textbox", { name: "Sale", exact: true }).fill(sale);
  await form.getByRole("button", { name: /^Save/ }).click();
  await expect(panel.getByRole("textbox", { name: "Regular", exact: true })).toHaveValue(Number(regular).toFixed(2), { timeout: 30000 });
}

test("Commerce 0.8.0 archives a product its published page sells", async ({ page, request }) => {
  test.skip(phase !== "old");
  await signIn(page, request);
  const { database, rows } = storage();
  await expect.poll(() => database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get("uidx_plugin_dinkus-commerce_catalog_items_skuKey"), { timeout: 90000 }).toBeTruthy();
  // As 0.8.0's owner does it: a product page, the panel's first Save makes its product, then prices.
  const { id: pageId, panel } = await openProductPage(page, TITLE);
  await panel.getByRole("textbox", { name: "SKU", exact: true }).fill("LINKED-CAP");
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(panel.getByText("Draft: publish to sell it", { exact: true })).toBeVisible({ timeout: 30000 });
  await savePrices(page, panel, "15", "12");
  const id = items(rows("catalog_items")).find((row) => row.sku === "LINKED-CAP").itemId;
  // Publishing the page; the store's publish check then puts the product on sale.
  await ok(await page.request.post(content(pageId, "/publish"), { headers }));
  expect(await setOnSale(page.request, { entryId: pageId, onSale: true })).toEqual({ changed: true });
  const sold = (await publicCatalog(page.request)).find((item) => item.id === id);
  expect(sold?.name).toBe(TITLE);
  // Commerce settings: hide out-of-stock products, so the upgrade has a saved setting to keep.
  const settingsSaved = await page.request.post(endpoint, { data: { type: "form_submit", action_id: "settings.save", values: { hideOutOfStock: true } }, headers });
  expect(settingsSaved.ok()).toBe(true);
  expect(rows("storefront_out_of_stock_listing").active.hideOutOfStock).toBe(true);
  // 0.8.0's own button: Archive product, confirmed. The page stays published (dinkuskit/commerce#276).
  await page.reload();
  const archivePanel = await openPanel(page);
  await archivePanel.getByRole("button", { name: "Archive product", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archive", exact: true }).click();
  await expect(archivePanel.getByText("Archived: off the shop", { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(archivePanel.getByRole("button", { name: "Restore", exact: true })).toBeVisible();
  await capture(page, "linked-archived");
  const archived = rows("catalog_items")[id];
  expect(archived.archivedAt).toBeTruthy();
  expect(archived.pageId).toBe(pageId);
  expect((await ok(await page.request.get(content(pageId), { headers }))).item.status).toBe("published");
  expect((await publicCatalog(page.request)).some((item) => item.id === id)).toBe(false);
  writeFileSync(snapshotFile(), JSON.stringify({ from: process.env.COMMERCE_UPGRADE_FROM, id, pageId, sold,
    storage: Object.fromEntries(COLLECTIONS.map((name) => [name, rows(name)])), settingsRows: rows("storefront_availability_settings") }, null, 2));
  database.close();
});

test("this build ignores 0.8.0's archive mark: the product sells again, and the page's trash archives it", async ({ page, request }) => {
  test.skip(phase !== "new");
  const before = JSON.parse(readFileSync(snapshotFile(), "utf8"));
  const { id, pageId } = before;
  const sameAsBefore = (listed) => ({ ...listed, variants: { ...listed.variants, members: listed.variants.members.map(({ sku: _sku, ...member }) => member) } });
  await signIn(page, request);
  const { database, rows } = storage();
  // 1. The upgrade rewrites nothing 0.8.0 stored: the product (archivedAt included), its prices, its page link, the settings.
  for (const name of COLLECTIONS) expect(rows(name), name).toEqual(before.storage[name]);
  expect(rows("storefront_availability_settings")).toEqual(before.settingsRows);
  await page.goto("/_emdash/admin/plugins/dinkus-commerce/settings");
  await expect(page.getByRole("switch", { name: "Hide out-of-stock products", exact: true })).toBeChecked({ timeout: 30000 });

  // 2. The accepted change: archivedAt is no longer read, and the page is still published, so the product is on the
  // shop again exactly as 0.8.0 sold it (this build also says each variant member's own SKU, which 0.8.0 did not).
  const listed = (await publicCatalog(page.request)).find((item) => item.id === id);
  expect(listed.variants.members.map((member) => member.sku)).toEqual(["LINKED-CAP"]);
  expect(sameAsBefore(listed)).toEqual(before.sold);

  // 3. The page's panel says On sale with 0.8.0's prices, and has no Archive or Restore of Commerce's own.
  await page.goto("/_emdash/admin/content/products/" + pageId);
  const panel = await openPanel(page);
  await expect(panel.getByText("On sale", { exact: true })).toBeVisible();
  for (const name of ["Archive product", "Restore"]) await expect(panel.getByRole("button", { name, exact: true })).toHaveCount(0);
  await expect(panel.getByRole("textbox", { name: "Regular", exact: true })).toHaveValue("15.00");
  await expect(panel.getByRole("textbox", { name: "Sale", exact: true })).toHaveValue("12.00");
  await capture(page, "linked-on-sale-after-upgrade");

  // 4. Archive is Move to trash: the store's publish check takes the product off sale and keeps its page link.
  await ok(await page.request.delete(content(pageId), { headers }));
  expect(await setOnSale(page.request, { entryId: pageId, onSale: false })).toEqual({ changed: true });
  const trashed = rows("catalog_items")[id];
  expect([trashed.itemId, trashed.sku, trashed.pageId, trashed.offSale]).toEqual([id, "LINKED-CAP", pageId, true]);
  expect((await publicCatalog(page.request)).some((item) => item.id === id)).toBe(false);

  // 5. Restore from EmDash's Trash tab brings the page back as a Draft; nothing is sold yet.
  await page.goto("/_emdash/admin/content/products");
  await page.getByRole("tab", { name: /^Trash/ }).click();
  const row = page.getByRole("table").getByRole("row").filter({ has: page.getByText(TITLE, { exact: true }) }).first();
  await expect(row).toBeVisible({ timeout: 30000 });
  await capture(page, "linked-in-trash");
  await row.getByRole("button", { name: "Actions for " + TITLE, exact: true }).click();
  const restored = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === content(pageId, "/restore"));
  await page.getByRole("menu", { name: "Actions for " + TITLE, exact: true }).getByRole("menuitem", { name: "Restore", exact: true }).click();
  expect((await restored).ok()).toBe(true);
  expect((await ok(await page.request.get(content(pageId), { headers }))).item.status).toBe("draft");
  expect((await publicCatalog(page.request)).some((item) => item.id === id)).toBe(false);

  // 6. Publishing the page sells the same product, SKU, page and prices again.
  await ok(await page.request.post(content(pageId, "/publish"), { headers }));
  expect(await setOnSale(page.request, { entryId: pageId, onSale: true })).toEqual({ changed: true });
  const sold = rows("catalog_items")[id];
  expect(sold).not.toHaveProperty("offSale");
  expect([sold.itemId, sold.sku, sold.pageId]).toEqual([id, "LINKED-CAP", pageId]);
  expect(rows("catalog_prices")).toEqual(before.storage.catalog_prices);
  expect(rows("storefront_out_of_stock_listing")).toEqual(before.storage.storefront_out_of_stock_listing);
  expect(sameAsBefore((await publicCatalog(page.request)).find((item) => item.id === id))).toEqual(before.sold);
  await page.goto("/_emdash/admin/content/products/" + pageId);
  const soldPanel = await openPanel(page);
  await expect(soldPanel.getByText("On sale", { exact: true })).toBeVisible();
  await capture(page, "linked-published");
  database.close();
});
