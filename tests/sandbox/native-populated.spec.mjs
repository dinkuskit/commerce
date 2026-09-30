import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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
  test("seeds old data, verifies rendering, edits via restored UI, and asserts storage retention", async ({
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

    // 3. Authenticate clerk session and navigate to restored Products admin
    await page.goto("/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/plugins/dinkus-commerce/products");

    // Dismiss setup dialog if present
    const getStartedButton = page.getByRole("button", { name: "Get Started" });
    await getStartedButton.click({ timeout: 60000 });
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Verify header and product list
    await expect(page.locator("h1")).toHaveText("Products", { timeout: 30000 });
    const bootButton = page.locator("button", { hasText: "Heritage Boot" });
    const blanketButton = page.locator("button", { hasText: "Wool Blanket" });
    await expect(bootButton).toBeVisible();
    await expect(blanketButton).toBeVisible();

    // 4. Verify unmanaged product data renders correctly in form fields
    await bootButton.click();
    await expect(page.locator("#regular-price")).toHaveValue("180.00");
    await expect(page.locator("#sale-price")).toHaveValue("150.00");
    const manageStock = page.locator("#manage-stock");
    const manageStockRow = page.locator(".dk-manage-stock-row");
    await expect(manageStock).toHaveAttribute("role", "switch");
    await expect(manageStock).not.toBeChecked();
    await expect(manageStock).toBeDisabled();
    await expect(manageStockRow.getByText("Coming soon", { exact: true })).toBeVisible();
    await expect(manageStockRow).toHaveCSS("display", "flex");
    const filter = await manageStock.evaluate((element) => getComputedStyle(element).filter);
    expect(filter).toMatch(/grayscale/);
    await manageStock.click({ force: true });
    await expect(manageStock).not.toBeChecked();
    await manageStock.focus();
    await page.keyboard.press("Space");
    await expect(manageStock).not.toBeChecked();
    const outOfStockRadio = page.locator("label:has-text('Out of stock') input");
    await expect(outOfStockRadio).toBeChecked();

    await saveScreenshot(page, "native-products-populated.png", artifactsDir);

    const storageRow = (collection, id) => JSON.parse(db.prepare(
      "SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = ? AND id = ?",
    ).get("dinkus-commerce", collection, id).data);
    const saveNativeProduct = async (expectedSaved = true) => {
      const response = page.waitForResponse(r => r.url().endsWith("/catalog-items/save-prices") && r.request().method() === "POST");
      await page.locator("form:has(#regular-price) button:has-text('Save')").click();
      const received = await response;
      const body = await received.json();
      if (expectedSaved) {
        expect(received.status()).toBe(200);
        expect(body.data.saved).toBe(true);
        await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
      }
      return { received, body, values: received.request().postDataJSON() };
    };

    await blanketButton.click();
    await expect(manageStock).toBeChecked();
    await expect(manageStock).toBeDisabled();
    await expect(page.getByText("Coming soon", { exact: true })).toBeVisible();
    await expect(page.locator("fieldset:has-text('Stock status')")).not.toBeVisible();
    await saveScreenshot(page, "native-managed-setup.png", artifactsDir);

    const claimBefore = storageRow("managedSkuClaims", managedClaim.recordId);
    const bindingBefore = storageRow("storeInventoryConfigurations", managedBinding.recordId);
    const managedBefore = storageRow("catalogItems", managedProduct.itemId);
    await page.locator("#regular-price").fill("42.00");
    await page.locator("#sale-price").fill("35.00");
    const managedSave = await saveNativeProduct();
    expect(managedSave.values).toMatchObject({ regular: "42.00", sale: "35.00" });
    expect(managedSave.values).not.toHaveProperty("manageStock");
    writeFileSync(resolve(artifactsDir, "native-managed-price-omit.json"), JSON.stringify({
      fixture: "synthetic managed blanket", transport: "EmDash 0.41.0 / native React / SQLite",
      submittedValues: (({ catalogItemId, ...rest }) => rest)(managedSave.values),
      persistedStock: storageRow("catalogItems", managedProduct.itemId).stockManagement,
    }, null, 2) + "\n");
    expect(storageRow("catalogItems", managedProduct.itemId)).toEqual(managedBefore);
    expect(storageRow("managedSkuClaims", managedClaim.recordId)).toEqual(claimBefore);
    expect(storageRow("storeInventoryConfigurations", managedBinding.recordId)).toEqual(bindingBefore);
    expect(storageRow("catalogPrices", managedProduct.itemId)).toMatchObject({
      regular: { currency: "USD", minor: "4200" },
      sale: { currency: "USD", minor: "3500" },
    });
    await saveScreenshot(page, "native-managed-price-preserved.png", artifactsDir);

    const disableAttempt = await page.request.post("/_emdash/api/plugins/dinkus-commerce/catalog-items/save-prices", {
      data: { catalogItemId: managedProduct.itemId, regular: "42.00", sale: "35.00", manageStock: false },
      headers: { "X-EmDash-Request": "1" },
    });
    expect([400, 409]).toContain(disableAttempt.status());
    expect(await disableAttempt.text()).toMatch(/cannot be changed|coming soon|MANAGE_STOCK_UNAVAILABLE/i);
    expect(storageRow("catalogItems", managedProduct.itemId)).toEqual(managedBefore);
    expect(storageRow("managedSkuClaims", managedClaim.recordId)).toEqual(claimBefore);

    // 6. Edit Heritage Boot via restored UI: change price and set In stock
    await bootButton.click();
    await page.locator("#regular-price").fill("195.00");
    await page.locator("#sale-price").fill("160.00");
    const inStockRadio = page.locator("label:has-text('In stock') input");
    await inStockRadio.check();

    // Click Save
    await page.locator("form:has(#regular-price) button:has-text('Save')").click();
    await page.waitForLoadState("networkidle");

    // Verify fields retain saved values in UI
    await expect(page.locator("#regular-price")).toHaveValue("195.00");
    await expect(page.locator("#sale-price")).toHaveValue("160.00");
    await expect(inStockRadio).toBeChecked();

    await saveScreenshot(page, "native-products-edited.png", artifactsDir);

    // 7. Verify storage retention in SQLite for the edited product
    const updatedPriceRow = db
      .prepare("SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = ? AND id = ?")
      .get("dinkus-commerce", "catalogPrices", "item-heritage-boot");
    expect(updatedPriceRow).toBeDefined();
    const updatedPriceData = JSON.parse(updatedPriceRow.data);
    expect(updatedPriceData.regular).toEqual({ currency: "USD", minor: "19500" });
    expect(updatedPriceData.sale).toEqual({ currency: "USD", minor: "16000" });

    const updatedAvailabilityRow = db
      .prepare("SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = ? AND id = ?")
      .get("dinkus-commerce", "catalogManualAvailability", "item-heritage-boot");
    expect(updatedAvailabilityRow).toBeDefined();
    const updatedAvailabilityData = JSON.parse(updatedAvailabilityRow.data);
    expect(updatedAvailabilityData.status).toBe("in-stock");

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
    expect(storageRow("catalogItems", unmanagedProduct.itemId).stockManagement).toEqual({ mode: "unmanaged" });

    // 8. Navigate to Store settings admin and verify seeded setting
    await page.goto("/_emdash/admin/plugins/dinkus-commerce/store");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("h1")).toHaveText("Store");
    const hideThemRadio = page.locator("label:has-text('Hide them') input");
    const showOutOfStockRadio = page.locator("label:has-text('Show as out of stock') input");
    await expect(hideThemRadio).toBeChecked();

    await saveScreenshot(page, "native-store-populated.png", artifactsDir);

    // 9. Edit Store setting via restored UI
    await showOutOfStockRadio.check();
    await page.locator("button:has-text('Save')").click();
    await page.waitForLoadState("networkidle");
    await expect(showOutOfStockRadio).toBeChecked();

    await saveScreenshot(page, "native-store-edited.png", artifactsDir);

    // 10. Verify Store setting storage retention in SQLite
    const updatedStoreRow = db
      .prepare("SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = ? AND id = ?")
      .get("dinkus-commerce", "storefrontOutOfStockListing", "active");
    expect(updatedStoreRow).toBeDefined();
    const updatedStoreData = JSON.parse(updatedStoreRow.data);
    expect(updatedStoreData.hideOutOfStock).toBe(false);

    // Existing identity and managed setup survive edits without a collection migration.
    const storedItems = db.prepare("SELECT id, data FROM _plugin_storage WHERE plugin_id = ? AND collection = ? ORDER BY id")
      .all("dinkus-commerce", "catalogItems");
    expect(storedItems.map(row => row.id)).toEqual(["item-heritage-boot", "item-wool-blanket"]);
    expect(JSON.parse(storedItems[1].data)).toEqual(managedProduct);
    expect(storageRow("managedSkuClaims", managedClaim.recordId)).toEqual(managedClaim);
    expect(storageRow("storeInventoryConfigurations", managedBinding.recordId)).toEqual(managedBinding);
    expect(JSON.parse(storedItems[0].data)).toMatchObject({ itemId: unmanagedProduct.itemId, sku: "BOOT-01", stockManagement: { mode: "unmanaged" } });
    expect(db.prepare("SELECT COUNT(*) AS count FROM _plugin_storage WHERE plugin_id = ? AND collection = ?")
      .get("dinkus-commerce", "catalog_items").count).toBe(0);
    await page.reload();
    await expect(showOutOfStockRadio).toBeChecked();
    await page.goto("/_emdash/admin/plugins/dinkus-commerce/products");
    await bootButton.click();
    await expect(page.locator("#regular-price")).toHaveValue("195.00");
    await expect(page.locator("#sale-price")).toHaveValue("160.00");
    await expect(inStockRadio).toBeChecked();

    db.close();
  });

  test("unauthenticated access to native admin routes and APIs fails closed", async ({ browser, request }) => {
    // Fresh unauthenticated context
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();

    // Verify unauthenticated admin page access redirects or denies
    await anonPage.goto("/_emdash/admin/plugins/dinkus-commerce/products");
    // EmDash redirects unauthenticated admin requests to setup/login
    expect(anonPage.url()).not.toContain("/_emdash/admin/plugins/dinkus-commerce/products");

    // Verify unauthenticated API POST fails closed
    const apiResponse = await request.post("/_emdash/api/plugins/dinkus-commerce/catalog-items/save-prices", {
      data: { catalogItemId: "item-heritage-boot", regular: "200.00" },
    });
    expect([401, 403]).toContain(apiResponse.status());

    await anonContext.close();
  });
});
