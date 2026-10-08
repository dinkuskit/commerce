import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Kysely, SqliteDialect } from 'kysely';
import { PluginStorageRepository } from 'emdash';
import { createCouponAdmin, createCouponAttemptOwner } from '../../dist/features/coupons/index.js';

test('packaged coupon Block Kit survives validation, conflicts, reload and forbidden actions', async ({ page, request, browser }) => {
  expect((await request.get('/_emdash/api/setup/dev-bypass')).status()).toBe(200);
  const pluginId = process.env.COMMERCE_COUPON_PLUGIN_ID ?? 'dinkus-commerce';
  const installed = process.env.COMMERCE_COUPON_INSTALLED_PROFILE === '1';
  if (installed) {
    const profile = await request.post('/__proof/install');
    expect(profile.status()).toBe(200);
    writeFileSync(resolve(process.env.COMMERCE_PROOF_ARTIFACTS, 'installed-profile.json'), JSON.stringify(await profile.json(), null, 2));
  }
  const database = new Database(process.env.COMMERCE_PROOF_DB.slice(5));
  const db = new Kysely({ dialect: new SqliteDialect({ database }) });
  const collection = new PluginStorageRepository(db, pluginId, 'coupons', ['normalizedCode']);
  const admin = createCouponAdmin(collection);
  const rows = () => database.prepare("SELECT data FROM _plugin_storage WHERE plugin_id=? AND collection='coupons'").all(pluginId).map(row => JSON.parse(row.data));
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
  const fill = async (code, value='12.5') => {
    for (const [label, entry] of [['Code',code],['Discount value',value],['Usage limit','4'],['Starts at (ISO offset)','2026-01-01T00:00:00Z'],['Ends at (ISO offset, exclusive)','2027-01-01T00:00:00Z'],['Merchant timezone (IANA)','America/Los_Angeles']]) {
      await page.getByRole('textbox', { name: label, exact: true }).fill(entry);
    }
  };
  try {
    await page.goto('/_emdash/api/auth/dev-bypass?redirect=' + path + 'coupons');
    await page.getByRole('button', { name: 'Get Started' }).click({ timeout: 60000 });
    await expect(page.getByText('No coupons yet', { exact: true })).toBeVisible();
    await capture('coupons-empty');
    await fill('Welcome','100.01');
    expect((await interact('Create coupon')).body.toast.type).toBe('error');
    await expect(page.getByRole('textbox', { name: 'Discount value', exact: true })).toHaveValue('100.01');
    expect(rows()).toHaveLength(0);
    await page.getByRole('textbox', { name: 'Discount value', exact: true }).fill('12.5');
    const created = await interact('Create coupon');
    expect(created.body.toast.type).toBe('success');
    let coupon = rows()[0];
    expect(coupon.normalizedCode).toBe('WELCOME');
    expect(coupon.rule.discount.basisPoints).toBe(1250);
    await capture('coupon-created');
    await page.reload();
    await interact('Open Welcome');
    await expect(page.getByRole('textbox', { name: 'Discount value', exact: true })).toHaveValue('12.5');
    await page.getByRole('textbox', { name: 'Code', exact: true }).fill('Welcome draft');
    await admin.edit(coupon.couponId, coupon.revision, { code: 'Welcome concurrent' });
    expect((await interact('Save coupon')).body.toast.type).toBe('error');
    expect(rows()[0].code).toBe('Welcome concurrent');
    await expect(page.getByRole('textbox', { name: 'Code', exact: true })).toHaveValue('Welcome draft');
    expect((await interact('Save coupon')).body.toast.type).toBe('error');
    expect(rows()[0].code).toBe('Welcome concurrent');
    await capture('coupon-stale');
    await interact('Open Welcome concurrent');
    await page.getByRole('textbox', { name: 'Code', exact: true }).fill('Welcome');
    expect((await interact('Save coupon')).body.toast.type).toBe('success');
    await interact('New coupon');
    await fill('welcome');
    expect((await interact('Create coupon')).body.toast.type).toBe('error');
    await expect(page.getByRole('textbox', { name: 'Code', exact: true })).toHaveValue('welcome');
    expect(rows()).toHaveLength(1);
    await interact('New coupon');
    await fill('Fixed','4.25');
    await page.getByRole('combobox', { name: 'Discount', exact: true }).click();
    await page.getByRole('option', { name: 'Fixed amount (USD)', exact: true }).click();
    expect((await interact('Create coupon')).body.toast.type).toBe('success');
    expect(rows().find(r => r.code === 'Fixed').rule.discount).toEqual({ kind:'fixed', amount:{currency:'USD',minor:'425'} });
    await page.reload();
    await interact('Open Fixed');
    await expect(page.getByRole('textbox', { name: 'Discount value', exact: true })).toHaveValue('4.25');
    await page.getByRole('textbox', { name: 'Discount value', exact: true }).fill('90071992547409.91');
    expect((await interact('Save coupon')).body.toast.type).toBe('success');
    expect(rows().find(r => r.code === 'Fixed').rule.discount.amount.minor).toBe('9007199254740991');
    await page.reload();
    await interact('Open Fixed');
    await expect(page.getByRole('textbox', { name: 'Discount value', exact: true })).toHaveValue('90071992547409.91');
    await capture('coupon-fixed');
    await interact('Open Welcome');
    coupon = rows().find(r => r.code === 'Welcome');
    const owner = createCouponAttemptOwner(collection);
    const quote = { quoteId:'proof-quote',couponId:coupon.couponId,ruleId:coupon.rule.ruleId,ruleVersion:coupon.rule.version,
      eligibleSubtotal:{currency:'USD',minor:'1000'},discount:{currency:'USD',minor:'125'},payableMerchandiseTotal:{currency:'USD',minor:'875'},
      lines:[{productId:'proof-item',quantity:1,unitPrice:{currency:'USD',minor:'1000'},lineSubtotal:{currency:'USD',minor:'1000'},eligible:true,discount:{currency:'USD',minor:'125'}}] };
    for (const kind of ['pending','consumed','released']) {
      await owner.reserve({ couponId:coupon.couponId,attemptId:'proof-'+kind,quote:{...quote,quoteId:'proof-'+kind},overallPayableTotal:{currency:'USD',minor:'875'},now:'2026-06-01T12:00:00Z' });
      if (kind==='consumed') {
        await owner.attachProviderSession(coupon.couponId,'proof-consumed','synthetic-provider');
        await owner.reconcile(coupon.couponId,'proof-consumed',{kind:'verified-success',providerSessionId:'synthetic-provider'});
      }
      if (kind==='released') await owner.reconcile(coupon.couponId,'proof-released',{kind:'verified-not-created'});
    }
    await page.reload();
    await interact('Open Welcome');
    await expect(page.getByText('Pending holds', {exact:true})).toBeVisible();
    await capture('coupon-usage');
    const disableResponse = page.waitForResponse(r=>r.url().endsWith(endpoint)&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Disable coupon',exact:true}).click();
    await page.getByRole('button',{name:'Disable',exact:true}).click();
    const disabled = await disableResponse;
    expect((await disabled.json()).data.toast.type).toBe('success');
    expect(rows().find(r=>r.code==='Welcome').disabled).toBe(true);
    expect(rows().find(r=>r.code==='Welcome').attempts).toHaveLength(3);
    await page.reload();
    await interact('Open Welcome');
    await expect(page.getByRole('button',{name:'Disable coupon',exact:true})).toHaveCount(0);
    await capture('coupon-disabled');
    const before = JSON.stringify(rows());
    const access = async () => installed ? (await (await page.request.get('/__proof/access')).json()).count : 0;
    const matrix = [];
    const denied = async (actor, input, { status, headers = { 'X-EmDash-Request': '1' }, method = 'POST' } = {}) => {
      const count = await access();
      const response = await page.request.fetch(endpoint, { method, headers, ...(method !== 'GET' ? { data: input } : {}) });
      const body = await response.json();
      if (status) expect(response.status()).toBe(status);
      else expect(response.status() !== 200 || body.data?.toast?.type === 'error').toBe(true);
      expect(await access()).toBe(count);
      expect(JSON.stringify(rows())).toBe(before);
      matrix.push({ actor, method, page: input?.page ?? null, action: input?.action_id ?? input?.type, status: response.status(), couponStorageAccess: 0 });
    };
    if (installed) {
      // Positive control proves the storage observer sees actual sandbox calls.
      const count = await access();
      await page.request.post(endpoint, { headers: { 'X-EmDash-Request': '1' }, data: { type: 'page_load', page: '/coupons' } });
      expect(await access()).toBeGreaterThan(count);
    }
    await denied('Admin missing CSRF', { type: 'page_load', page: '/coupons' }, { status: 403, headers: {} });
    await denied('Admin wrong method', { type: 'page_load', page: '/coupons' }, { status: 405, method: 'DELETE' });
    await denied('Admin missing page', { type: 'form_submit', action_id: 'coupon.create:new', values: created.input.values });
    await denied('Admin undeclared page', { type: 'form_submit', page: '/forged', action_id: 'coupon.create:new', values: created.input.values });
    if (installed) {
      const count = await access();
      const rejectedScope = await page.request.post('/__proof/scopes?scope=content:read', { data: { type: 'page_load', page: '/coupons' } });
      expect(rejectedScope.status()).toBe(403);
      expect(await access()).toBe(count);
      const acceptedScope = await page.request.post('/__proof/scopes?scope=admin', { data: { type: 'page_load', page: '/coupons' } });
      expect(acceptedScope.status()).toBe(200);
      expect(await access()).toBeGreaterThan(count);
      matrix.push({ actor: 'Admin', scopePolicy: 'content:read denied / admin admitted', fidelity: 'genuine production dispatcher with test scopes; bearer authentication not exercised' });
    }
    database.prepare('UPDATE users SET role=40').run();
    const forged = await page.request.post(endpoint,{headers:{'X-EmDash-Request':'1'},data:{...created.input,user:{role:50},ui:{surface:'admin-page'},permissions:['plugins:manage']}});
    const rejected = await forged.json();
    expect(forged.status()===403 || rejected.data?.toast?.type==='error').toBe(true);
    expect(JSON.stringify(rows())).toBe(before);
    for (const declaredPage of ['/coupons', '/products', '/settings']) {
      for (const input of [
        { type: 'page_load', page: '/coupons' },
        { type: 'block_action', action_id: 'coupon.new' },
        { type: 'block_action', action_id: 'coupon.list', value: 0 },
        { type: 'block_action', action_id: 'coupon.open', value: coupon.couponId },
        { type: 'block_action', action_id: `coupon.disable:${coupon.couponId}:${coupon.revision}` },
        { type: 'form_submit', action_id: 'coupon.create:new', values: created.input.values },
        { type: 'form_submit', action_id: `coupon.save:${coupon.couponId}:${coupon.revision}`, values: created.input.values },
      ]) {
        await denied('Editor forged body privileges', { ...input, page: input.type === 'page_load' ? '/coupons' : declaredPage,
          user: { role: 50 }, ui: { surface: 'admin-page', locale: 'en' }, permissions: ['plugins:manage'] });
      }
    }
    await page.goto(path+'coupons');
    await expect(page.getByText('Coupons require plugins:manage',{exact:true}).first()).toBeVisible();
    await capture('coupon-editor-denied');
    await page.goto(path+'products');
    await expect(page.getByRole('textbox',{name:'Name',exact:true})).toBeVisible();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Editor product');
    await page.getByRole('textbox', { name: 'SKU', exact: true }).fill('EDITOR-PROOF');
    expect((await interact('Add product')).body.toast.type).toBe('success');
    await page.getByRole('textbox', { name: 'Regular', exact: true }).fill('12.34');
    expect((await interact('Save')).body.toast.type).toBe('success');
    if (installed) {
      const guest = await browser.newContext();
      const base = test.info().project.use.baseURL;
      const catalogResponse = await guest.request.get(base + `/_emdash/api/plugins/${pluginId}/catalog/public`);
      expect(catalogResponse.status()).toBe(200);
      expect(catalogResponse.headers()['cache-control']).toContain('no-store');
      const catalog = (await catalogResponse.json()).data;
      const product = catalog.products.find(product => product.sku === 'EDITOR-PROOF');
      expect(product).toEqual({ id: expect.any(String), name: 'Editor product', sku: 'EDITOR-PROOF',
        price: { currency: 'USD', minor: '1234' }, availability: { status: 'in-stock', sellable: true, listable: true } });
      // Real installed storage pagination: an empty filtered first page must
      // still lead the consumer to the authenticated admin-created product.
      const pad = database.prepare("INSERT INTO _plugin_storage (plugin_id,collection,id,data,revision,created_at,updated_at) VALUES (?, 'catalog_items', ?, ?, ?, ?, ?)");
      for (let index = 0; index < 50; index++) {
        pad.run(pluginId, 'pagination-proof-' + index, JSON.stringify({ recordKind: 'pagination-proof' }),
          'pagination-revision-' + index, '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z');
      }
      const firstPage = (await (await guest.request.get(base + `/_emdash/api/plugins/${pluginId}/catalog/public`)).json()).data;
      expect(firstPage.products).toEqual([]);
      expect(firstPage.cursor).toEqual(expect.any(String));
      const shopper = await guest.newPage();
      await shopper.goto('/');
      await shopper.getByRole('button', { name: 'Load catalog' }).click();
      await expect(shopper.getByRole('button', { name: 'Add Editor product' })).toBeVisible();
      await shopper.getByRole('button', { name: 'Add Editor product' }).click();
      await expect(shopper.getByText('Cart: Editor product × 1')).toBeVisible();
      await shopper.getByRole('button', { name: 'Prepare checkout' }).click();
      await expect(shopper.getByText('Prepared')).toBeVisible();
      await shopper.getByRole('button', { name: 'Start checkout' }).click();
      await expect(shopper.getByText('PAYMENTS_UNAVAILABLE')).toBeVisible();
      await shopper.screenshot({ path: resolve(process.env.COMMERCE_PROOF_ARTIFACTS, 'public-catalog-cart.png'), fullPage: true });
      writeFileSync(resolve(process.env.COMMERCE_PROOF_ARTIFACTS, 'public-catalog.json'), JSON.stringify(catalog, null, 2));
      expect(database.prepare("SELECT COUNT(*) n FROM _plugin_storage WHERE plugin_id=? AND collection='checkout_carts'").get(pluginId).n).toBe(0);
      database.prepare("DELETE FROM _plugin_storage WHERE plugin_id=? AND collection='catalog_items' AND json_extract(data,'$.recordKind')='pagination-proof'").run(pluginId);
      await guest.close();
    }
    await page.goto(path+'settings');
    await expect(page.getByRole('switch',{name:'Hide out-of-stock products',exact:true})).toBeVisible();
    await page.getByRole('switch', { name: 'Hide out-of-stock products', exact: true }).click();
    expect((await interact('Save')).body.toast.type).toBe('success');
    for (const role of [10, 20, 30, 999]) {
      database.prepare('UPDATE users SET role=?').run(role);
      for (const declaredPage of ['/products', '/settings', '/coupons']) {
        await denied(`Role ${role}`, { type: 'page_load', page: declaredPage, user: { role: 50 }, ui: { surface: 'admin-page' } });
        await denied(`Role ${role} forged coupon action`, { type: 'form_submit', page: declaredPage, action_id: 'coupon.create:new', values: created.input.values });
      }
    }
    const anonymous=await browser.newContext();
    const anonymousCount = await access();
    expect([401,403]).toContain((await anonymous.request.post(new URL(endpoint,test.info().project.use.baseURL).href,{headers:{'X-EmDash-Request':'1'},data:created.input})).status());
    expect(await access()).toBe(anonymousCount);
    matrix.push({ actor: 'Anonymous', couponStorageAccess: 0, result: 'host denied' });
    await anonymous.close();
    database.prepare('UPDATE users SET role=50').run();
    await page.context().addCookies([{ name:'emdash-locale', value:'ar', url:test.info().project.use.baseURL }]);
    await page.goto(path+'coupons');
    await expect(page.locator('html')).toHaveAttribute('dir','rtl');
    await expect(page.getByRole('heading', { name: 'Coupons', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Code', exact: true })).toBeVisible();
    await capture('coupons-arabic-direction');

    // Read-only Orders acceptance uses canonical checkout writes and synthetic
    // payment outcomes, never a payment provider or a production order.
    if (installed) {
      const { createCheckoutStore, startCheckout } = await import('../../dist/features/checkout/index.js');
      const { fixture, cart } = await import('../features/checkout/fixture.mjs');
      const orders = new PluginStorageRepository(db, pluginId, 'checkout_carts', []);
      await page.context().addCookies([{ name:'emdash-locale', value:'en', url:test.info().project.use.baseURL }]);
      await page.goto(path+'orders');
      await expect(page.getByText('No orders recorded yet.',{exact:true})).toBeVisible();
      await capture('orders-empty');
      const f=fixture(createCheckoutStore(orders),false);
      f.setPayment('paid');
      const paid=await startCheckout(f.execution,'orders-paid',cart);
      expect(paid.phase).toBe('paid');
      for(const price of f.execution.catalog.prices.records.values()) { price.regular.minor='0'; delete price.sale; }
      const free=await startCheckout(f.execution,'orders-free',cart);
      expect(free.phase).toBe('paid');
      const snapshot=()=>database.prepare("SELECT data FROM _plugin_storage WHERE plugin_id=? AND collection='checkout_carts' ORDER BY id").all(pluginId);
      const original=snapshot();
      // Installed transport denial is distinct from controller-only unit proof.
      const deniedInputs = [{type:'page_load',page:'/orders'},
        {type:'block_action',page:'/orders',action_id:'orders.open:'+encodeURIComponent(paid.order.orderId)}];
      const guestOrders = await browser.newContext();
      for (const input of deniedInputs) {
        const response = await guestOrders.request.post(new URL(endpoint,test.info().project.use.baseURL).href,
          {headers:{'X-EmDash-Request':'1'},data:input});
        expect([401,403]).toContain(response.status());
        expect(await response.text()).not.toContain(paid.order.receiptId);
      }
      await guestOrders.close();
      database.prepare('UPDATE users SET role=40').run();
      for (const input of deniedInputs) {
        const response = await page.request.post(endpoint,{headers:{'X-EmDash-Request':'1'},
          data:{...input,user:{role:50},ui:{surface:'admin-page'}}});
        expect(await response.text()).toContain('Orders require plugins:manage');
      }
      await page.reload();
      await expect(page.getByText('Orders require plugins:manage',{exact:true})).toBeVisible();
      await capture('orders-editor-denied');
      database.prepare('UPDATE users SET role=50').run();
      expect(snapshot()).toEqual(original);
      matrix.push({actor:'Orders anonymous and forged editor',result:'list/detail denied; canonical storage unchanged'});
      await page.reload();
      await expect(page.getByRole('button',{name:'Inspect '+paid.order.orderId,exact:true})).toBeVisible();
      await capture('orders-list-desktop');
      const open=page.getByRole('button',{name:'Inspect '+paid.order.orderId,exact:true});
      await open.focus(); await page.keyboard.press('Enter');
      await expect(page.getByText('Receipt: '+paid.order.receiptId)).toBeVisible();
      await expect(page.getByText('Checkout attempt: '+paid.order.attemptId)).toBeVisible();
      await expect(page.getByText('Payment: Provider-paid')).toBeVisible();
      await expect(page.getByText('USD 2.50',{exact:true})).toBeVisible();
      await expect(page.getByText('Fulfillment: Not recorded')).toBeVisible();
      await capture('orders-provider-detail');
      await interact('Back to orders');
      await interact('Inspect '+free.order.orderId);
      await expect(page.getByText('Payment: Zero payable — no payment required')).toBeVisible();
      await expect(page.getByText('USD 0.00',{exact:true}).last()).toBeVisible();
      await page.setViewportSize({width:390,height:844});
      await capture('orders-zero-mobile');
      await interact('Back to orders');
      expect(snapshot()).toEqual(original);
      // A malformed aggregate is not an empty shop and must fail closed.
      await orders.compareAndSet('orders-invalid',null,{attempts:null});
      await page.reload();
      await expect(page.getByText('Orders unavailable',{exact:true})).toBeVisible();
      await capture('orders-unavailable');
      await orders.delete('orders-invalid');
      await page.reload();
      await expect(page.getByRole('button',{name:'Inspect '+paid.order.orderId,exact:true})).toBeVisible();
      await page.setViewportSize({width:1440,height:1000});
      writeFileSync(resolve(process.env.COMMERCE_PROOF_ARTIFACTS,'orders-canonical.json'),JSON.stringify({paid:paid.order,free:free.order},null,2));
    }
    writeFileSync(resolve(process.env.COMMERCE_PROOF_ARTIFACTS, 'http-matrix.json'), JSON.stringify(matrix, null, 2));
    writeFileSync(resolve(process.env.COMMERCE_PROOF_ARTIFACTS,'storage.json'),JSON.stringify(rows(),null,2));
  } finally { await db.destroy(); }
});
