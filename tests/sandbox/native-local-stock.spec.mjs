import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const grilltrackScreenshotsDir = resolve(
  ".grilltrack/work/v1-inventory-unavailable-20260930/screenshots",
);
mkdirSync(grilltrackScreenshotsDir, { recursive: true });

function getNativeDbPath() {
  const url = process.env.COMMERCE_NATIVE_DB ?? process.env.COMMERCE_PROOF_DB;
  if (!url) throw new Error("Missing COMMERCE_NATIVE_DB");
  return url.replace(/^file:/, "");
}

async function saveScreenshot(page, filename, artifactsDir) {
  const targetPath = resolve(artifactsDir, filename);
  await page.screenshot({ path: targetPath });
  copyFileSync(targetPath, resolve(grilltrackScreenshotsDir, filename));
}

test.describe("Native local-development Manage stock opt-in", () => {
  test("trusted host opt-in enables slider persist and dormant restore", async ({
    page,
    request,
  }) => {
    const artifactsDir = process.env.COMMERCE_PROOF_ARTIFACTS ?? ".artifacts";
    mkdirSync(artifactsDir, { recursive: true });

    const bypassResponse = await request.get("/_emdash/api/setup/dev-bypass");
    expect(bypassResponse.status()).toBe(200);

    const dbPath = getNativeDbPath();
    expect(existsSync(dbPath)).toBe(true);
    const db = new Database(dbPath);
    const now = "2026-09-26T00:00:00.000Z";
    const insertStorage = db.prepare(`
      INSERT OR REPLACE INTO _plugin_storage (plugin_id, collection, id, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const product = {
      recordKind: "catalog-item",
      itemId: "item-canvas-tote",
      commandId: "catalog:create:canvas-tote",
      creationIntent: { manageStock: false },
      kind: "simple-product",
      name: "Canvas Tote",
      sku: "TOTE-01",
      skuKey: "TOTE-01",
      stockManagement: { mode: "unmanaged" },
      state: "draft",
      createdAt: now,
    };
    insertStorage.run("dinkus-commerce", "catalogItems", product.itemId, JSON.stringify(product), now, now);
    insertStorage.run(
      "dinkus-commerce",
      "catalogPrices",
      product.itemId,
      JSON.stringify({
        recordKind: "catalog-price",
        recordId: product.itemId,
        catalogItemId: product.itemId,
        regular: { currency: "USD", minor: "2400" },
        sale: { currency: "USD", minor: "1800" },
      }),
      now,
      now,
    );
    insertStorage.run(
      "dinkus-commerce",
      "catalogManualAvailability",
      product.itemId,
      JSON.stringify({
        recordKind: "catalog-manual-availability",
        recordId: product.itemId,
        catalogItemId: product.itemId,
        status: "out-of-stock",
      }),
      now,
      now,
    );

    await page.goto(
      "/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/plugins/dinkus-commerce/products",
    );
    await page.getByRole("button", { name: "Get Started" }).click({ timeout: 60000 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const listed = await page.request.post(
      "/_emdash/api/plugins/dinkus-commerce/catalog-items/list",
      { data: {}, headers: { "X-EmDash-Request": "1" } },
    );
    expect(listed.status()).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.data.manageStockControl).toEqual({ enabled: true });
    await expect(page.locator("h1")).toHaveText("Products", { timeout: 30000 });

    const toteButton = page.locator("button", { hasText: "Canvas Tote" });
    await expect(toteButton).toBeVisible();
    await toteButton.click();

    const manageStock = page.locator("#manage-stock");
    const manageStockRow = page.locator(".dk-manage-stock-row");
    await expect(page.locator("#regular-price")).toHaveValue("24.00");
    await expect(page.locator("#sale-price")).toHaveValue("18.00");
    await expect(manageStock).toHaveAttribute("role", "switch");
    await expect(manageStock).toBeEnabled();
    await expect(manageStock).not.toBeChecked();
    await expect(manageStockRow.getByText("Coming soon", { exact: true })).toHaveCount(0);
    await expect(page.locator("fieldset:has-text('Stock status')")).toBeVisible();
    await expect(page.locator("label:has-text('Out of stock') input")).toBeChecked();
    await expect(page.getByText(/quantity|provider|inventory pool/i)).toHaveCount(0);
    await saveScreenshot(page, "native-local-stock-enabled.png", artifactsDir);

    const storageRow = (collection, id) =>
      JSON.parse(
        db.prepare(
          "SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = ? AND id = ?",
        ).get("dinkus-commerce", collection, id).data,
      );
    const saveNativeProduct = async () => {
      const response = page.waitForResponse(
        (r) => r.url().endsWith("/catalog-items/save-prices") && r.request().method() === "POST",
      );
      await page.locator("form:has(#regular-price)").getByRole("button", { name: "Save", exact: true }).click();
      const received = await response;
      const body = await received.json();
      expect(received.status()).toBe(200);
      expect(body.data.saved).toBe(true);
      return { received, body, values: received.request().postDataJSON() };
    };

    await manageStock.click();
    await expect(manageStock).toBeChecked();
    await expect(page.locator("fieldset:has-text('Stock status')")).toHaveCount(0);
    const enabledSave = await saveNativeProduct();
    expect(enabledSave.values.manageStock).toBe(true);
    expect(storageRow("catalogItems", product.itemId).stockManagement).toEqual({
      mode: "managed",
      status: "setup-required",
    });
    expect(storageRow("catalogManualAvailability", product.itemId).status).toBe("out-of-stock");
    await expect(page.locator("fieldset:has-text('Stock status')")).toHaveCount(0);
    await expect(page.getByText(/quantity|provider|inventory pool/i)).toHaveCount(0);
    await saveScreenshot(page, "native-local-stock-setup-required.png", artifactsDir);

    await manageStock.focus();
    await page.keyboard.press("Space");
    await expect(manageStock).not.toBeChecked();
    const restoredSave = await saveNativeProduct();
    expect(restoredSave.values.manageStock).toBe(false);
    expect(storageRow("catalogItems", product.itemId).stockManagement).toEqual({
      mode: "unmanaged",
    });
    expect(storageRow("catalogManualAvailability", product.itemId).status).toBe("out-of-stock");
    await expect(page.locator("label:has-text('Out of stock') input")).toBeChecked();
    await expect(page.getByText(/quantity|provider|inventory pool/i)).toHaveCount(0);
    await saveScreenshot(page, "native-local-stock-dormant-restored.png", artifactsDir);

    await page.locator("#regular-price").fill("28.00");
    await page.locator("#sale-price").fill("21.00");
    await saveNativeProduct();
    expect(storageRow("catalogPrices", product.itemId)).toMatchObject({
      regular: { currency: "USD", minor: "2800" },
      sale: { currency: "USD", minor: "2100" },
    });
    expect(storageRow("catalogItems", product.itemId).stockManagement).toEqual({
      mode: "unmanaged",
    });

    await page.reload();
    await toteButton.click();
    await expect(page.locator("#regular-price")).toHaveValue("28.00");
    await expect(page.locator("#sale-price")).toHaveValue("21.00");
    await expect(manageStock).toBeEnabled();
    await expect(manageStock).not.toBeChecked();
    await expect(manageStockRow.getByText("Coming soon", { exact: true })).toHaveCount(0);
    await expect(page.locator("label:has-text('Out of stock') input")).toBeChecked();
    await saveScreenshot(page, "native-local-stock-reloaded.png", artifactsDir);

    db.close();
  });
});
