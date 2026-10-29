import { test, expect } from "@playwright/test";
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    await page.screenshot({ path: process.env.COMMERCE_SETTINGS_ARTIFACTS + "/" + info.project.name + "-failure.png", animations: "disabled" });
  }
});
const headers = { "X-EmDash-Request": "1" };
test("merchant settings persist independently and reject stale or unauthorized writes", async ({ page, request, browser }, info) => {
  page.on("pageerror", error => console.log("Browser script error:", error.message.slice(0, 500)));
  const endpoint = "/_emdash/api/plugins/dinkus-commerce/admin";
  const adminPath = "/_emdash/admin/plugins/dinkus-commerce/settings";
  expect((await request.get("/_emdash/api/setup/dev-bypass")).status()).toBe(200);
  await page.goto("/_emdash/api/auth/dev-bypass?redirect=" + adminPath);
  const getStarted = page.getByRole("button", { name: "Get Started", exact: true });
  await getStarted.click({ timeout: 90000 });
  const store = page.getByRole("textbox", { name: "Store country (ISO alpha-2 code)", exact: true });
  const shipping = page.getByRole("textbox", { name: "Allowed physical shipping destinations (comma-separated codes)", exact: true });
  const phone = page.getByRole("switch", { name: /Require a phone number/ });
  // A document reload can finish before the EmDash app and Block Kit form mount.
  // Use the same bounded readiness window as the initial load, then assert saved values.
  const reloadSettings = async () => {
    await page.reload();
    await expect(store).toBeVisible({ timeout: 60000 });
  };
  const save = async () => {
    const wait = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === "POST");
    await page.getByRole("button", { name: "Save merchant settings", exact: true }).click();
    const response = await wait;
    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.success).toBe(true);
    return { body: result.data, input: response.request().postDataJSON() };
  };
  const capture = name => page.screenshot({ path: process.env.COMMERCE_SETTINGS_ARTIFACTS + "/" + info.project.name + "-" + name + ".png", fullPage: true });
  await expect(store).toHaveValue("", { timeout: 60000 });
  await expect(phone).not.toBeChecked();
  await expect(page.getByText("Checkout refuses a physical delivery outside your shipping destinations.", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /selling/i })).toHaveCount(0);
  await capture("unconfigured");
  await phone.check();
  await save();
  await reloadSettings();
  await expect(store).toHaveValue("");
  await expect(phone).toBeChecked();
  await store.fill("ca");
  await save();
  await expect(store).toHaveValue("CA");
  await expect(shipping).toHaveValue("CA");
  await shipping.fill("GB");
  const stale = (await save()).input;
  await store.fill("GB");
  await save();
  await expect(shipping).toHaveValue("GB");
  await phone.uncheck();
  await save();
  await reloadSettings();
  await expect(phone).not.toBeChecked();
  await expect(store).toHaveValue("GB");
  await expect(shipping).toHaveValue("GB");
  await capture("saved");
  const replay = await page.request.post(endpoint, { data: { ...stale, values: { ...stale.values, storeCountry: "AU", requirePhoneNumber: true } }, headers });
  const refusal = await replay.json();
  expect(refusal.data.blocks.some(b => b.type === "banner" && b.variant === "error")).toBe(true);
  const retained = refusal.data.blocks.find(b => b.type === "form" && b.block_id.startsWith("merchant-store-settings:"));
  expect(retained.block_id).toBe(stale.block_id);
  await reloadSettings();
  await expect(store).toHaveValue("GB");
  await expect(phone).not.toBeChecked();
  await store.fill("ZZ");
  await save();
  await expect(store).toHaveValue("ZZ");
  await expect(page.getByText(/not a recognized country code/).first()).toBeVisible();
  await capture("invalid-input");
  const anonymous = await browser.newContext();
  const denied = await anonymous.request.post(new URL(endpoint, info.project.use.baseURL).href, { data: stale, headers });
  expect([401, 403]).toContain(denied.status());
  await anonymous.close();
  await reloadSettings();
  await expect(store).toHaveValue("GB");
  if (process.env.COMMERCE_SETTINGS_CONTROLLED_FAILURE === "1") expect("synthetic controlled failure").toBe("pass");
  // Native and Registry installs show the same Commerce settings page.
  await expect(page.getByRole("switch", { name: "Hide out-of-stock products", exact: true })).toBeVisible();
});
