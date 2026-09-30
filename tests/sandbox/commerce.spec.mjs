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

    await page.getByRole("textbox", { name: "Regular", exact: true }).fill("12");
    await page.getByRole("textbox", { name: "Sale", exact: true }).fill("10");
    await page.getByRole("radio", { name: "Out of stock", exact: true }).check();
    expect((await save()).toast.type).toBe("success");
    await expect(page.getByRole("textbox", { name: "Regular", exact: true })).toHaveValue("12.00");
    expect(raw("catalog_prices")[0]).toMatchObject({ regular: { currency: "USD", minor: "1200" }, sale: { currency: "USD", minor: "1000" } });
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
    await page.getByRole("switch", { name: "Manage stock", exact: true }).check();
    await expect(page.getByRole("radio")).toHaveCount(0);
    expect((await save()).toast.type).toBe("success");
    expect(raw("catalog_items")[0].stockManagement).toEqual({ mode: "managed", status: "setup-required" });
    expect((await availability()).status).toBe("availability-unavailable");
    await capture("manage-stock-on");
    await page.reload();
    await page.getByRole("button", { name: "Open Red hat", exact: true }).click();
    await expect(page.getByRole("switch", { name: "Manage stock", exact: true })).toBeChecked();
    await page.getByRole("switch", { name: "Manage stock", exact: true }).uncheck();
    await expect(page.getByRole("radio", { name: "Out of stock", exact: true })).toBeChecked();
    // A new manual choice must survive the same Save that disables management.
    await page.getByRole("radio", { name: "In stock", exact: true }).check();
    const explicit = await save();
    expect(explicit.toast.type).toBe("success");
    const persistedStatus = raw("catalog_manual_availability")[0].status;
    writeFileSync(process.env.COMMERCE_PROOF_ARTIFACTS + "/sandbox-explicit-status.json", JSON.stringify({
      fixture: "synthetic Red hat", transport: "EmDash 0.41.0 / workerd / SQLite",
      dormantBefore: "out-of-stock", response: explicit.toast,
      submittedValues: lastSave.values, persistedStatus,
    }, null, 2) + "\n");
    await capture("sandbox-explicit-status");
    expect(lastSave.values).toMatchObject({ manageStock: false, stockStatus: "in-stock" });
    expect(persistedStatus).toBe("in-stock");
    await page.reload();
    await page.getByRole("button", { name: "Open Red hat", exact: true }).click();
    await expect(page.getByRole("radio", { name: "In stock", exact: true })).toBeChecked();

    // An untouched dormant choice still restores when management is disabled.
    await page.getByRole("radio", { name: "Out of stock", exact: true }).check();
    expect((await save()).toast.type).toBe("success");
    await page.getByRole("switch", { name: "Manage stock", exact: true }).check();
    expect((await save()).toast.type).toBe("success");
    await page.reload();
    await page.getByRole("button", { name: "Open Red hat", exact: true }).click();
    await page.getByRole("switch", { name: "Manage stock", exact: true }).uncheck();
    await expect(page.getByRole("radio", { name: "Out of stock", exact: true })).toBeChecked();
    expect((await save()).toast.type).toBe("success");
    expect(raw("catalog_manual_availability")[0].status).toBe("out-of-stock");

    // Clients that omit manual status must also preserve dormant restoration.
    await page.getByRole("switch", { name: "Manage stock", exact: true }).check();
    expect((await save()).toast.type).toBe("success");
    const omittedValues = { ...lastSave.values, manageStock: false };
    delete omittedValues.stockStatus;
    const omitted = await page.request.post(endpoint, { data: { ...lastSave, values: omittedValues }, headers: { "X-EmDash-Request": "1" } });
    expect((await omitted.json()).data.toast.type).toBe("success");
    expect(raw("catalog_manual_availability")[0].status).toBe("out-of-stock");
    await page.reload();
    await page.getByRole("button", { name: "Open Red hat", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Out of stock", exact: true })).toBeChecked();
    expect(raw("catalog_items")[0].stockManagement).toEqual({ mode: "unmanaged" });
    expect(raw("catalog_prices")[0]).toMatchObject({ regular: { minor: "1200" }, sale: { minor: "1000" } });
    expect(raw("managed_sku_claims")).toHaveLength(0);
    await capture("manage-stock-off");

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
    console.log("sandbox_proof=pass create replay price-refusal stock-toggle settings anonymous-denial unmanaged-without-Inventory; DB=" + filename);
  } finally { await db.destroy(); }
});
