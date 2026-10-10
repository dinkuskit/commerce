import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Kysely, SqliteDialect } from 'kysely';
import { OptionsRepository, PluginStorageRepository } from 'emdash';
import { createCheckoutStore, startCheckout } from '../../dist/features/checkout/index.js';
import { fixture, cart, withSyntheticCheckoutContact } from '../features/checkout/fixture.mjs';

// Orders acceptance on the installed Registry-format artifact. It
// uses canonical checkout writes and synthetic payment outcomes, never a
// payment provider or a production order.
test('installed Orders lists and inspects canonical orders and denies non-managers', async ({ page, request, browser }) => {
  expect((await request.get('/_emdash/api/setup/dev-bypass')).status()).toBe(200);
  const pluginId = process.env.COMMERCE_COUPON_PLUGIN_ID;
  const profile = await request.post('/__proof/install');
  expect(profile.status()).toBe(200);
  writeFileSync(resolve(process.env.COMMERCE_PROOF_ARTIFACTS, 'installed-profile.json'), JSON.stringify(await profile.json(), null, 2));
  const database = new Database(process.env.COMMERCE_PROOF_DB.slice(5));
  const db = new Kysely({ dialect: new SqliteDialect({ database }) });
  const capture = name => page.screenshot({ path: resolve(process.env.COMMERCE_PROOF_ARTIFACTS, name + '.png'), fullPage: true, animations: 'disabled' });
  const endpoint = `/_emdash/api/plugins/${pluginId}/admin`;
  const path = `/_emdash/admin/plugins/${pluginId}/`;
  const interact = async (label) => {
    const response = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === 'POST');
    await page.getByRole('button', { name: label, exact: true }).click();
    const received = await response;
    expect(received.status()).toBe(200);
    return { body: (await received.json()).data, input: received.request().postDataJSON() };
  };
  try {
    await page.goto('/_emdash/api/auth/dev-bypass?redirect=' + path + 'orders');
    await page.getByRole('button', { name: 'Get Started' }).click({ timeout: 60000 });
    const orders = new PluginStorageRepository(db, pluginId, 'checkout_carts', []);
    await expect(page.getByText('No orders recorded yet.', { exact: true })).toBeVisible();
    await capture('orders-empty');
    const f = fixture(createCheckoutStore(orders), false);
    f.setPayment('paid');
    const paid = await startCheckout(f.execution, 'orders-paid', withSyntheticCheckoutContact(cart));
    expect(paid.phase).toBe('paid');
    for (const price of f.execution.catalog.prices.records.values()) { price.regular.minor = '0'; delete price.sale; }
    const free = await startCheckout(f.execution, 'orders-free', withSyntheticCheckoutContact(cart));
    expect(free.phase).toBe('paid');
    const snapshot = () => database.prepare("SELECT data FROM _plugin_storage WHERE plugin_id=? AND collection='checkout_carts' ORDER BY id").all(pluginId);
    const original = snapshot();
    // Installed transport denial is distinct from controller-only unit proof.
    const deniedInputs = [{ type: 'page_load', page: '/orders' },
      { type: 'block_action', page: '/orders', action_id: 'orders.open:' + encodeURIComponent(paid.order.orderId) }];
    const guestOrders = await browser.newContext();
    for (const input of deniedInputs) {
      const response = await guestOrders.request.post(new URL(endpoint, test.info().project.use.baseURL).href,
        { headers: { 'X-EmDash-Request': '1' }, data: input });
      expect([401, 403]).toContain(response.status());
      expect(await response.text()).not.toContain(paid.order.receiptId);
    }
    await guestOrders.close();
    database.prepare('UPDATE users SET role=40').run();
    for (const input of deniedInputs) {
      const response = await page.request.post(endpoint, { headers: { 'X-EmDash-Request': '1' },
        data: { ...input, user: { role: 50 }, ui: { surface: 'admin-page' } } });
      expect(await response.text()).toContain('Orders require plugins:manage');
    }
    await page.reload();
    await expect(page.getByText('Orders require plugins:manage', { exact: true })).toBeVisible({ timeout: 60000 });
    await capture('orders-editor-denied');
    database.prepare('UPDATE users SET role=50').run();
    expect(snapshot()).toEqual(original);
    const matrix = [{ actor: 'Orders anonymous and forged editor', result: 'list/detail denied; canonical storage unchanged' }];
    await page.reload();
    // Orders numbers each copy it keeps; people see the short number, the order id stays on the detail.
    const kept = new PluginStorageRepository(db, pluginId, 'orders', []);
    await expect(page.getByRole('button', { name: /^Inspect #100[12]$/ }).first()).toBeVisible({ timeout: 60000 });
    const inspect = async order => 'Inspect #' + (await kept.get(order.orderId)).number;
    expect([(await kept.get(paid.order.orderId)).number, (await kept.get(free.order.orderId)).number].sort()).toEqual([1001, 1002]);
    await capture('orders-list-desktop');
    const open = page.getByRole('button', { name: await inspect(paid.order), exact: true });
    await open.focus(); await page.keyboard.press('Enter');
    await expect(page.getByText('Receipt: ' + paid.order.receiptId)).toBeVisible();
    await expect(page.getByText('Checkout attempt: ' + paid.order.attemptId)).toBeVisible();
    await expect(page.getByText('Payment: Provider-paid')).toBeVisible();
    await expect(page.getByText('USD 2.50', { exact: true })).toBeVisible();
    await expect(page.getByText('Fulfillment: Not recorded')).toBeVisible();
    await expect(page.getByText('Order ID: ' + paid.order.orderId)).toBeVisible();
    await expect(page.getByText('Version: 1')).toBeVisible();
    await capture('orders-provider-detail');
    // The owner corrects the address; Checkout's frozen copy stays and the version goes up.
    // A corrected address must go to one of the store's shipping countries.
    await new OptionsRepository(db).compareAndSet('plugin:' + pluginId + ':settings:merchantStoreSettings', null, { recordKind: 'merchant-store-settings',
      storeCountry: 'US', sellingCountries: ['US'], shippingCountries: ['US'], requirePhoneNumber: false });
    await interact('Correct address');
    await page.getByLabel('Address line 1').fill('2 Corrected Road');
    await capture('orders-address-form');
    await interact('Save address');
    await expect(page.getByText('Address saved', { exact: true })).toBeVisible();
    await expect(page.getByText(/2 Corrected Road.*\(corrected\)/)).toBeVisible();
    await expect(page.getByText('Version: 2')).toBeVisible();
    await capture('orders-address-corrected');
    expect((await kept.get(paid.order.orderId)).delivery.line1).toBe('2 Corrected Road');
    await interact('Back to orders');
    await interact(await inspect(free.order));
    await expect(page.getByText('Payment: Zero payable — no payment required')).toBeVisible();
    await expect(page.getByText('USD 0.00', { exact: true }).last()).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await capture('orders-zero-mobile');
    await interact('Back to orders');
    expect(snapshot()).toEqual(original);
    // The page read Orders' own copies, brought in from Checkout the first time it found none.
    expect((await kept.get(paid.order.orderId)).paidOrder).toEqual({ schema: 'dinkuskit.commerce.paid-order/v1', ...paid.order });
    // A malformed Checkout aggregate fails Bring in missing orders closed.
    await orders.compareAndSet('orders-invalid', null, { attempts: null });
    await interact('Bring in missing orders');
    await expect(page.getByText('Orders unavailable', { exact: true })).toBeVisible({ timeout: 60000 });
    await orders.delete('orders-invalid');
    // A malformed kept copy is not an empty shop and must fail closed.
    await kept.compareAndSet('order:invalid', null, { paidOrder: null });
    await page.reload();
    await expect(page.getByText('Orders unavailable', { exact: true })).toBeVisible({ timeout: 60000 });
    await capture('orders-unavailable');
    await kept.delete('order:invalid');
    await page.reload();
    await interact('Bring in missing orders');
    await expect(page.getByText('No missing orders', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: await inspect(paid.order), exact: true })).toBeVisible({ timeout: 60000 });
    await page.setViewportSize({ width: 1440, height: 1000 });
    writeFileSync(resolve(process.env.COMMERCE_PROOF_ARTIFACTS, 'orders-canonical.json'), JSON.stringify({ paid: paid.order, free: free.order }, null, 2));
    writeFileSync(resolve(process.env.COMMERCE_PROOF_ARTIFACTS, 'http-matrix.json'), JSON.stringify(matrix, null, 2));
  } finally { await db.destroy(); }
});
