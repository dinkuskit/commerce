import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { Kysely, SqliteDialect } from "kysely";
import { PluginStorageRepository } from "emdash";
import { resolveStorefrontAvailability } from "../../dist/features/storefront-availability/index.js";

// Primary owner for transport/rendering: real workerd, host authorization and SQLite.
// Kernel unit tests cannot detect broken sandbox RPC, invalid Block Kit, or lost form state.
// No test-only production exports or alternate storage implementation.
test("fresh sandbox installation preserves the clerk workflow and storefront policy", async ({ page, request, browser }) => {
  const setup = await request.get("/_emdash/api/setup/dev-bypass");
  expect(setup.status()).toBe(200);
  const filename = process.env.COMMERCE_PROOF_DB.slice(5);
  const database = new Database(filename);
  const db = new Kysely({ dialect: new SqliteDialect({ database }) });
  const collection = (name) => new PluginStorageRepository(db, "dinkus-commerce", name, []);
  const raw = (name) => database.prepare("SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = ?").all("dinkus-commerce", name).map(row => JSON.parse(row.data));
  const store = { catalog: collection("catalog_items"), prices: collection("catalog_prices"), manualAvailability: collection("catalog_manual_availability"),
    configurations: collection("store_inventory_configurations"), settings: collection("storefront_availability_settings"),
    backorderPolicies: collection("catalog_backorder_policies"), listing: collection("storefront_out_of_stock_listing") };
  const capture = async (name) => page.screenshot({ path: process.env.COMMERCE_PROOF_ARTIFACTS + "/" + name + ".png", animations: "disabled", fullPage: true });
  const adminPath = "/_emdash/admin/plugins/dinkus-commerce/";
  const endpoint = "/_emdash/api/plugins/dinkus-commerce/admin";
  let lastSave;
  const save = async () => {
    const response = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === "POST");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const received = await response;
    expect(received.status()).toBe(200);
    lastSave = received.request().postDataJSON();
    const body = await received.json();
    expect(body.success).toBe(true);
    return body.data;
  };
  try {
    await expect.poll(() => database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get("uidx_plugin_dinkus-commerce_catalog_items_skuKey"), { timeout: 90000 }).toBeTruthy();
    const anonymous = await browser.newContext();
    const denial = await anonymous.request.post(new URL(endpoint, test.info().project.use.baseURL).href, { data: { type: "form_submit", action_id: "settings.save", values: { hideOutOfStock: true } }, headers: { "X-EmDash-Request": "1" } });
    expect([401, 403]).toContain(denial.status());
    expect(raw("storefront_out_of_stock_listing")).toHaveLength(0);
    await anonymous.close();

    await page.goto("/_emdash/api/auth/dev-bypass?redirect=" + adminPath + "products");
    await page.getByRole("button", { name: "Get Started" }).click({ timeout: 60000 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("No products yet", { exact: true })).toBeVisible();
    await capture("products-empty");
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Red hat");
    await page.getByRole("textbox", { name: "SKU", exact: true }).fill("RED-HAT");
    const createResponse = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === "POST");
    await page.getByRole("button", { name: "Add product", exact: true }).click();
    const createdResponse = await createResponse;
    expect((await createdResponse.json()).data.toast.type).toBe("success");
    await expect(page.getByRole("textbox", { name: "Regular", exact: true })).toHaveValue("");
    const created = raw("catalog_items").filter(row => row.recordKind === "catalog-item");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ name: "Red hat", sku: "RED-HAT", stockManagement: { mode: "unmanaged" } });
    const id = created[0].itemId;
    const availability = () => resolveStorefrontAvailability(store, { catalogItemId: id }, { resolveProvider: async () => { throw new Error("Inventory must not be needed"); } });
    expect((await availability()).listable).toBe(false);
    const replay = await page.request.post(endpoint, { data: createdResponse.request().postDataJSON(), headers: { "X-EmDash-Request": "1" } });
    expect((await replay.json()).data.toast.type).toBe("success");
    expect(raw("catalog_items").filter(row => row.recordKind === "catalog-item")).toHaveLength(1);

    await expect(page.getByText("Manage stock — Coming soon", { exact: true })).toBeVisible();
    await expect(page.getByRole("switch", { name: /Manage stock/ })).toHaveCount(0);
    await expect(page.locator('input[type="checkbox"][id="manage-stock"]')).toHaveCount(0);
    await expect(page.locator('[data-action-id="manageStock"], [name="manageStock"]')).toHaveCount(0);
    await page.getByText("Manage stock — Coming soon", { exact: true }).click();
    await page.keyboard.press("Space");
    await page.keyboard.press("Enter");
    expect(raw("catalog_items")[0].stockManagement).toEqual({ mode: "unmanaged" });
    await capture("manage-stock-coming-soon");

    await page.getByRole("textbox", { name: "Regular", exact: true }).fill("12");
    await page.getByRole("textbox", { name: "Sale", exact: true }).fill("10");
    await page.getByRole("radio", { name: "Out of stock", exact: true }).check();
    expect((await save()).toast.type).toBe("success");
    await expect(page.getByRole("textbox", { name: "Regular", exact: true })).toHaveValue("12.00");
    expect(lastSave.values).not.toHaveProperty("manageStock");
    expect(raw("catalog_prices")[0]).toMatchObject({ regular: { currency: "USD", minor: "1200" }, sale: { currency: "USD", minor: "1000" } });
    expect(raw("catalog_items")[0].stockManagement).toEqual({ mode: "unmanaged" });
    expect(await availability()).toMatchObject({ status: "out-of-stock", sellable: false, listable: true });
    await capture("price-stock-saved");

    for (const [regular, sale, error] of [["12.999", "10", "Enter a dollar amount"], ["12", "15", "Sale must be lower"]]) {
      await page.getByRole("textbox", { name: "Regular", exact: true }).fill(regular);
      await page.getByRole("textbox", { name: "Sale", exact: true }).fill(sale);
      const rejected = await save(); expect(rejected.toast.type).toBe("error"); expect(rejected.toast.message).toContain(error);
      await expect(page.getByRole("textbox", { name: "Regular", exact: true })).toHaveValue(regular);
      await expect(page.getByRole("textbox", { name: "Sale", exact: true })).toHaveValue(sale);
      expect(raw("catalog_prices")[0]).toMatchObject({ regular: { minor: "1200" }, sale: { minor: "1000" } });
    }
    await capture("price-refused");
    await page.getByRole("textbox", { name: "Regular", exact: true }).fill("12.00");
    await page.getByRole("textbox", { name: "Sale", exact: true }).fill("10.00");
    await page.getByRole("radio", { name: "In stock", exact: true }).check();
    expect((await save()).toast.type).toBe("success");
    expect(raw("catalog_manual_availability")[0].status).toBe("in-stock");
    expect(raw("catalog_items")[0].stockManagement).toEqual({ mode: "unmanaged" });
    const catalogBeforeEnable = JSON.stringify(raw("catalog_items"));
    const pricesBeforeEnable = JSON.stringify(raw("catalog_prices"));
    const claimsBeforeEnable = JSON.stringify(raw("managed_sku_claims"));
    const maliciousEnable = await page.request.post(endpoint, {
      data: { ...lastSave, values: { ...lastSave.values, manageStock: true } },
      headers: { "X-EmDash-Request": "1" },
    });
    const enableBody = await maliciousEnable.json();
    expect(enableBody.data.toast.type).toBe("error");
    expect(enableBody.data.toast.message).toContain("coming soon");
    expect(JSON.stringify(raw("catalog_items"))).toBe(catalogBeforeEnable);
    expect(JSON.stringify(raw("catalog_prices"))).toBe(pricesBeforeEnable);
    expect(JSON.stringify(raw("managed_sku_claims"))).toBe(claimsBeforeEnable);
    expect(raw("catalog_items")[0].stockManagement).toEqual({ mode: "unmanaged" });
    await capture("manage-stock-enable-refused");
    await page.reload();
    await page.getByRole("button", { name: "Open Red hat", exact: true }).click();
    await expect(page.getByText("Manage stock — Coming soon", { exact: true })).toBeVisible();
    await expect(page.getByRole("radio", { name: "In stock", exact: true })).toBeChecked();
    expect(raw("catalog_items")[0].stockManagement).toEqual({ mode: "unmanaged" });
    expect(raw("catalog_prices")[0]).toMatchObject({ regular: { minor: "1200" }, sale: { minor: "1000" } });
    expect(raw("managed_sku_claims")).toHaveLength(0);
    await page.getByRole("radio", { name: "Out of stock", exact: true }).check();
    expect((await save()).toast.type).toBe("success");
    expect(raw("catalog_manual_availability")[0].status).toBe("out-of-stock");

    await page.goto(adminPath + "settings");
    await expect(page.getByRole("heading", { name: "Catalog", exact: true })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Hide out-of-stock products", exact: true })).not.toBeChecked();
    await page.getByRole("switch", { name: "Hide out-of-stock products", exact: true }).check();
    expect((await save()).toast.type).toBe("success");
    await page.reload();
    await expect(page.getByRole("switch", { name: "Hide out-of-stock products", exact: true })).toBeChecked();
    expect((await availability()).listable).toBe(false);
    await capture("settings-catalog");
    await page.getByRole("switch", { name: "Hide out-of-stock products", exact: true }).uncheck();
    expect((await save()).toast.type).toBe("success");
    expect((await availability()).listable).toBe(true);

    await page.goto(adminPath + "products");
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Another hat");
    await page.getByRole("textbox", { name: "SKU", exact: true }).fill("RED-HAT");
    await page.getByRole("button", { name: "Add product", exact: true }).click();
    await expect(page.getByText("sku is already assigned to another catalog item", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Another hat");
    expect(raw("catalog_items").filter(row => row.recordKind === "catalog-item")).toHaveLength(1);
    await page.goto(adminPath + "products");
    await page.getByRole("button", { name: "Open Red hat", exact: true }).click();
    // A real storage failure must not erase clerk inputs or remove retry controls.
    const refuseWrites = (collectionName) => {
      for (const event of ["INSERT", "UPDATE"]) database.exec(
        "CREATE TRIGGER proof_refuse_" + event + " BEFORE " + event + " ON _plugin_storage WHEN NEW.plugin_id='dinkus-commerce' AND NEW.collection='" + collectionName + "' BEGIN SELECT RAISE(ABORT, 'proof storage unavailable'); END"
      );
    };
    const allowWrites = () => {
      for (const event of ["INSERT", "UPDATE"]) database.exec("DROP TRIGGER IF EXISTS proof_refuse_" + event);
    };
    await page.getByRole("textbox", { name: "Regular", exact: true }).fill("13.25");
    await page.getByRole("textbox", { name: "Sale", exact: true }).fill("8.50");
    refuseWrites("catalog_prices");
    try {
      expect((await save()).toast.message).toContain("catalog price update failed");
      await expect(page.getByRole("textbox", { name: "Regular", exact: true })).toHaveValue("13.25");
      await expect(page.getByRole("textbox", { name: "Sale", exact: true })).toHaveValue("8.50");
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
      expect(raw("catalog_prices")[0]).toMatchObject({ regular: { minor: "1200" }, sale: { minor: "1000" } });
      await capture("save-storage-refused");
    } finally { allowWrites(); }
    expect((await save()).toast.type).toBe("success");
    await page.goto(adminPath + "settings");
    await page.getByRole("switch", { name: "Hide out-of-stock products", exact: true }).check();
    refuseWrites("storefront_out_of_stock_listing");
    try {
      expect((await save()).toast.message).toContain("out-of-stock listing update failed");
      await expect(page.getByRole("switch", { name: "Hide out-of-stock products", exact: true })).toBeChecked();
      expect(raw("storefront_out_of_stock_listing")[0].hideOutOfStock).toBe(false);
      await capture("settings-storage-refused");
    } finally { allowWrites(); }
    expect((await save()).toast.type).toBe("success");
    await page.goto(adminPath + "products");
    await page.getByRole("button", { name: "Open Red hat", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("textbox", { name: "Regular", exact: true })).toHaveValue("13.25");
    await capture("product-mobile");
    console.log("sandbox_proof=pass create replay price-refusal coming-soon-disabled malicious-enable-refused settings anonymous-denial unmanaged-without-Inventory; DB=" + filename);
  } finally { await db.destroy(); }
});

// Product media: a clerk chooses images from the Media Library through the
// Commerce-rendered chooser (Block Kit 1.2.0 renders no media_picker on plugin
// pages); the public catalog carries media ids and alt read live; the
// server-rendered storefront resolves public URLs and srcset through EmDash.
test("clerk sets product images from the Media Library and the storefront renders them", async ({ page, request, browser }) => {
  const { solidPng } = await import("./png.mjs");
  const filename = process.env.COMMERCE_PROOF_DB.slice(5);
  const database = new Database(filename);
  const raw = (name) => database.prepare("SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = ?").all("dinkus-commerce", name).map(row => JSON.parse(row.data));
  const capture = async (name) => page.screenshot({ path: process.env.COMMERCE_PROOF_ARTIFACTS + "/" + name + ".png", animations: "disabled", fullPage: true });
  const adminPath = "/_emdash/admin/plugins/dinkus-commerce/";
  const endpoint = "/_emdash/api/plugins/dinkus-commerce/admin";
  const interact = async (name) => {
    const response = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === "POST");
    await page.getByRole("button", { name, exact: true }).click();
    const body = await (await response).json();
    expect(body.success).toBe(true);
    return body.data;
  };
  try {
    await page.goto("/_emdash/api/auth/dev-bypass?redirect=" + adminPath + "products");
    const started = page.getByRole("button", { name: "Get Started" });
    if (await started.count()) await started.click();
    const upload = async (name, colour, fields = {}) => {
      const response = await page.request.post("/_emdash/api/media", {
        multipart: { file: { name, mimeType: "image/png", buffer: solidPng(640, 480, colour) }, ...fields },
        headers: { "X-EmDash-Request": "1" },
      });
      expect(response.status()).toBe(201);
      return (await response.json()).data.item;
    };
    const front = await upload("red-hat-front.png", [200, 30, 30], { alt: "Red hat, front" });
    const side = await upload("red-hat-side.png", [30, 120, 200]);
    const back = await upload("red-hat-back.png", [30, 160, 60], { caption: "Back view" });
    const placeholder = await upload("store-placeholder.png", [120, 120, 120]);
    expect(front.storageKey.split(".")[0]).not.toBe(front.id);

    await page.getByRole("button", { name: "Open Red hat", exact: true }).click();
    // The first spec leaves Hide out-of-stock on and Red hat out of stock; make it listable again.
    await page.getByRole("radio", { name: "In stock", exact: true }).check();
    expect((await interact("Save")).toast.type).toBe("success");
    await expect(page.getByText("No image", { exact: true })).toBeVisible();
    await expect(page.getByText("Gallery (0 of 8)", { exact: true })).toBeVisible();
    expect((await interact("Choose image")).blocks[0].text).toBe("Choose an image");
    await expect(page.getByRole("heading", { name: "Choose an image" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Red hat, front" })).toBeVisible();
    await capture("media-chooser");
    expect((await interact("Use red-hat-front.png")).toast.message).toBe("Image saved");
    expect(raw("catalog_media")[0]).toMatchObject({ recordKind: "catalog-media", image: { mediaId: front.id }, gallery: [] });
    await expect(page.getByRole("img", { name: "Red hat, front" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Change image", exact: true })).toBeVisible();
    await capture("product-image-chosen");

    await interact("Add to gallery");
    expect((await interact("Use red-hat-side.png")).toast.message).toBe("Added to gallery");
    await interact("Add to gallery");
    expect((await interact("Use red-hat-back.png")).toast.message).toBe("Added to gallery");
    await expect(page.getByText("Gallery (2 of 8)", { exact: true })).toBeVisible();
    expect(raw("catalog_media")[0].gallery).toEqual([{ mediaId: side.id }, { mediaId: back.id }]);
    await interact("Add to gallery");
    const duplicate = await interact("Use red-hat-side.png");
    expect(duplicate.toast.type).toBe("error");
    expect(duplicate.toast.message).toContain("already in the gallery");
    expect(raw("catalog_media")[0].gallery).toEqual([{ mediaId: side.id }, { mediaId: back.id }]);
    await expect(page.getByText("That image is already in the gallery", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Gallery (2 of 8)", { exact: true })).toBeVisible();
    await capture("product-gallery");
    expect((await interact("Move image 2 up")).toast.message).toBe("Gallery reordered");
    expect(raw("catalog_media")[0].gallery).toEqual([{ mediaId: back.id }, { mediaId: side.id }]);
    expect((await interact("Remove image 1")).toast.message).toBe("Image removed");
    expect(raw("catalog_media")[0].gallery).toEqual([{ mediaId: side.id }]);
    expect(raw("catalog_prices")[0]).toMatchObject({ regular: { minor: "1325" }, sale: { minor: "850" } });
    await page.reload();
    await page.getByRole("button", { name: "Open Red hat", exact: true }).click();
    await expect(page.getByRole("img", { name: "Red hat, front" })).toBeVisible();
    await expect(page.getByText("Gallery (1 of 8)", { exact: true })).toBeVisible();

    await page.goto(adminPath + "settings");
    await expect(page.getByRole("heading", { name: "Placeholder image" })).toBeVisible();
    await interact("Choose placeholder");
    await expect(page.getByRole("heading", { name: "Choose a placeholder image" })).toBeVisible();
    expect((await interact("Use store-placeholder.png")).toast.message).toBe("Placeholder saved");
    expect(raw("storefront_placeholder_image")[0].image).toEqual({ mediaId: placeholder.id });
    await expect(page.getByRole("button", { name: "Remove placeholder", exact: true })).toBeVisible();
    await capture("settings-placeholder");

    await page.goto(adminPath + "products");
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Blue hat");
    await page.getByRole("textbox", { name: "SKU", exact: true }).fill("BLUE-HAT");
    expect((await interact("Add product")).toast.message).toBe("Product added");
    await page.getByRole("textbox", { name: "Regular", exact: true }).fill("5");
    expect((await interact("Save")).toast.type).toBe("success");

    const shopper = await browser.newContext();
    const catalog = (await (await shopper.request.get(new URL("/_emdash/api/plugins/dinkus-commerce/catalog/public", test.info().project.use.baseURL).href)).json()).data;
    const red = catalog.products.find((product) => product.sku === "RED-HAT");
    const blue = catalog.products.find((product) => product.sku === "BLUE-HAT");
    expect(red.image).toEqual({ id: front.id, alt: "Red hat, front", width: 640, height: 480, placeholder: false });
    expect(red.gallery).toEqual([{ id: side.id, alt: "Red hat", width: 640, height: 480, placeholder: false }]);
    expect(blue.image).toEqual({ id: placeholder.id, alt: "Blue hat", width: 640, height: 480, placeholder: true });
    expect(blue.gallery).toEqual([]);
    expect(JSON.stringify(catalog)).not.toContain("/_emdash/api/media/asset/");
    writeFileSync(process.env.COMMERCE_PROOF_ARTIFACTS + "/public-catalog-media.json", JSON.stringify(catalog, null, 2));

    const storefront = await shopper.newPage();
    await storefront.goto("/");
    const hero = storefront.locator('li[data-product="RED-HAT"] img').first();
    await expect(hero).toHaveAttribute("alt", "Red hat, front");
    const src = await hero.getAttribute("src");
    const srcset = await hero.getAttribute("srcset");
    expect(src).toContain("/_emdash/api/media/file/" + front.storageKey);
    expect(srcset).toContain("/_image?href=");
    expect(srcset).toContain(" 300w");
    expect(srcset).toContain(" 600w");
    expect(srcset).not.toContain("1200w");
    const candidate = srcset.split(",")[0].trim().split(" ")[0];
    const transformed = await shopper.request.get(new URL(candidate, test.info().project.use.baseURL).href);
    expect(transformed.status()).toBe(200);
    expect(transformed.headers()["content-type"]).toContain("image/webp");
    await expect(storefront.locator('li[data-product="RED-HAT"] .gallery img')).toHaveCount(1);
    await expect(storefront.locator('li[data-product="BLUE-HAT"] img[data-placeholder="true"]')).toHaveAttribute("alt", "Blue hat");
    await expect.poll(() => hero.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
    const chosen = await hero.evaluate((img) => img.currentSrc);
    expect(chosen).toContain("/_image?href=");
    await storefront.screenshot({ path: process.env.COMMERCE_PROOF_ARTIFACTS + "/storefront-images.png", animations: "disabled", fullPage: true });
    await shopper.close();
    console.log("media_proof=pass chooser gallery-reorder placeholder public-ids storefront-srcset; DB=" + filename);
  } finally { database.close(); }
});
