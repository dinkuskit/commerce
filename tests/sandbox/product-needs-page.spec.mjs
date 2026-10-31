import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureProductsCollection, openPanel, openProductPage } from "./product-page.mjs";

// Every product is made for its page (catalog-product-needs-page-20261031), on the Registry build in real workerd:
// the catalog API refuses a product without a page and has no op to give one a page later, the CLI makes the page and
// then the product with one command, and the panel and Commerce settings offer nothing for products without a page.
const BIN = fileURLToPath(new URL("../../bin/dinkus-commerce.mjs", import.meta.url));
const headers = { "X-EmDash-Request": "1" };

function cli(baseURL, token, argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, "--url", baseURL, ...argv, "--json"], {
      env: { ...process.env, HOME: "/nonexistent-home", XDG_CONFIG_HOME: "/nonexistent-home", EMDASH_TOKEN: token },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr, json: JSON.parse(stdout) }));
  });
}

test("every product is made for its page: catalog API, CLI, panel and settings", async ({ page, request }) => {
  const baseURL = test.info().project.use.baseURL;
  expect((await request.get("/_emdash/api/setup/dev-bypass")).status()).toBe(200);
  const database = new Database(process.env.COMMERCE_PROOF_DB.slice(5));
  const capture = (name) => page.screenshot({ path: process.env.COMMERCE_PROOF_ARTIFACTS + "/needs-page-" + name + ".png", animations: "disabled", fullPage: true });
  const pages = () => database.prepare("SELECT id, data FROM _plugin_storage WHERE plugin_id = 'dinkus-commerce' AND collection = 'product_pages'").all().map((row) => [row.id, JSON.parse(row.data)]);
  const items = () => database.prepare("SELECT count(*) AS n FROM _plugin_storage WHERE plugin_id = 'dinkus-commerce' AND collection = 'catalog_items'").get().n;
  try {
    await expect.poll(() => database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get("uidx_plugin_dinkus-commerce_catalog_items_skuKey"), { timeout: 90000 }).toBeTruthy();
    await page.goto("/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/plugins/dinkus-commerce/settings");
    const started = page.getByRole("button", { name: "Get Started" });
    await started.or(page.getByRole("heading", { name: "Commerce settings" })).first().waitFor({ state: "visible", timeout: 60000 });
    if (await started.isVisible()) await started.click();
    await ensureProductsCollection(page.request);

    // 1. The catalog API: no product without a page, and no op to give one a page later.
    const catalog = (data) => page.request.post("/_emdash/api/plugins/dinkus-commerce/catalog", { headers, data });
    const before = items();
    const pageless = await catalog({ op: "create", commandId: "pageless", name: "Pageless", sku: "PAGELESS" });
    expect(pageless.status()).toBe(400);
    expect(await pageless.text()).toContain("entryId is required: make the product's page first");
    const link = await catalog({ op: "link", catalogItemId: "any", entryId: "any" });
    expect(link.status()).toBe(400);
    expect(await link.text()).toContain("Invalid catalog request");
    expect(items()).toBe(before);

    // 2. The CLI makes the page, then the product for it, with one command; a retry finds both again.
    const token = await page.request.post("/_emdash/api/admin/api-tokens", { headers, data: { name: "needs-page proof", scopes: ["admin", "content:read", "content:write"] } });
    expect(token.status(), await token.text()).toBe(201);
    const secret = (await token.json()).data.token;
    const create = ["products", "create", "--name", "Page-first hat", "--sku", "PF-HAT", "--command-id", "pf-hat"];
    const made = await cli(baseURL, secret, create);
    expect(made.code, made.stderr).toBe(0);
    const { catalogItemId, entryId, pageMade } = made.json.data;
    expect(pageMade).toBe(true);
    const entry = (await (await page.request.get("/_emdash/api/content/products/page-first-hat", { headers })).json()).data;
    expect((entry.item ?? entry).id).toBe(entryId);
    expect((entry.item ?? entry).data?.title ?? (entry.item ?? entry).title).toBe("Page-first hat");
    expect(pages()).toContainEqual(["e:" + entryId, { entryId, catalogItemId }]);
    const again = await cli(baseURL, secret, create);
    expect(again.code, again.stderr).toBe(0);
    expect([again.json.data.catalogItemId, again.json.data.entryId, again.json.data.pageMade]).toEqual([catalogItemId, entryId, false]);
    const taken = await cli(baseURL, secret, ["products", "create", "--name", "Second hat", "--sku", "PF-HAT-2", "--command-id", "pf-hat-2", "--slug", "page-first-hat"]);
    expect(taken.code).toBe(1);
    expect(taken.json.error.message).toContain("This page already sells a product");
    const gone = await cli(baseURL, secret, ["products", "link", catalogItemId, "--page", entryId, "--dry-run"]);
    expect(gone.code).toBe(2);

    // 3. The page the CLI made opens on its product in the panel.
    await page.goto("/_emdash/admin/content/products/" + entryId);
    const panel = await openPanel(page);
    await expect(panel.getByText("PF-HAT", { exact: true }).first()).toBeVisible();
    await capture("1-cli-page-panel");

    // 4. A new page opens on its price form, whose Save makes the product: no list of other products to sell here.
    const fresh = await openProductPage(page, "Fresh tee");
    await expect(fresh.panel.getByRole("textbox", { name: "Regular", exact: true })).toBeVisible();
    await expect(fresh.panel.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expect(fresh.panel.getByRole("button", { name: "Sell it here", exact: true })).toHaveCount(0);
    await expect(fresh.panel.getByText("Or one without a page")).toHaveCount(0);
    await expect(fresh.panel.getByRole("textbox", { name: "Or its SKU", exact: true })).toHaveCount(0);
    await capture("2-new-page-panel");

    // 5. Commerce settings has no "Products without a page" section.
    await page.goto("/_emdash/admin/plugins/dinkus-commerce/settings");
    await expect(page.getByRole("switch", { name: "Hide out-of-stock products", exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole("heading", { name: "Products without a page" })).toHaveCount(0);
    await capture("3-settings");
  } finally {
    database.close();
  }
});
