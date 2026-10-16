import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await page.screenshot({ path: resolve(process.env.LOCAL_MERCHANT_DIRECTORY, 'failure.png'), fullPage: true });
});
// Runtime assertions deliberately use UI and supported HTTP boundaries only.
test('merchant configures catalog, connects Payments and observes one durable paid fixture order', async ({ page, request, browser, baseURL }) => {
  const run = process.env.LOCAL_MERCHANT_RUN;
  const dir = process.env.LOCAL_MERCHANT_DIRECTORY;
  const capture = name => page.screenshot({ path: resolve(dir, name + '.png'), fullPage: true, animations: 'disabled' });
  expect((await request.get('/_emdash/api/setup/dev-bypass')).status()).toBe(200);
  const boot = await request.post('/fixture?action=bootstrap');
  expect(boot.status()).toBe(200); expect(await boot.json()).toEqual({ seeded: true, sandboxAvailable: true });
  const commerce = '/_emdash/admin/plugins/dinkus-commerce/';
  await page.goto('/_emdash/api/auth/dev-bypass?redirect=' + commerce + 'settings');
  await page.getByRole('button', { name: 'Get Started', exact: true }).click({ timeout: 60000 });
  await page.getByRole('textbox', { name: 'Store country (ISO alpha-2 code)', exact: true }).fill('US');
  const saved = page.waitForResponse(r => r.url().endsWith('/dinkus-commerce/admin') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save merchant settings', exact: true }).click(); await saved;
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Store country (ISO alpha-2 code)', exact: true })).toHaveValue('US');
  await page.goto(commerce + 'products');
  await expect(page.getByText('No products yet', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Fixture parcel ' + run);
  await page.getByRole('textbox', { name: 'SKU', exact: true }).fill('FIXTURE-' + run);
  await page.getByRole('radio', { name: 'Physical', exact: true }).check();
  const added = page.waitForResponse(r => r.url().endsWith('/dinkus-commerce/admin') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  const addedResult = await (await added).json(); expect(addedResult.data.toast?.type, JSON.stringify(addedResult.data.toast)).toBe('success');
  await page.getByRole('textbox', { name: 'Regular', exact: true }).fill('12');
  await page.getByRole('radio', { name: 'In stock', exact: true }).check();
  const priced = page.waitForResponse(r => r.url().endsWith('/dinkus-commerce/admin') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await priced;
  await capture('catalog');
  await page.goto('/_emdash/admin/plugins/r_3brsc2on3bu673rn/status');
  await expect(page.getByRole('heading', { name: 'Payment setup', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Authorize Payments at DinkusKit' })).toBeVisible();
  // The local issuer fixture authorizes this single connection; the plugin performs exchange/JWKS validation.
  await expect(async () => {
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Check connection', exact: true })).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 10000, intervals: [1100] });
  await page.getByRole('button', { name: 'Check connection', exact: true }).click();
  await expect(page.getByText(/Stripe is connected for TEST payments only/)).toBeVisible();
  await expect(page.getByText(/Commerce saved it/)).toHaveCount(0);
  await capture('payments-connected-fixture');

  const guest = await browser.newContext();
  const shop = await guest.newPage();
  await shop.goto(baseURL);
  await expect(shop.getByRole('option', { name: 'Fixture parcel ' + run })).toHaveCount(1);
  await shop.getByLabel('Email', { exact: true }).fill('buyer-' + run + '@example.invalid');
  for (const [label, value] of [['Recipient', 'Local Fixture'], ['Address line 1', '1 Test Road'], ['City', 'Testville'], ['Postal code', '10001'], ['Country', 'US']]) {
    await shop.getByLabel(label, { exact: true }).fill(value);
  }
  await shop.getByRole('button', { name: 'Prepare checkout', exact: true }).click();
  await expect(shop.locator('#state')).toHaveText('Prepared');
  await shop.getByRole('button', { name: 'Start checkout', exact: true }).click();
  await expect(shop.locator('#state')).toHaveText('Payment pending');
  await shop.getByRole('button', { name: 'Simulate provider payment', exact: true }).click();
  await expect(shop.locator('#state')).toHaveText('Fixture provider paid; Commerce pending');
  await page.reload();
  await expect(page.getByText(/Waiting for Commerce to save it/)).toBeVisible();
  await expect(page.getByText(/Commerce saved it/)).toHaveCount(0);
  await shop.getByRole('button', { name: 'Refresh payment status', exact: true }).click();
  await expect(shop.locator('#state')).toHaveText('paid');
  await shop.screenshot({ path: resolve(dir, 'guest-paid-fixture.png'), fullPage: true });
  await guest.close();

  await page.goto(commerce + 'orders');
  const inspect = page.getByRole('button', { name: /^Inspect #\d+ \(TEST\)$/ });
  await expect(inspect).toHaveCount(1);
  const orderLabel = await inspect.innerText();
  await inspect.click();
  await expect(page.getByRole('main')).toContainText('Status: Processing');
  await expect(page.getByRole('main')).toContainText('Payment: Provider-paid');
  await expect(page.getByRole('main')).toContainText(/Order total\s*USD 12\.00/);
  const detail = await page.getByRole('main').innerText();
  const receiptText = 'Receipt: ' + detail.match(/Receipt:\s*(\S+)/)[1];
  const attemptText = 'Checkout attempt: ' + detail.match(/Checkout attempt:\s*(\S+)/)[1];
  await capture('order-detail-fixture');
  // Reopen the UI to prove persistence and dedupe through normal order synchronization.
  await page.goto(commerce + 'orders'); await expect(inspect).toHaveCount(1); await inspect.click();
  await expect(page.getByRole('main')).toContainText(receiptText);
  const wake = await request.post('/fixture?action=wake');
  expect(wake.status()).toBe(200);
  expect((await wake.json()).acknowledged).toBe(true);
  await page.goto('/_emdash/admin/plugins/r_3brsc2on3bu673rn/status');
  await page.getByRole('button', { name: 'Check connection', exact: true }).click();
  await expect(page.getByText(/Commerce saved it/)).toBeVisible();
  await capture('payments-commerce-recorded-fixture');
  const receipt = await (await request.get('/fixture')).json();
  expect(receipt.connectionStarts).toBe(1); expect(receipt.sessions).toHaveLength(1);
  expect(receipt.sessions[0]).toMatchObject({ paid: true, total: { currency: 'USD', minor: '1200' } });
  expect(attemptText).toContain(receipt.sessions[0].attemptId);
  expect(receipt.acknowledged).toBe(true);
  const anonymous = await browser.newContext();
  for (const plugin of ['dinkus-commerce', 'r_3brsc2on3bu673rn']) {
    const denied = await anonymous.request.post(`${baseURL}/_emdash/api/plugins/${plugin}/admin`, {
      data: { type: 'page_load', page: plugin === 'dinkus-commerce' ? '/orders' : '/status' }, headers: { 'X-EmDash-Request': '1' } });
    expect([401, 403]).toContain(denied.status());
  }
  await anonymous.close();
  writeFileSync(resolve(dir, 'observable-state.json'), JSON.stringify({ ...receipt, chromium: browser.version(), orderLabel, receiptText, attemptText,
    result: 'PASS_LOCAL_FIXTURE', shipping: 'UNVERIFIED: no hosted Ship/PB/label/PDF/tracking action' }, null, 2));
});
