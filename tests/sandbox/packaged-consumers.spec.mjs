import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const headers = { 'X-EmDash-Request': '1' };
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await page.screenshot({
    path: resolve(process.env.COMMERCE_CONSUMER_EVIDENCE, 'registry-failure.png'), animations: 'disabled' });
});

async function install(request) {
  expect((await request.get('/_emdash/api/setup/dev-bypass')).status()).toBe(200);
  const response = await request.post('/__proof/install');
  expect(response.status()).toBe(200);
  const profile = await response.json();
  const identity = JSON.parse(readFileSync(resolve(process.env.COMMERCE_PROOF_ARTIFACTS, 'artifact.json')));
  expect(profile.backendSha256).toBe(identity.runtimeSha256);
  expect(profile.source).toBe('registry');
  expect(profile.configuredCommerce).toBe(false);
}

test('extracted Registry settings persist and anonymous writes leave canonical settings unchanged', async ({ page, request, browser, baseURL }) => {
  await install(request);
  const id = process.env.COMMERCE_COUPON_PLUGIN_ID;
  const endpoint = `/_emdash/api/plugins/${id}/admin`;
  await page.goto(`/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/plugins/${id}/settings`);
  const store = page.getByRole('textbox', { name: 'Store country (ISO alpha-2 code)', exact: true });
  const selling = page.getByRole('textbox', { name: 'Allowed selling/customer countries (comma-separated codes)', exact: true });
  const welcome = page.getByRole('button', { name: 'Get Started', exact: true });
  await store.or(welcome).first().waitFor({ timeout: 60000 });
  if (await welcome.isVisible()) await welcome.click();
  await expect(store).toBeVisible({ timeout: 60000 });
  await store.fill('CA'); await selling.fill('CA, MX');
  await page.getByRole('textbox', { name: 'Allowed physical shipping destinations (comma-separated codes)', exact: true }).fill('CA');
  const saved = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save merchant settings', exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(200);
  const input = response.request().postDataJSON();
  await page.reload();
  await expect(store).toHaveValue('CA'); await expect(selling).toHaveValue('CA, MX');
  const db = new Database(process.env.COMMERCE_PROOF_DB.slice(5));
  try {
    const snapshot = () => db.prepare('SELECT value, revision FROM options WHERE name=?').get(`plugin:${id}:settings:merchantStoreSettings`);
    const original = snapshot(); expect(original).toBeDefined();
    const anonymous = await browser.newContext();
    try {
      const denied = await anonymous.request.post(new URL(endpoint, baseURL).href, {
        headers, data: { ...input, values: { ...input.values, storeCountry: 'GB' } } });
      expect([401, 403]).toContain(denied.status());
      expect(snapshot()).toEqual(original);
    } finally { await anonymous.close(); }
    await page.reload(); await expect(store).toHaveValue('CA');
    await page.screenshot({ path: resolve(process.env.COMMERCE_CONSUMER_EVIDENCE, 'registry-settings.png'), animations: 'disabled' });
  } finally { db.close(); }
});

test('extracted Registry guest checkout prepares and fails closed without Payments, denying foreign origins before storage', async ({ request, baseURL }) => {
  await install(request);
  const id = process.env.COMMERCE_COUPON_PLUGIN_ID;
  const db = new Database(process.env.COMMERCE_PROOF_DB.slice(5));
  const endpoint = `/_emdash/api/plugins/${id}/checkout/guest/`;
  const origin = new URL(baseURL).origin;
  const count = collection => db.prepare('SELECT COUNT(*) AS n FROM _plugin_storage WHERE plugin_id=? AND collection=?').get(id, collection).n;
  try {
    const caps = count('checkout_guest_capabilities'), carts = count('checkout_carts');
    const denied = await request.post(endpoint + 'prepare', { data: {}, headers: { origin: 'https://foreign.example.test', 'sec-fetch-site': 'cross-site' } });
    expect(denied.ok()).toBe(false);
    expect(count('checkout_guest_capabilities')).toBe(caps); expect(count('checkout_carts')).toBe(carts);
    const sameOrigin = { origin, 'sec-fetch-site': 'same-origin' };
    const prepared = await request.post(endpoint + 'prepare', { data: {}, headers: sameOrigin });
    const raw = await prepared.json(); const payload = raw.data ?? raw;
    expect(payload.ok).toBe(true);
    expect(typeof payload.capability?.capability).toBe('string');
    expect(count('checkout_guest_capabilities')).toBe(caps + 1);
    // A valid synthetic unmanaged product makes this a missing-provider test,
    // rather than an invalid-item rejection. No service connection is configured.
    const insert = db.prepare('INSERT OR REPLACE INTO _plugin_storage (plugin_id,collection,id,data,created_at,updated_at) VALUES (?,?,?,?,?,?)');
    const item = 'packaged-consumer-hat'; const now = '2026-10-11T00:00:00Z';
    for (const [collection, data] of [
      ['catalog_items', { recordKind: 'catalog-item', itemId: item, commandId: 'catalog:create:' + item,
        creationIntent: { manageStock: false }, kind: 'simple-product', name: 'Synthetic packaged hat', sku: 'PACKAGED-HAT', skuKey: 'PACKAGED-HAT', stockManagement: { mode: 'unmanaged' }, state: 'draft', createdAt: now }],
      ['catalog_prices', { recordKind: 'catalog-price', recordId: item, catalogItemId: item, regular: { currency: 'USD', minor: '250' } }],
      ['catalog_manual_availability', { recordKind: 'catalog-manual-availability', recordId: item, catalogItemId: item, status: 'in-stock' }],
    ]) insert.run(id, collection, item, JSON.stringify(data), now, now);
    const started = await request.post(endpoint + 'start', { headers: { ...sameOrigin, 'x-commerce-guest-capability': payload.capability.capability },
      data: { contact: { email: 'consumer@example.test' }, lines: [{ catalogItemId: item, quantity: 1 }] } });
    const result = await started.json();
    expect((result.data ?? result).error?.code).toBe('PAYMENTS_UNAVAILABLE');
    expect(started.headers()['set-cookie']).toBeUndefined();
    expect(count('checkout_carts')).toBe(carts);
  } finally { db.close(); }
});
