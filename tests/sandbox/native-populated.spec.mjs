import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { BLOCK_FORM, ensureProductsCollection, openPanel } from "./product-page.mjs";

const grilltrackScreenshotsDir = resolve(".grilltrack/work/native-continuity/screenshots");
mkdirSync(grilltrackScreenshotsDir, { recursive: true });

function getNativeDbPath() {
  const url = process.env.COMMERCE_NATIVE_DB ?? process.env.COMMERCE_PROOF_DB;
  if (!url) throw new Error("Missing COMMERCE_NATIVE_DB");
  return url.replace(/^file:/, "");
}

async function saveScreenshot(page, filename, artifactsDir) {
  const targetPath = resolve(artifactsDir, filename);
  await page.screenshot({ path: targetPath });
  const copyTarget = resolve(grilltrackScreenshotsDir, filename);
  copyFileSync(targetPath, copyTarget);
}

test.describe("Native populated-browser continuity fixture", () => {
  test("seeds old data, verifies rendering, edits in the Block Kit panel, and asserts storage retention", async ({
    page,
    request,
  }) => {
    const artifactsDir = process.env.COMMERCE_PROOF_ARTIFACTS ?? ".artifacts";
    mkdirSync(artifactsDir, { recursive: true });

    // 1. Initialize dev database via dev-bypass
    const bypassResponse = await request.get("/_emdash/api/setup/dev-bypass");
    expect(bypassResponse.status()).toBe(200);

    const dbPath = getNativeDbPath();
    expect(existsSync(dbPath)).toBe(true);

    const db = new Database(dbPath);

    // 2. Seed existing data into native collections in _plugin_storage
    const now = "2026-09-26T00:00:00.000Z";
    const insertStorage = db.prepare(`
      INSERT OR REPLACE INTO _plugin_storage (plugin_id, collection, id, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    // (a) Seed unmanaged product
    const unmanagedProduct = {
      recordKind: "catalog-item",
      itemId: "item-heritage-boot",
      commandId: "catalog:create:heritage-boot",
      creationIntent: { manageStock: false },
      kind: "simple-product",
      name: "Heritage Boot",
      sku: "BOOT-01",
      skuKey: "BOOT-01",
      stockManagement: { mode: "unmanaged" },
      state: "draft",
      createdAt: now,
    };
    insertStorage.run("dinkus-commerce", "catalogItems", unmanagedProduct.itemId, JSON.stringify(unmanagedProduct), now, now);

    // (b) Seed prices for unmanaged product
    const bootPrice = {
      recordKind: "catalog-price",
      recordId: "item-heritage-boot",
      catalogItemId: "item-heritage-boot",
      regular: { currency: "USD", minor: "18000" },
      sale: { currency: "USD", minor: "15000" },
    };
    insertStorage.run("dinkus-commerce", "catalogPrices", bootPrice.recordId, JSON.stringify(bootPrice), now, now);

    // (c) Seed manual availability for unmanaged product (out of stock)
    const bootAvailability = {
      recordKind: "catalog-manual-availability",
      recordId: "item-heritage-boot",
      catalogItemId: "item-heritage-boot",
      status: "out-of-stock",
    };
    insertStorage.run("dinkus-commerce", "catalogManualAvailability", bootAvailability.recordId, JSON.stringify(bootAvailability), now, now);

    // (d) Seed managed setup product
    const managedProduct = {
      recordKind: "catalog-item",
      itemId: "item-wool-blanket",
      commandId: "catalog:create:wool-blanket",
      creationIntent: { manageStock: true },
      kind: "simple-product",
      name: "Wool Blanket",
      sku: "BLANKET-01",
      skuKey: "BLANKET-01",
      stockManagement: { mode: "managed", status: "setup-required" },
      state: "draft",
      createdAt: now,
    };
    insertStorage.run("dinkus-commerce", "catalogItems", managedProduct.itemId, JSON.stringify(managedProduct), now, now);

    const managedClaim = {
      recordKind: "managed-sku-registration-claim",
      recordId: "claim-wool-blanket",
      claimKey: JSON.stringify(["managed-sku-registration", managedProduct.itemId, "initial"]),
      catalogItemId: managedProduct.itemId,
      operationId: "op-wool-blanket",
      request: { poolId: "pool-legacy", sku: "BLANKET-01", displayNameIfNew: "Wool Blanket" },
      createdAt: now,
    };
    insertStorage.run("dinkus-commerce", "managedSkuClaims", managedClaim.recordId, JSON.stringify(managedClaim), now, now);

    const managedBinding = {
      recordKind: "store-inventory-configuration",
      recordId: "active",
      configurationKey: "active",
      siteId: "site-legacy",
      binding: {
        providerRef: "inventory:legacy",
        poolId: "pool-legacy",
        defaultFulfillmentLocationId: "loc-legacy",
      },
      configuredAt: now,
      updatedAt: now,
    };
    insertStorage.run("dinkus-commerce", "storeInventoryConfigurations", managedBinding.recordId, JSON.stringify(managedBinding), now, now);

    // (e) Seed Store settings (hide out-of-stock)
    const storeSettings = {
      recordKind: "storefront-out-of-stock-listing",
      recordId: "active",
      hideOutOfStock: true,
      updatedAt: now,
    };
    insertStorage.run("dinkus-commerce", "storefrontOutOfStockListing", storeSettings.recordId, JSON.stringify(storeSettings), now, now);

    // 3. Sign in and open a product page that names the seeded boot; native stores use the same Block Kit panel as the Registry build.
    await page.goto("/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/plugins/dinkus-commerce/settings");
    const getStartedButton = page.getByRole("button", { name: "Get Started" });
    await getStartedButton.or(page.getByRole("heading", { name: "Commerce settings" })).first().waitFor({ state: "visible", timeout: 60000 });
    if (await getStartedButton.isVisible()) await getStartedButton.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // The old React Products and Store screens are gone; the sidebar matches a Registry store.
    await expect(page.getByRole("link", { name: "Commerce settings" })).toBeVisible();
    await expect(page.locator('a[href$="/plugins/dinkus-commerce/products"], a[href$="/plugins/dinkus-commerce/store"]')).toHaveCount(0);

    await ensureProductsCollection(page.request);
    const created = await page.request.post("/_emdash/api/content/products", {
      headers: { "X-EmDash-Request": "1" },
      data: { data: { title: "Heritage Boot", commerce_item_id: unmanagedProduct.itemId } },
    });
    expect(created.ok()).toBe(true);
    const createdData = (await created.json()).data;
    const bootPageId = (createdData.item ?? createdData).id;
    await page.goto("/_emdash/admin/content/products/" + bootPageId);
    let panel = await openPanel(page);
    // A page saved before the panel existed is linked once, by the product's SKU; Commerce keeps the link.
    await panel.getByRole("textbox", { name: "Or its SKU", exact: true }).fill("BOOT-01");
    await panel.getByRole("button", { name: "Sell it here", exact: true }).click();

    // 4. Old native data shows in the panel
    await expect(panel.getByRole("textbox", { name: "Regular", exact: true })).toHaveValue("180.00");
    await expect(panel.getByRole("textbox", { name: "Sale", exact: true })).toHaveValue("150.00");
    await expect(panel.getByRole("radio", { name: "Out of stock", exact: true })).toBeChecked();
    await expect(panel.getByText("Manage stock — Coming soon", { exact: true })).toBeVisible();
    await saveScreenshot(page, "native-products-populated.png", artifactsDir);

    const storageRow = (collection, id) => JSON.parse(db.prepare(
      "SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = ? AND id = ?",
    ).get("dinkus-commerce", collection, id).data);

    // 5. Managed setup cannot be switched off through the native JSON route.
    const managedBefore = storageRow("catalogItems", managedProduct.itemId);
    const claimBefore = storageRow("managedSkuClaims", managedClaim.recordId);
    const disableAttempt = await page.request.post("/_emdash/api/plugins/dinkus-commerce/catalog-items/save-prices", {
      data: { catalogItemId: managedProduct.itemId, regular: "42.00", sale: "35.00", manageStock: false },
      headers: { "X-EmDash-Request": "1" },
    });
    expect([400, 409]).toContain(disableAttempt.status());
    expect(await disableAttempt.text()).toMatch(/cannot be changed|coming soon|MANAGE_STOCK_UNAVAILABLE/i);
    expect(storageRow("catalogItems", managedProduct.itemId)).toEqual(managedBefore);
    expect(storageRow("managedSkuClaims", managedClaim.recordId)).toEqual(claimBefore);

    // 6. Edit Heritage Boot in the panel: change price and set In stock
    const priceForm = panel.locator(BLOCK_FORM).filter({ has: page.getByRole("textbox", { name: "Regular", exact: true }) });
    await priceForm.getByRole("textbox", { name: "Regular", exact: true }).fill("195");
    await priceForm.getByRole("textbox", { name: "Sale", exact: true }).fill("160");
    await priceForm.getByRole("radio", { name: "In stock", exact: true }).check();
    await priceForm.getByRole("button", { name: /^Save/ }).click();
    await expect(priceForm.getByRole("textbox", { name: "Regular", exact: true })).toHaveValue("195.00");
    await expect(priceForm.getByRole("textbox", { name: "Sale", exact: true })).toHaveValue("160.00");
    await saveScreenshot(page, "native-products-edited.png", artifactsDir);
    // Native stores keep their GTIN, MPN and Brand form, now in the same panel as Registry stores.
    const idsForm = panel.locator(BLOCK_FORM).filter({ has: page.getByRole("button", { name: "Save identifiers", exact: true }) });
    await idsForm.getByRole("textbox", { name: "GTIN", exact: true }).fill("4006381333931");
    await idsForm.getByRole("textbox", { name: "Brand", exact: true }).fill("Heritage");
    await idsForm.getByRole("button", { name: "Save identifiers", exact: true }).click();
    await expect.poll(() => storageRow("catalogItems", unmanagedProduct.itemId).gtin).toBe("4006381333931");
    expect(storageRow("catalogItems", unmanagedProduct.itemId).brand).toBe("Heritage");

    // 7. Storage keeps the native collection names
    await expect.poll(() => storageRow("catalogItems", unmanagedProduct.itemId).catalogData.items[unmanagedProduct.itemId].price.regular).toEqual({ currency: "USD", minor: "19500" });
    expect(storageRow("catalogItems", unmanagedProduct.itemId).catalogData.items[unmanagedProduct.itemId].price.sale).toEqual({ currency: "USD", minor: "16000" });
    expect(storageRow("catalogItems", unmanagedProduct.itemId).catalogData.items[unmanagedProduct.itemId].availability.status).toBe("in-stock");

    const bootBeforeEnable = storageRow("catalogItems", unmanagedProduct.itemId);
    const bootPriceBeforeEnable = storageRow("catalogPrices", unmanagedProduct.itemId);
    const enableAttempt = await page.request.post("/_emdash/api/plugins/dinkus-commerce/catalog-items/save-prices", {
      data: { catalogItemId: unmanagedProduct.itemId, regular: "195.00", sale: "160.00", manageStock: true },
      headers: { "X-EmDash-Request": "1" },
    });
    expect([400, 409]).toContain(enableAttempt.status());
    expect(await enableAttempt.text()).toMatch(/coming soon|MANAGE_STOCK_UNAVAILABLE/i);
    expect(storageRow("catalogItems", unmanagedProduct.itemId)).toEqual(bootBeforeEnable);
    expect(storageRow("catalogPrices", unmanagedProduct.itemId)).toEqual(bootPriceBeforeEnable);

    // 8. Commerce settings shows the seeded setting and the product no page sells
    await page.goto("/_emdash/admin/plugins/dinkus-commerce/settings");
    const hide = page.getByRole("switch", { name: "Hide out-of-stock products", exact: true });
    await expect(hide).toBeChecked({ timeout: 30000 });
    await expect(page.getByRole("heading", { name: "Products without a page" })).toBeVisible();
    // DinkusKit Connect only accepts Registry installs, so a native store shows a (DEV) note instead of a Connect it cannot finish.
    await expect(page.getByText("(DEV) This store runs Commerce from source. DinkusKit Connect is on Registry stores only.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect", exact: true })).toHaveCount(0);
    const connect = await page.request.post("/_emdash/api/plugins/dinkus-commerce/admin", { headers: { "X-EmDash-Request": "1" }, data: { type: "block_action", action_id: "connect" } });
    expect(JSON.stringify(await connect.json())).not.toContain("Approve at DinkusKit.com");
    await expect(page.getByText("Wool Blanket \u2014 BLANKET-01", { exact: true })).toBeVisible();
    await saveScreenshot(page, "native-store-populated.png", artifactsDir);

    // 9. Edit the setting
    await hide.uncheck();
    await page.locator(BLOCK_FORM).filter({ has: hide }).getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => storageRow("storefrontOutOfStockListing", "active").hideOutOfStock).toBe(false);
    await page.reload();
    await expect(page.getByRole("switch", { name: "Hide out-of-stock products", exact: true })).not.toBeChecked({ timeout: 30000 });
    await saveScreenshot(page, "native-store-edited.png", artifactsDir);

    // 10. Existing identity and managed setup survive edits without a collection migration.
    const storedItems = db.prepare("SELECT id, data FROM _plugin_storage WHERE plugin_id = ? AND collection = ? ORDER BY id")
      .all("dinkus-commerce", "catalogItems");
    expect(storedItems.map(row => row.id)).toEqual(["item-heritage-boot", "item-wool-blanket"]);
    expect(JSON.parse(storedItems[1].data)).toEqual(managedProduct);
    expect(storageRow("managedSkuClaims", managedClaim.recordId)).toEqual(managedClaim);
    expect(storageRow("storeInventoryConfigurations", managedBinding.recordId)).toEqual(managedBinding);
    expect(JSON.parse(storedItems[0].data)).toMatchObject({ itemId: unmanagedProduct.itemId, sku: "BOOT-01", stockManagement: { mode: "unmanaged" } });
    expect(db.prepare("SELECT COUNT(*) AS count FROM _plugin_storage WHERE plugin_id = ? AND collection = ?")
      .get("dinkus-commerce", "catalog_items").count).toBe(0);
    await page.goto("/_emdash/admin/content/products/" + bootPageId);
    panel = await openPanel(page);
    await expect(panel.getByRole("textbox", { name: "Regular", exact: true })).toHaveValue("195.00");
    await expect(panel.getByRole("radio", { name: "In stock", exact: true })).toBeChecked();

    db.close();
  });

  test("unauthenticated access to native admin routes and APIs fails closed", async ({ browser, request }) => {
    // Fresh unauthenticated context
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();

    // Verify unauthenticated admin page access redirects or denies
    await anonPage.goto("/_emdash/admin/plugins/dinkus-commerce/settings");
    // EmDash redirects unauthenticated admin requests to setup/login
    expect(anonPage.url()).not.toContain("/_emdash/admin/plugins/dinkus-commerce/settings");

    // Verify unauthenticated API POST fails closed
    const apiResponse = await request.post("/_emdash/api/plugins/dinkus-commerce/catalog-items/save-prices", {
      data: { catalogItemId: "item-heritage-boot", regular: "200.00" },
    });
    expect([401, 403]).toContain(apiResponse.status());

    await anonContext.close();
  });
});
