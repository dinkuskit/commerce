import { expect } from "@playwright/test";

// The Dinkus Commerce panel lives on each Content > Products page. Stores get
// that collection from their template; the proof site makes it here.
const headers = { "X-EmDash-Request": "1" };

async function ok(response) {
  const body = await response.json().catch(() => ({}));
  expect(response.ok(), JSON.stringify(body)).toBe(true);
  return body.data;
}

export async function ensureProductsCollection(request) {
  const collections = await ok(await request.get("/_emdash/api/schema/collections", { headers }));
  const list = collections.items ?? collections.collections ?? collections;
  if (Array.isArray(list) && list.some((collection) => collection.slug === "products")) return;
  await ok(await request.post("/_emdash/api/schema/collections", { headers, data: { slug: "products", label: "Products", labelSingular: "Product" } }));
  for (const [slug, label] of [["title", "Title"], ["commerce_item_id", "Commerce product"]]) {
    await ok(await request.post("/_emdash/api/schema/collections/products/fields", { headers, data: { slug, label, type: "string", validation: null } }));
  }
}

/** Makes a saved product page and opens its editor with the Dinkus Commerce panel open. */
export async function openProductPage(page, title) {
  await ensureProductsCollection(page.request);
  const created = await ok(await page.request.post("/_emdash/api/content/products", { headers, data: { data: { title } } }));
  const id = (created.item ?? created).id;
  await page.goto("/_emdash/admin/content/products/" + id);
  const panel = await openPanel(page);
  return { id, panel, endpoint: "/_emdash/api/content/products/" + id + "/plugin-extensions/dinkus-commerce/panel/product" };
}

/** Opens the Dinkus Commerce panel on the editor already showing and returns its container. */
export async function openPanel(page) {
  const trigger = page.getByLabel("Settings", { exact: true }).getByRole("button", { name: "Dinkus Commerce", exact: true });
  // On a phone the editor's settings sidebar opens from its Settings button.
  const settings = page.getByRole("main").getByRole("button", { name: "Settings", exact: true });
  await expect(trigger.or(settings).first()).toBeVisible({ timeout: 60000 });
  if (!(await trigger.isVisible())) await settings.click();
  await trigger.click({ timeout: 60000 });
  const panel = trigger.locator("xpath=..");
  await expect(panel.getByText(/Not for sale yet|SKU /).first()).toBeVisible({ timeout: 30000 });
  return panel;
}

/** Opens the Product image & gallery panel beside the Dinkus Commerce one (catalog-media-panel-20261027). */
export async function openMediaPanel(page) {
  const trigger = page.getByLabel("Settings", { exact: true }).getByRole("button", { name: "Product image & gallery", exact: true });
  const settings = page.getByRole("main").getByRole("button", { name: "Settings", exact: true });
  await expect(trigger.or(settings).first()).toBeVisible({ timeout: 60000 });
  if (!(await trigger.isVisible())) await settings.click();
  await trigger.click({ timeout: 60000 });
  const panel = trigger.locator("xpath=..");
  await expect(panel.getByText(/^Product image$|Dinkus Commerce panel first/).first()).toBeVisible({ timeout: 30000 });
  return panel;
}

export async function readProductPage(request, id) {
  const body = await ok(await request.get("/_emdash/api/content/products/" + id, { headers }));
  return body.item ?? body;
}

/** What a store's publish check sends when a product page is published, unpublished or deleted. */
export async function setOnSale(request, body) {
  return ok(await request.post("/_emdash/api/plugins/dinkus-commerce/catalog-items/set-on-sale", { headers, data: body }));
}

/** Opens an existing product page by its title. */
export async function openProductPageTitled(page, title) {
  const listed = await ok(await page.request.get("/_emdash/api/content/products?limit=100", { headers }));
  const found = (listed.items ?? listed).find((item) => item.data?.title === title || item.title === title);
  expect(found, title).toBeTruthy();
  await page.goto("/_emdash/admin/content/products/" + found.id);
  return { id: found.id, panel: await openPanel(page), endpoint: "/_emdash/api/content/products/" + found.id + "/plugin-extensions/dinkus-commerce/panel/product" };
}

/** Presses the editor's Save and waits for the open panel to reload against the saved page. */
export async function saveEditor(page) {
  const reloaded = page.waitForResponse((r) => r.url().includes("/plugin-extensions/dinkus-commerce/panel/product") && r.request().postDataJSON()?.type === "panel_load", { timeout: 15000 });
  await page.locator(`button[aria-label="Save"]`).click();
  await reloaded;
}
