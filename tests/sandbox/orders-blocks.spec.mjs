import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Kysely, SqliteDialect } from 'kysely';
import { OptionsRepository, PluginStorageRepository } from 'emdash';
import { createCheckoutStore, startCheckout } from '../../dist/features/checkout/index.js';
import { fixture, cart, withSyntheticCheckoutContact } from '../features/checkout/fixture.mjs';
import { createPaidOrderReceiver } from '../../dist/features/orders/index.js';

// Inspectable rendering evidence from the real installed Orders entry point.
// Synthetic receiver-admitted records only; no intercepted admin responses.
async function proveFrozenItemChoices({ page, request }) {
  expect((await request.get('/_emdash/api/setup/dev-bypass')).status()).toBe(200);
  expect((await request.post('/__proof/install')).status()).toBe(200);
  const pluginId = process.env.COMMERCE_COUPON_PLUGIN_ID;
  const database = new Database(process.env.COMMERCE_PROOF_DB.slice(5));
  const db = new Kysely({ dialect: new SqliteDialect({ database }) });
  const path = `/_emdash/admin/plugins/${pluginId}/orders`;
  const kept = new PluginStorageRepository(db, pluginId, 'orders', []);
  const numbers = new PluginStorageRepository(db, pluginId, 'order_numbers', []);
  const usd = minor => ({ currency: 'USD', minor });
  const mediumText = 'Size: M · Color: Frozen storm blue with the original checkout label';
  const choice = (catalogItemId, size, color) => ({ schema: 'dinkuskit.commerce.checkout-variant-selection/v1',
    productId: 'fixture-shirt', catalogItemId, fulfillment: 'physical', selections: [
      { optionId: 'size', optionLabel: 'Size', valueId: size.toLowerCase(), valueLabel: size },
      ...(color ? [{ optionId: 'color', optionLabel: 'Color', valueId: 'blue', valueLabel: color }] : [])] });
  try {
    const order = { schema: 'dinkuskit.commerce.paid-order/v1', orderId: 'proof-frozen-choices',
      receiptId: 'receipt-proof-frozen-choices', attemptId: 'attempt-proof-frozen-choices',
      mode: 'test', paymentId: 'synthetic-payment-frozen-choices', paidAt: '2090-01-01T00:00:00.000Z',
      lines: ['medium', 'large'].map(catalogItemId => ({ catalogItemId, name: 'Fixture shirt', quantity: 1, unitPrice: usd('100') })),
      total: usd('200'), variantSelections: [choice('large', 'L'), choice('medium', 'M', 'Frozen storm blue with the original checkout label')] };
    expect(await createPaidOrderReceiver(kept, numbers).receive(order)).toBe('stored');
    const original = () => database.prepare("SELECT collection,id,data,revision FROM _plugin_storage WHERE plugin_id=? AND collection IN ('orders','order_numbers','checkout_carts') ORDER BY collection,id").all(pluginId);
    const before = original();
    const inspectLabel = 'Inspect #' + (await kept.get(order.orderId)).number + ' (TEST)';
    await page.goto('/_emdash/api/auth/dev-bypass?redirect=' + path);
    const welcome = page.getByRole('button', { name: 'Get Started', exact: true });
    const inspect = page.getByRole('button', { name: inspectLabel, exact: true });
    await expect(welcome.or(inspect)).toBeVisible({ timeout: 60000 });
    if (await welcome.isVisible()) await welcome.click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(path);
      await expect(inspect).toBeVisible({ timeout: 60000 });
      await inspect.focus(); await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Order record', exact: true }).click();
      const receipt = page.getByText('Receipt: ' + order.receiptId);
      await expect(receipt).toBeVisible();
      const inspected = await receipt.textContent();
      const items = page.getByRole('cell', { name: 'Fixture shirt', exact: true });
      await expect(items).toHaveCount(2);
      // Each item is one table row: name, its own frozen choices, quantity and line total.
      const itemOutput = await items.evaluateAll(nodes => nodes.map(node => {
        const cells = [...node.parentElement.children], options = cells[1], style = getComputedStyle(options);
        return { row: cells.map(cell => cell.innerText), followingText: options.innerText,
          textOverflow: style.textOverflow, textHeight: options.getBoundingClientRect().height, lineHeight: style.lineHeight };
      }));
      const catalogIds = await page.getByText(/^Fixture shirt: /).allTextContents();
      const noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      await items.first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(process.env.COMMERCE_PROOF_ARTIFACTS, `orders-frozen-choices-${width}.png`), fullPage: true, animations: 'disabled' });
      await page.getByRole('button', { name: 'Back to orders', exact: true }).click();
      await expect(inspect).toBeVisible();
      const evidence = { width, inspectLabel, inspected,
        items: itemOutput, catalogIds, noHorizontalOverflow, backToOrders: await inspect.textContent(), storageUnchanged: JSON.stringify(original()) === JSON.stringify(before) };
      console.log('ORDER_FROZEN_CHOICES_PROOF ' + JSON.stringify(evidence));
      await test.info().attach(`orders-frozen-choices-${width}.json`, { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
      expect.soft(itemOutput[0].followingText).toBe(mediumText);
      expect.soft(itemOutput[1].followingText).toBe('Size: L');
      expect.soft(itemOutput.map(item => item.row.slice(2))).toEqual([['$1.00', '× 1', '$1.00'], ['$1.00', '× 1', '$1.00']]);
      expect.soft(catalogIds).toEqual(['Fixture shirt: medium', 'Fixture shirt: large']);
      for (const item of itemOutput) expect.soft(item.textOverflow).not.toBe('ellipsis');
      expect.soft(noHorizontalOverflow).toBe(true);
      expect.soft(evidence.storageUnchanged).toBe(true);
    }
  } finally { await db.destroy(); }
}

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
  // The Order record fold holds the IDs and version; each new page arrives with it closed.
  const openRecord = async () => {
    const fold = page.getByRole('button', { name: 'Order record', exact: true });
    if (await fold.getAttribute('aria-expanded') !== 'true') await fold.click();
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
    // The private orders route agents and the CLI use (commerce-orders-api-001).
    const ordersEndpoint = `/_emdash/api/plugins/${pluginId}/orders`;
    const ordersRoute = data => page.request.post(ordersEndpoint, { headers: { 'X-EmDash-Request': '1' }, data });
    const completeInput = { action: 'complete', orderId: paid.order.orderId, version: 1, carrier: 'FORGED', tracking: 'FORGED-1' };
    // An Author (30), forging an administrator in the body, is refused before Orders reads or changes anything.
    database.prepare('UPDATE users SET role=30').run();
    for (const input of deniedInputs) {
      const response = await page.request.post(endpoint, { headers: { 'X-EmDash-Request': '1' },
        data: { ...input, user: { role: 50 }, ui: { surface: 'admin-page' } } });
      expect([401, 403]).toContain(response.status());
      expect(await response.text()).not.toContain(paid.order.receiptId);
    }
    for (const input of [{ action: 'list' }, completeInput]) {
      const response = await ordersRoute({ ...input, user: { role: 50 } });
      expect([401, 403]).toContain(response.status());
      expect(await response.text()).not.toContain(paid.order.receiptId);
    }
    // Staff (Editors) work orders like the owner (commerce-orders-staff-access-001): every change below is an Editor's.
    database.prepare('UPDATE users SET role=40').run();
    await page.reload();
    await expect(page.getByRole('button', { name: /^Inspect #100[12] \(TEST\)$/ }).first()).toBeVisible({ timeout: 60000 });
    await capture('orders-editor-allowed');
    expect(snapshot()).toEqual(original);
    const editorList = await ordersRoute({ action: 'list' });
    expect(editorList.status()).toBe(200);
    expect((await editorList.json()).data.total).toBe(2);
    const matrix = [{ actor: 'Orders anonymous and forged author', result: 'page, detail and orders route (list, complete) denied; canonical storage unchanged' },
      { actor: 'Orders editor', result: 'list shown; orders route lists; corrects address, completes and moves back' }];
    // Orders numbers each copy it keeps; people see the short number, the order id stays on the detail.
    const kept = new PluginStorageRepository(db, pluginId, 'orders', []);
    // These synthetic orders were not taken in live mode, so they are marked TEST.
    await expect(page.getByRole('button', { name: /^Inspect #100[12] \(TEST\)$/ }).first()).toBeVisible({ timeout: 60000 });
    const inspect = async order => 'Inspect #' + (await kept.get(order.orderId)).number + ' (TEST)';
    expect([(await kept.get(paid.order.orderId)).number, (await kept.get(free.order.orderId)).number].sort()).toEqual([1001, 1002]);
    await capture('orders-list-desktop');
    const open = page.getByRole('button', { name: await inspect(paid.order), exact: true });
    await open.focus(); await page.keyboard.press('Enter');
    // Packing first: status line, actions and items; the IDs sit in the Order record fold.
    await expect(page.getByText(/^Paid .* · Processing$/)).toBeVisible();
    await expect(page.getByText('Test order', { exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Paid', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '$2.50', exact: true }).last()).toBeVisible();
    await expect(page.getByText('Receipt: ' + paid.order.receiptId)).toBeHidden();
    await openRecord();
    await expect(page.getByText('Receipt: ' + paid.order.receiptId)).toBeVisible();
    await expect(page.getByText('Checkout attempt: ' + paid.order.attemptId)).toBeVisible();
    await expect(page.getByText('Order ID: ' + paid.order.orderId)).toBeVisible();
    await expect(page.getByText('Version: 1')).toBeVisible();
    // Text presence alone also passes when the host collapses newline-delimited
    // facts into one paragraph. Each fact must occupy its own wrapping row.
    const detailRows = ['Order ID: ' + paid.order.orderId, 'Version: 1', 'Receipt: ' + paid.order.receiptId,
      'Checkout attempt: ' + paid.order.attemptId, 'Provider payment: ' + paid.order.paymentId];
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const boxes = [];
      for (const text of detailRows) {
        const row = page.getByText(text, { exact: true });
        await expect(row).toBeVisible();
        expect(await row.evaluate(node => getComputedStyle(node).textOverflow)).not.toBe('ellipsis');
        boxes.push(await row.boundingBox());
      }
      for (let i = 1; i < boxes.length; i++) expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i - 1].y + boxes[i - 1].height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await capture('orders-provider-detail-' + width);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
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
    await expect(page.getByText('2 Corrected Road', { exact: true })).toBeVisible();
    await expect(page.getByText('Corrected after checkout', { exact: true })).toBeVisible();
    await openRecord();
    await expect(page.getByText('Version: 2')).toBeVisible();
    await capture('orders-address-corrected');
    expect((await kept.get(paid.order.orderId)).delivery.line1).toBe('2 Corrected Road');
    // Completing by hand: carrier and tracking are optional; Completed locks the address.
    await interact('Complete order');
    await page.getByLabel('Carrier (optional)').fill('USPS');
    await page.getByLabel('Tracking number (optional)').fill('SYNTHETIC-TRACKING-1');
    await capture('orders-complete-form');
    await interact('Complete order');
    await expect(page.getByText('Order completed', { exact: true })).toBeVisible();
    await expect(page.getByText(/^Paid .* · Completed$/)).toBeVisible();
    await expect(page.getByText(/^Shipped .* · USPS · SYNTHETIC-TRACKING-1$/)).toBeVisible();
    await openRecord();
    await expect(page.getByText('Version: 3')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Correct address', exact: true })).toHaveCount(0);
    await capture('orders-completed');
    expect((await kept.get(paid.order.orderId)).completed).toMatchObject({ carrier: 'USPS', tracking: 'SYNTHETIC-TRACKING-1' });
    // Moving back asks first, then clears the completion.
    await page.getByRole('button', { name: 'Move back to Processing', exact: true }).click();
    const moved = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Move back', exact: true }).click();
    expect((await moved).status()).toBe(200);
    await expect(page.getByText('Moved back to Processing', { exact: true })).toBeVisible();
    await expect(page.getByText(/^Paid .* · Processing$/)).toBeVisible();
    await openRecord();
    await expect(page.getByText('Version: 4')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Correct address', exact: true })).toBeVisible();
    expect((await kept.get(paid.order.orderId)).completed).toBeUndefined();
    // The same Editor is demoted to Author while the order stays open: the next click and the orders route are refused
    // before Orders runs, and the kept order is unchanged.
    const beforeDemotion = await kept.get(paid.order.orderId);
    database.prepare('UPDATE users SET role=30').run();
    const demotedClick = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Complete order', exact: true }).click();
    expect([401, 403]).toContain((await demotedClick).status());
    const demotedRoute = await ordersRoute({ ...completeInput, version: 4 });
    expect([401, 403]).toContain(demotedRoute.status());
    expect(await kept.get(paid.order.orderId)).toEqual(beforeDemotion);
    matrix.push({ actor: 'Orders editor demoted to author with the order open', result: 'Complete order click and orders route complete denied; kept order unchanged' });
    database.prepare('UPDATE users SET role=40').run();
    // A reload opens the Orders list again.
    await page.reload();
    await expect(page.getByRole('button', { name: await inspect(paid.order), exact: true })).toBeVisible({ timeout: 60000 });
    await interact(await inspect(free.order));
    await expect(page.getByRole('columnheader', { name: 'Nothing to pay', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '$0.00', exact: true }).last()).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await capture('orders-zero-mobile');
    await interact('Back to orders');
    expect(snapshot()).toEqual(original);
    // The owner again for the rest: failure screens and the catalog API.
    database.prepare('UPDATE users SET role=50').run();
    // The page read Orders' own copies, brought in from Checkout the first time it found none.
    expect((await kept.get(paid.order.orderId)).paidOrder).toEqual({ schema: 'dinkuskit.commerce.paid-order/v1', ...paid.order });
    // Orders renders frozen variant choices, not today's catalog or snapshot array positions.
    const choice = (catalogItemId, size, color) => ({ schema: 'dinkuskit.commerce.checkout-variant-selection/v1', productId: 'fixture-shirt', catalogItemId,
      fulfillment: 'physical', selections: [{ optionId: 'size', optionLabel: 'Size', valueId: size.toLowerCase(), valueLabel: size },
        ...(color ? [{ optionId: 'color', optionLabel: 'Color', valueId: 'blue', valueLabel: color }] : [])] });
    const variantOrder = { schema: 'dinkuskit.commerce.paid-order/v1', ...paid.order,
      orderId: 'order:variants', receiptId: 'receipt:variants', attemptId: 'attempt:variants',
      lines: paid.order.lines.map(line => ({ ...line, name: 'Fixture shirt' })),
      variantSelections: [choice('two', 'L'), choice('one', 'M', 'Frozen storm blue with the original checkout label')] };
    expect(await createPaidOrderReceiver(kept).receive(variantOrder)).toBe('stored');
    await page.reload();
    // The native page numbers new copies asynchronously; do not read its number before that load.
    await expect(page.getByRole('button', { name: 'Inspect #1003 (TEST)', exact: true })).toBeVisible({ timeout: 60000 });
    await interact(await inspect(variantOrder));
    const frozenCopy = await kept.get(variantOrder.orderId);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const medium = page.getByText('Size: M · Color: Frozen storm blue with the original checkout label', { exact: true });
      const large = page.getByText('Size: L', { exact: true });
      await expect(medium).toBeVisible(); await expect(large).toBeVisible();
      await expect(page.getByText('Fixture shirt', { exact: true })).toHaveCount(2);
      expect((await medium.boundingBox()).y).toBeLessThan((await large.boundingBox()).y);
      for (const label of [medium, large]) expect(await label.evaluate(node => getComputedStyle(node).textOverflow)).not.toBe('ellipsis');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await medium.scrollIntoViewIfNeeded(); await capture('orders-variant-choices-' + width);
    }
    expect(await kept.get(variantOrder.orderId)).toEqual(frozenCopy);
    expect(snapshot()).toEqual(original);
    await kept.delete(variantOrder.orderId);
    await page.reload();
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
    // The catalog API for agents and the CLI (catalog-api-20261027) in the installed runtime.
    const catalogEndpoint = `/_emdash/api/plugins/${pluginId}/catalog`;
    const catalog = async data => page.request.post(catalogEndpoint, { headers: { 'X-EmDash-Request': '1' }, data });
    const made = await catalog({ op: 'create', commandId: 'proof-agent-mug', name: 'Agent Mug', sku: 'AGENT-MUG', entryId: 'page-agent-mug' });
    expect(made.status()).toBe(200);
    const mugId = (await made.json()).data.catalogItemId;
    expect((await (await catalog({ op: 'prices', catalogItemId: mugId, regular: '12.00', sale: '' })).json()).data.saved).toBe(true);
    expect((await (await catalog({ op: 'sku', catalogItemId: mugId, sku: 'AGENT-MUG-2' })).json()).data).toEqual({ changed: true });
    const mug = (await (await catalog({ op: 'get', catalogItemId: mugId })).json()).data.product;
    expect([mug.sku, mug.regular, mug.offSale]).toEqual(['AGENT-MUG-2', '12.00', true]);
    const refused = await catalog({ op: 'weight', catalogItemId: mugId, weightOz: '0' });
    writeFileSync(resolve(process.env.COMMERCE_PROOF_ARTIFACTS, 'catalog-api-refusal.json'), JSON.stringify({ status: refused.status(), body: await refused.json() }, null, 2));
    expect(refused.status()).toBe(400);
    // The CLI reads the reason after "route catalog failed: " (cli/client.mjs).
    expect((await refused.json()).error).toMatchObject({ code: 'ROUTE_ERROR', message: expect.stringMatching(/route catalog failed: Weight must be a number of ounces/) });
    // A write carrying a preview code saves only while the product still reads the same.
    const code = async () => createHash('sha256').update(JSON.stringify((await (await catalog({ op: 'get', catalogItemId: mugId })).json()).data)).digest('hex').slice(0, 12);
    const seen = await code();
    expect((await (await catalog({ op: 'prices', catalogItemId: mugId, regular: '13.00', sale: '', expected: seen })).json()).data.saved).toBe(true);
    const stale = await catalog({ op: 'prices', catalogItemId: mugId, regular: '14.00', sale: '', expected: seen });
    expect(stale.status()).toBe(400);
    expect((await stale.json()).error.message).toMatch(/route catalog failed: The product changed since that preview/);
    expect((await (await catalog({ op: 'get', catalogItemId: mugId })).json()).data.product.regular).toBe('13.00');
    const anonymousCatalog = await browser.newContext();
    const anonymous = await anonymousCatalog.request.post(new URL(catalogEndpoint, test.info().project.use.baseURL).href,
      { headers: { 'X-EmDash-Request': '1' }, data: { op: 'list' } });
    expect([401, 403]).toContain(anonymous.status());
    await anonymousCatalog.close();
    writeFileSync(resolve(process.env.COMMERCE_PROOF_ARTIFACTS, 'orders-canonical.json'), JSON.stringify({ paid: paid.order, free: free.order }, null, 2));
    writeFileSync(resolve(process.env.COMMERCE_PROOF_ARTIFACTS, 'http-matrix.json'), JSON.stringify(matrix, null, 2));
  } finally { await db.destroy(); }
});

// This harness shares its installation/database across cases. Preserve the
// original acceptance test's first-run welcome and empty-shop prerequisites.
test('installed Orders records frozen item choices on desktop and phone', proveFrozenItemChoices);
