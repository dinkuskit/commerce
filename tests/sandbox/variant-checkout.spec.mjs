import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import {writeFileSync} from "node:fs";
import { Kysely, SqliteDialect } from 'kysely';
import { createSettingsAccess } from 'emdash';
import { OptionsRepository } from 'emdash/internal/plugins/host';
import { loadMerchantStoreSettings, saveMerchantStoreSettings } from '../../dist/features/store-settings/kernel/index.js';

function proofDb() {
  const native = test.info().project.name === "native-variant";
  const url = native ? process.env.COMMERCE_NATIVE_VARIANT_DB : process.env.COMMERCE_PROOF_DB;
  if (!url) throw new Error("missing variant proof database");
  return { native, filename: url.replace(/^file:/, "") };
}

test("same-origin storefront renders concrete grouped members", async ({ page, baseURL }) => {
  const { native, filename } = proofDb();
  const db = new Database(filename);
  const now = "2026-10-08T00:00:00.000Z";
  const put = db.prepare("INSERT OR REPLACE INTO _plugin_storage (plugin_id, collection, id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
  const collections = native
    ? { catalog: "catalogItems", prices: "catalogPrices", availability: "catalogManualAvailability", carts: "checkoutCarts", capabilities: "checkoutGuestCapabilities", associations: "checkoutPaymentAssociations" }
    : { catalog: "catalog_items", prices: "catalog_prices", availability: "catalog_manual_availability", carts: "checkout_carts", capabilities: "checkout_guest_capabilities", associations: "checkout_payment_associations" };
  const ids = {
    parent: `variant-proof-${native ? "native" : "sandbox"}-parent`,
    large: `variant-proof-${native ? "native" : "sandbox"}-large`,
  };
  let ownedCartId;
  let ownedCapabilityId;
  let ownedAttemptId;
  let firstCapabilityId;
  let settingsDb, settings, originalSettings, capturedRequirementRevision;
  const row = (id, data) => put.run("dinkus-commerce", collections.catalog, id, JSON.stringify(data), now, now);
  const price = (id, minor) => put.run("dinkus-commerce", collections.prices, id, JSON.stringify({
    recordKind: "catalog-price", recordId: id, catalogItemId: id, regular: { currency: "USD", minor },
  }), now, now);
  const availability = (id, status) => put.run("dinkus-commerce", collections.availability, id, JSON.stringify({
    recordKind: "catalog-manual-availability", recordId: id, catalogItemId: id, status,
  }), now, now);
  const base = (id, sku, variantProduct, extra = {}) => row(id, {
    recordKind: "catalog-item", itemId: id, commandId: "variant-proof:" + id, kind: "simple-product",
    name: "Proof shirt", sku, skuKey: sku, stockManagement: { mode: "unmanaged" },
    creationIntent: { manageStock: false }, state: "draft", createdAt: now, ...extra,
    ...(variantProduct ? { variantProduct } : {}),
  });
  const product = {
    schema: "dinkuskit.commerce.product-variants/v1", productId: ids.parent,
    revision: 1, defaultMemberId: ids.parent, options: [{ optionId: "size", label: "Size",
      values: [{ valueId: "small", label: "Small" }, { valueId: "large", label: "Large" }] }],
    members: [
      { catalogItemId: ids.parent, selections: [{ optionId: "size", valueId: "small" }], fulfillment: "physical" },
      { catalogItemId: ids.large, selections: [{ optionId: "size", valueId: "large" }], fulfillment: "physical" },
    ],
  };
  try {
    base(ids.parent, "PROOF-SHIRT-" + (native ? "NATIVE" : "SANDBOX"), product);
    base(ids.large, "PROOF-SHIRT-L-" + (native ? "NATIVE" : "SANDBOX"), null, { variantProductId: ids.parent, variantSelections: [{ optionId: "size", valueId: "large" }], variantFulfillment: "physical" });
    price(ids.parent, "2000"); price(ids.large, "2400"); availability(ids.parent, "out-of-stock"); availability(ids.large, "in-stock");
    await page.goto(new URL("/", baseURL).toString());
    const variants = page.locator(`[data-variants="${ids.parent}"]`);
    await expect(variants).toContainText("Small");
    await expect(variants).toContainText("2400");
    await expect(variants.locator(`input[value="${ids.parent}"]`)).toBeDisabled();
    await expect(variants.locator(`input[value="${ids.large}"]`)).toBeEnabled();

    if (native) {
      settingsDb = new Kysely({ dialect: new SqliteDialect({ database: new Database(filename) }) });
      settings = createSettingsAccess(new OptionsRepository(settingsDb), 'dinkus-commerce', {});
      originalSettings = await loadMerchantStoreSettings(settings);
      const optional = await saveMerchantStoreSettings(settings, { expectedRevision: originalSettings.revision, requirePhoneNumber: false });
      await variants.locator(`input[value="${ids.large}"]`).check();
      await page.getByRole("button", { name: "Prepare checkout" }).click();
      await expect(page.locator('[data-checkout-result]')).toContainText('"ok": true');

      const capability = await page.locator('[data-checkout-result]').textContent();
      expect(capability).toContain("capability");
      const prepared = JSON.parse(capability);
      const token = (prepared.data ?? prepared).capability.capability;
      ownedCapabilityId = (prepared.data ?? prepared).capabilityId;
      firstCapabilityId = ownedCapabilityId;
      expect((prepared.data ?? prepared).contactRequirements).toEqual({requirePhoneNumber:false});
      expect((prepared.data ?? prepared).checkout.contactRequirements).toBeUndefined();
      const forged = await page.evaluate(async ({ token, id }) => {
        const response = await fetch("/_emdash/api/plugins/dinkus-commerce/checkout/guest/start", {
          method: "POST",
          headers: { "content-type": "application/json", "x-commerce-guest-capability": token },
          body: JSON.stringify({ lines: [{ catalogItemId: id, quantity: 1, price: "1" }], total: "1", paid: true }),
        });
        return { status: response.status, body: await response.json() };
      }, { token, id: ids.large });
      expect(forged.status).toBe(400);
      expect(JSON.stringify(forged.body)).toMatch(/INVALID_CART|Invalid cart/);

      await expect(page.getByRole('textbox', { name: 'Phone' })).not.toHaveAttribute('required');
      const cartsBeforeDenial = db.prepare('SELECT COUNT(*) AS n FROM _plugin_storage WHERE plugin_id=? AND collection=?').get('dinkus-commerce', collections.carts).n;
      await page.getByRole("button", { name: "Start checkout" }).click();
      await expect(page.locator('[data-checkout-result]')).toContainText('INVALID_CART');
      expect(db.prepare('SELECT COUNT(*) AS n FROM _plugin_storage WHERE plugin_id=? AND collection=?').get('dinkus-commerce', collections.carts).n).toBe(cartsBeforeDenial);
      await page.getByRole('textbox', { name: 'Email' }).fill('variant-shopper@example.test');
      const required = await saveMerchantStoreSettings(settings, {expectedRevision: optional.revision, requirePhoneNumber:true});
      capturedRequirementRevision = required.revision;
      await page.getByRole("button", { name: "Start checkout" }).click();
      await expect(page.locator('[data-checkout-result]')).toContainText('INVALID_CART');
      expect(db.prepare('SELECT COUNT(*) AS n FROM _plugin_storage WHERE plugin_id=? AND collection=?').get('dinkus-commerce', collections.carts).n).toBe(cartsBeforeDenial);
      await page.getByRole('button', {name:'Prepare checkout'}).click();
      await expect(page.getByRole('textbox', {name:'Phone'})).toHaveAttribute('required');
      const refreshed = JSON.parse(await page.locator('[data-checkout-result]').textContent());
      ownedCapabilityId = (refreshed.data ?? refreshed).capabilityId;
      expect((refreshed.data ?? refreshed).contactRequirements).toEqual({requirePhoneNumber:true});
      await page.getByRole('textbox', {name:'Phone'}).fill('555 0142');
      await page.getByRole("button", { name: "Start checkout" }).click();
      await saveMerchantStoreSettings(settings, {expectedRevision:required.revision,requirePhoneNumber:false});
      await page.getByRole('textbox', {name:'Email'}).fill('changed-draft@example.test');
      await page.getByRole('textbox', {name:'Phone'}).fill('555 9999');
      await expect(page.locator('[data-checkout-result]')).toContainText('"state": "pending"');
      await expect(page.locator('[data-frozen-order]')).toContainText("Large");

      const parent = db.prepare("SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = ? AND id = ?")
        .get("dinkus-commerce", collections.catalog, ids.parent);
      const edited = JSON.parse(parent.data);
      edited.variantProduct.options[0].values[1].label = "Edited later";
      db.prepare("UPDATE _plugin_storage SET data = ?, updated_at = ? WHERE plugin_id = ? AND collection = ? AND id = ?")
        .run(JSON.stringify(edited), now, "dinkus-commerce", collections.catalog, ids.parent);
      db.prepare("UPDATE _plugin_storage SET data = ?, updated_at = ? WHERE plugin_id = ? AND collection = ? AND id = ?")
        .run(JSON.stringify({ recordKind: "catalog-price", recordId: ids.large, catalogItemId: ids.large, regular: { currency: "USD", minor: "9999" } }), now, "dinkus-commerce", collections.prices, ids.large);
      db.prepare("UPDATE _plugin_storage SET data = ?, updated_at = ? WHERE plugin_id = ? AND collection = ? AND id = ?")
        .run(JSON.stringify({ recordKind: "catalog-manual-availability", recordId: ids.large, catalogItemId: ids.large, status: "out-of-stock" }), now, "dinkus-commerce", collections.availability, ids.large);

      await page.getByRole("button", { name: "Refresh payment status" }).click();
      await expect(page.locator('[data-checkout-result]')).toContainText('"state": "paid"');
      await expect(page.locator('[data-checkout-result]')).toContainText('"minor": "2400"');
      const paidProjection = JSON.parse(await page.locator('[data-checkout-result]').textContent());
      expect((paidProjection.data ?? paidProjection).checkout.order.variantSelections[0].selections[0].valueLabel).toBe("Large");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${process.env.COMMERCE_PROOF_ARTIFACTS}/variant-checkout-native-phone.png`, fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: `${process.env.COMMERCE_PROOF_ARTIFACTS}/variant-checkout-native-desktop.png`, fullPage: true });

      const capabilityRows = db.prepare("SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = ?")
        .all("dinkus-commerce", collections.capabilities);
      const capabilityRecord = capabilityRows.map(({ data }) => JSON.parse(data)).find((record) => record.capabilityId === ownedCapabilityId);
      expect(capabilityRecord).toBeTruthy();
      ownedCartId = capabilityRecord.cartId;
      ownedCapabilityId = capabilityRecord.capabilityId;
      const cartRow = db.prepare("SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = ? AND id = ?")
        .get("dinkus-commerce", collections.carts, capabilityRecord.cartId);
      const persisted = JSON.parse(cartRow.data);
      const attempt = persisted.attempts.at(-1);
      ownedAttemptId = attempt.attemptId;
      expect(attempt.phase).toBe("paid");
      expect(attempt.payment.total).toEqual({ currency: "USD", minor: "2400" });
      expect(attempt.order.total).toEqual({ currency: "USD", minor: "2400" });
      expect(attempt.order.variantSelections[0].selections[0].valueLabel).toBe("Large");
      expect(attempt.order.paymentId).toMatch(/^synthetic-payment:/);
      expect(attempt.contactSnapshot).toMatchObject({contact:{email:'variant-shopper@example.test',phone:'555 0142'},requirePhoneNumber:true,revision:capturedRequirementRevision});
      expect(attempt.order.contactSnapshot).toEqual(attempt.contactSnapshot);
      expect(JSON.stringify(attempt.payment)).not.toContain('variant-shopper@example.test');
      expect(JSON.stringify(paidProjection)).not.toContain('variant-shopper@example.test');
      expect(JSON.stringify(paidProjection)).not.toContain('555 0142');
    } else {
      await page.screenshot({ path: `${process.env.COMMERCE_PROOF_ARTIFACTS}/variant-checkout-sandbox.png`, fullPage: true });
    }
  } finally {
    for (const [collection, id] of [
      [collections.catalog, ids.parent], [collections.catalog, ids.large],
      [collections.prices, ids.parent], [collections.prices, ids.large],
      [collections.availability, ids.parent], [collections.availability, ids.large],
    ]) db.prepare("DELETE FROM _plugin_storage WHERE plugin_id = ? AND collection = ? AND id = ?")
      .run("dinkus-commerce", collection, id);
    if (ownedCartId)
      db.prepare("DELETE FROM _plugin_storage WHERE plugin_id = ? AND collection = ? AND id = ?")
        .run("dinkus-commerce", collections.carts, ownedCartId);
    if (ownedCapabilityId)
      db.prepare("DELETE FROM _plugin_storage WHERE plugin_id = ? AND collection = ? AND id = ?")
        .run("dinkus-commerce", collections.capabilities, ownedCapabilityId);
    if (ownedAttemptId) {
      const associationRows = db.prepare("SELECT id, data FROM _plugin_storage WHERE plugin_id = ? AND collection = ?")
        .all("dinkus-commerce", collections.associations);
      for (const row of associationRows) {
        const data = JSON.parse(row.data);
        if (data.attemptId === ownedAttemptId)
          db.prepare("DELETE FROM _plugin_storage WHERE plugin_id = ? AND collection = ? AND id = ?")
            .run("dinkus-commerce", collections.associations, row.id);
      }
    }
    if (firstCapabilityId) db.prepare('DELETE FROM _plugin_storage WHERE plugin_id=? AND collection=? AND id=?').run('dinkus-commerce',collections.capabilities,firstCapabilityId);
    if (settings) { const current = await loadMerchantStoreSettings(settings); await saveMerchantStoreSettings(settings,{expectedRevision:current.revision,requirePhoneNumber:originalSettings.settings.requirePhoneNumber}); }
    if (settingsDb) await settingsDb.destroy();
    db.close();
  }
});

test('merchant creates choices and edits independent and bulk prices through the mounted editor', async ({ page, request, browser }) => {
  const { native, filename } = proofDb();
  expect((await request.get('/_emdash/api/setup/dev-bypass')).status()).toBe(200);
  const db = new Database(filename);
  const catalog = native ? 'catalogItems' : 'catalog_items';
  const prices = native ? 'catalogPrices' : 'catalog_prices';
  const availability = native ? 'catalogManualAvailability' : 'catalog_manual_availability';
  const all = c => db.prepare('SELECT id,data FROM _plugin_storage WHERE plugin_id=? AND collection=?').all('dinkus-commerce',c).map(r => ({ id:r.id, ...JSON.parse(r.data) }));
  const name = 'Merchant variant proof';
  let owned = [];
  let shopperContext, shopper, guestId, guestCartId, guestAttemptId;
  const capture = async suffix => page.screenshot({ path: `${process.env.COMMERCE_PROOF_ARTIFACTS}/variant-merchant-${native ? 'native' : 'sandbox'}-${suffix}.png`, fullPage:true });
  try {
    await page.goto('/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/plugins/dinkus-commerce/products');
    await page.getByRole('button',{name:'Get Started'}).click({timeout:10000}).catch(() => {});
    await expect.poll(() => db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(`uidx_plugin_dinkus-commerce_${catalog}_skuKey`), {timeout:90000}).toBeTruthy();
    await page.getByRole('textbox',{name:'Name',exact:true}).fill(name);
    await page.getByRole('textbox',{name:'SKU',exact:true}).fill('MERCHANT-PROOF-SMALL');
    if (native) await page.getByRole('combobox',{name:'Fulfillment',exact:true}).selectOption('physical');
    else await page.getByRole('radio',{name:'Physical',exact:true}).check();
    await page.getByRole('button',{name:'Add product',exact:true}).click();
    await expect.poll(() => all(catalog).filter(r => r.name === name).length).toBe(1);
    const root = all(catalog).find(r => r.name === name);
    owned = [root.itemId];
    expect(root.variantProduct.defaultMemberId).toBe(root.itemId);
    expect(root.variantProduct.options).toHaveLength(0);
    await expect(page.getByRole('textbox',{name:'Regular',exact:true})).toHaveCount(1);
    await page.getByRole('textbox',{name:native ? 'New variant SKU' : 'Second SKU',exact:true}).fill('MERCHANT-PROOF-LARGE');
    if (native) {
      await page.getByRole('combobox',{name:'First fulfillment'}).selectOption('physical');
      await page.getByRole('combobox',{name:'Second fulfillment'}).selectOption('digital');
    } else {
      await page.locator('form').filter({has:page.getByRole('button',{name:'Add choices',exact:true})}).getByRole('radio',{name:'Physical',exact:true}).first().check();
      await page.locator('form').filter({has:page.getByRole('button',{name:'Add choices',exact:true})}).getByRole('radio',{name:'Digital',exact:true}).last().check();
    }
    await page.getByRole('button',{name:'Add choices',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'Regular',exact:true})).toHaveCount(2);
    if (native) {
      const switches = page.getByRole('switch',{name:'Manage stock',exact:true});
      await expect(switches).toHaveCount(2);
      for (let i=0;i<2;i++) { await expect(switches.nth(i)).toBeDisabled(); await expect(switches.nth(i)).not.toBeChecked(); }
    }
    const expanded = all(catalog).find(r => r.itemId === root.itemId).variantProduct;
    owned = expanded.members.map(m => m.catalogItemId);
    expect(expanded.defaultMemberId).toBe(root.itemId);
    const priceForms = page.locator('form').filter({has:page.getByRole('textbox',{name:'Regular',exact:true})});
    for (const [i, amount, status] of [[0,'20','Out of stock'],[1,'24','In stock']]) {
      const form = priceForms.nth(i);
      await form.getByRole('textbox',{name:'Regular',exact:true}).fill(amount);
      await form.getByRole('radio',{name:status,exact:true}).check();
      await form.getByRole('button',{name:/^Save/}).click();
      await expect(form.getByRole('textbox',{name:'Regular',exact:true})).toHaveValue(amount + '.00');
    }
    expect(all(prices).find(r => r.catalogItemId === owned[0]).regular.minor).toBe('2000');
    expect(all(prices).find(r => r.catalogItemId === owned[1]).regular.minor).toBe('2400');
    expect(all(availability).find(r => r.catalogItemId === owned[0]).status).toBe('out-of-stock');
    expect((all(availability).find(r => r.catalogItemId === owned[1])?.status ?? 'in-stock')).toBe('in-stock');
    if (native) {
      shopperContext = await browser.newContext(); shopper = await shopperContext.newPage();
      await shopper.goto(new URL('/', test.info().project.use.baseURL).href);
      const choices = shopper.locator(`[data-variants="${root.itemId}"]`);
      await expect(choices.locator(`input[value="${owned[0]}"]`)).toBeDisabled();
      await choices.locator(`input[value="${owned[1]}"]`).check();
      await shopper.getByRole('button',{name:'Prepare checkout'}).click();
      await expect(shopper.locator('[data-checkout-result]')).toContainText('"ok": true');
      const prepared = JSON.parse(await shopper.locator('[data-checkout-result]').textContent());
      guestId = (prepared.data ?? prepared).capabilityId;
      const capability = all('checkoutGuestCapabilities').find(r => r.capabilityId === guestId);
      guestCartId = capability.cartId;
      await shopper.getByRole('textbox',{name:'Email'}).fill('guest-shopper@example.test');
      await shopper.getByRole('button',{name:'Start checkout'}).click();
      await expect(shopper.locator('[data-checkout-result]')).toContainText('"state": "pending"');
      await expect(shopper.locator('[data-checkout-result]')).toContainText('\"minor\": \"2400\"');
      const started = JSON.parse(await shopper.locator('[data-checkout-result]').textContent());
      const checkout = (started.data ?? started).checkout;
      guestAttemptId = checkout.attemptId;
      expect(checkout.total.minor).toBe('2400');
      expect(checkout.variantSelections[0].catalogItemId).toBe(owned[1]);
      expect(checkout.variantSelections[0].selections[0].valueLabel).toBe('Large');
      expect(checkout.variantSelections[0].fulfillment).toBe('digital');
    }
    if (native) {
      await page.getByRole('checkbox',{name:'Include in bulk price'}).first().check();
      await page.getByRole('textbox',{name:'Same Regular price',exact:true}).fill('22');
      await page.getByRole('button',{name:'Apply to selected variants'}).click();
    } else {
      await page.getByRole('switch',{name:'Apply to Small',exact:true}).check();
      await page.getByRole('textbox',{name:'Same regular price',exact:true}).fill('22');
      await page.getByRole('button',{name:'Apply same price'}).click();
    }
    await expect.poll(() => all(prices).find(r => r.catalogItemId === owned[0]).regular.minor).toBe('2200');
    await expect(priceForms.nth(0).getByRole('textbox',{name:'Regular',exact:true})).toHaveValue('22.00');
    await expect(page.getByRole('button',{name:'Save choices',exact:true})).toBeEnabled();
    expect(all(prices).find(r => r.catalogItemId === owned[1]).regular.minor).toBe('2400');
    await page.getByRole('textbox',{name:native ? 'Value 2' : 'Value: Large',exact:true}).fill('Big');
    if (native) await page.getByRole('combobox',{name:'Large fulfillment',exact:true}).selectOption('physical');
    else await page.locator('form').filter({has:page.getByRole('button',{name:'Save choices'})}).getByRole('radio',{name:'Physical',exact:true}).last().check();
    const detailResponse = !native ? page.waitForResponse(r => r.url().endsWith('/admin') && r.request().method() === 'POST') : null;
    await page.getByRole('button',{name:'Save choices',exact:true}).click();
    if (detailResponse) { const r = await detailResponse; writeFileSync(`${process.env.COMMERCE_PROOF_ARTIFACTS}/merchant-details.json`, JSON.stringify({request:r.request().postDataJSON(),response:await r.json()},null,2)); }
    await expect.poll(() => all(catalog).find(r => r.itemId === root.itemId).variantProduct.options[0].values[1].label).toBe('Big');
    await expect(page.getByRole('textbox',{name:native ? 'Value 2' : 'Value: Big',exact:true})).toHaveValue('Big');
    await expect(page.getByRole('button',{name:'Save choices',exact:true})).toBeEnabled();
    const final = all(catalog).find(r => r.itemId === root.itemId).variantProduct;
    expect(final.members.map(m => m.catalogItemId)).toEqual(owned);
    expect(final.members[1].fulfillment).toBe('physical');
    // A concurrent price edit must refuse the stale form and retain the clerk's input.
    const currentPrice = all(prices).find(r => r.catalogItemId === owned[1]);
    const { id: priceId, ...editedPrice } = currentPrice;
    editedPrice.regular.minor = '2600';
    db.prepare('UPDATE _plugin_storage SET data=?,updated_at=? WHERE plugin_id=? AND collection=? AND id=?').run(JSON.stringify(editedPrice),new Date().toISOString(),'dinkus-commerce',prices,priceId);
    const staleForm = priceForms.nth(1);
    await staleForm.getByRole('textbox',{name:'Regular',exact:true}).fill('25');
    await staleForm.getByRole('button',{name:/^Save/}).click();
    await expect(staleForm.getByRole('textbox',{name:'Regular',exact:true})).toHaveValue('25');
    await expect.poll(() => all(prices).find(r => r.catalogItemId === owned[1]).regular.minor).toBe('2600');
    if (native) {
      await page.reload();
      await page.getByRole('button',{name:name,exact:true}).click();
    } else {
      await page.reload(); await page.getByRole('button',{name:'Open ' + name,exact:true}).click();
    }
    const freshForm = priceForms.nth(1);
    await expect(freshForm.getByRole('textbox',{name:'Regular',exact:true})).toHaveValue('26.00');
    await freshForm.getByRole('radio',{name:'Out of stock',exact:true}).check();
    await freshForm.getByRole('button',{name:/^Save/}).click();
    await expect.poll(() => all(availability).find(r => r.catalogItemId === owned[1])?.status).toBe('out-of-stock');
    if (shopper) {
      await shopper.getByRole('button',{name:'Refresh payment status'}).click();
      await expect(shopper.locator('[data-checkout-result]')).toContainText('"state": "paid"');
      const result = JSON.parse(await shopper.locator('[data-checkout-result]').textContent());
      const order = (result.data ?? result).checkout.order;
      expect(order.total.minor).toBe('2400');
      expect(order.variantSelections[0].selections[0].valueLabel).toBe('Large');
      expect(order.variantSelections[0].fulfillment).toBe('digital');
      const persisted = all('checkoutCarts').find(r => r.id === guestCartId).attempts.at(-1);
      expect(persisted.order.total.minor).toBe('2400');
      expect(persisted.order.variantSelections).toEqual(order.variantSelections);
      expect(persisted.payment.total.minor).toBe('2400');
      await shopper.setViewportSize({width:1440,height:1000});
      await shopper.screenshot({path:`${process.env.COMMERCE_PROOF_ARTIFACTS}/variant-journey-desktop.png`,fullPage:true});
      await shopper.setViewportSize({width:390,height:844});
      await shopper.screenshot({path:`${process.env.COMMERCE_PROOF_ARTIFACTS}/variant-journey-phone.png`,fullPage:true});
    }
    await capture('desktop');
    await page.setViewportSize({width:390,height:844}); await capture('phone');
  } finally {
    if (shopperContext) await shopperContext.close();
    for (const [c,id] of [['checkoutCarts',guestCartId],['checkoutGuestCapabilities',guestId]]) if (id) db.prepare('DELETE FROM _plugin_storage WHERE plugin_id=? AND collection=? AND id=?').run('dinkus-commerce',c,id);
    if (guestAttemptId) for (const row of all('checkoutPaymentAssociations').filter(r => r.attemptId === guestAttemptId)) db.prepare('DELETE FROM _plugin_storage WHERE plugin_id=? AND collection=? AND id=?').run('dinkus-commerce','checkoutPaymentAssociations',row.id);
    for (const id of owned) for (const c of [catalog,prices,availability]) db.prepare('DELETE FROM _plugin_storage WHERE plugin_id=? AND collection=? AND id=?').run('dinkus-commerce',c,id);
    db.close();
  }
});
