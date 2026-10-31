import { expect } from "@playwright/test";

// The Dinkus Commerce panel lives on each Content > Products page. Stores get
// that collection from their template; the proof site makes it here, with the
// Commerce product field older templates had, so older pages can be made too.
// Commerce never reads it (catalog-page-link-in-commerce-20261029).
const headers = { "X-EmDash-Request": "1" };

// EmDash 1.4 renders a Block Kit form block as a group of fields named after
// its submit button, not an HTML <form> (emdash-cms/emdash#4183).
export const BLOCK_FORM = '[role="group"]';

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
  await expect(panel.getByText(/Save makes the product|Pricing & stock|^Archived: off the shop$/).first()).toBeVisible({ timeout: 30000 });
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

/**
 * Opens one of the panel's cards (a Block Kit accordion: Variants, Shipping, Identifiers, Edit options, a variant's
 * card and so on) when it is collapsed, and returns it. `label` is the card's label, or a pattern for a label that
 * carries a count or a price. A panel redraw after any save collapses the cards again.
 */
export async function openCard(panel, label) {
  const trigger = panel.getByRole("button", { name: label, exact: typeof label === "string" }).first();
  await expect(trigger).toBeVisible({ timeout: 30000 });
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  return trigger;
}
