import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import {writeFileSync} from "node:fs";
import { BLOCK_FORM, openCard, openPanel, openProductPage } from './product-page.mjs';

function proofDb() {
  const url = process.env.COMMERCE_PROOF_DB;
  if (!url) throw new Error("missing variant proof database");
  return url.replace(/^file:/, "");
}

test("same-origin storefront renders concrete grouped members", async ({ page, baseURL }) => {
  const db = new Database(proofDb());
  const now = "2026-10-08T00:00:00.000Z";
  const put = db.prepare("INSERT OR REPLACE INTO _plugin_storage (plugin_id, collection, id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
  const collections = { catalog: "catalog_items", prices: "catalog_prices", availability: "catalog_manual_availability" };
  const ids = {
    parent: "variant-proof-sandbox-parent",
    large: "variant-proof-sandbox-large",
  };
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
    base(ids.parent, "PROOF-SHIRT-" + "SANDBOX", product);
    base(ids.large, "PROOF-SHIRT-L-" + "SANDBOX", null, { variantProductId: ids.parent, variantSelections: [{ optionId: "size", valueId: "large" }], variantFulfillment: "physical" });
    price(ids.parent, "2000"); price(ids.large, "2400"); availability(ids.parent, "out-of-stock"); availability(ids.large, "in-stock");
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(new URL("/", baseURL).toString());
      const variants = page.locator(`[data-variants="${ids.parent}"]`);
      await expect(variants).toContainText("2400");
      const listing = db.prepare('SELECT data FROM _plugin_storage WHERE plugin_id=? AND collection=? AND id=?').get('dinkus-commerce','storefront_out_of_stock_listing','active');
      const hideOutOfStock = listing && JSON.parse(listing.data).hideOutOfStock === true;
      // Anonymous HTTP reads exercise the compiled Registry route, not an imported reader.
      for (const suffix of ['', '/item?itemId=' + ids.parent, '/item?itemId=' + ids.large]) {
        const response = await page.request.get(new URL('/_emdash/api/plugins/dinkus-commerce/catalog/public' + suffix, baseURL).toString());
        expect(response.ok()).toBe(true);
        const body = await response.json();
        expect(body.success).toBe(true);
        const family = suffix ? body.data : body.data.products.find(p => p.id === ids.parent);
        expect(family.sku).toBe('PROOF-SHIRT-SANDBOX');
        const expected = [[ids.large, 'PROOF-SHIRT-L-SANDBOX']];
        if (!hideOutOfStock) expected.unshift([ids.parent, 'PROOF-SHIRT-SANDBOX']);
        expect(family.variants.members.map(m => [m.catalogItemId, m.sku])).toEqual(expected);
      }
      if (hideOutOfStock) await expect(variants.locator(`input[value="${ids.parent}"]`)).toHaveCount(0);
      else {
        await expect(variants).toContainText('Small');
        await expect(variants.locator(`input[value="${ids.parent}"]`)).toBeDisabled();
      }
      await expect(variants.locator(`input[value="${ids.large}"]`)).toBeEnabled();

      await page.screenshot({ path: `${process.env.COMMERCE_PROOF_ARTIFACTS}/variant-checkout-sandbox-${width}.png`, fullPage: true });
    }
  } finally {
    for (const [collection, id] of [
      [collections.catalog, ids.parent], [collections.catalog, ids.large],
      [collections.prices, ids.parent], [collections.prices, ids.large],
      [collections.availability, ids.parent], [collections.availability, ids.large],
    ]) db.prepare("DELETE FROM _plugin_storage WHERE plugin_id = ? AND collection = ? AND id = ?")
      .run("dinkus-commerce", collection, id);
    db.close();
  }
});

test('merchant edits choices and independent prices on desktop and phone', async ({ page, request }) => {
  expect((await request.get('/_emdash/api/setup/dev-bypass')).status()).toBe(200);
  const db = new Database(proofDb());
  const catalog = 'catalog_items';
  const prices = 'catalog_prices';
  const availability = 'catalog_manual_availability';
  const all = c => db.prepare('SELECT id,data FROM _plugin_storage WHERE plugin_id=? AND collection=?').all('dinkus-commerce',c).map(r => ({ id:r.id, ...JSON.parse(r.data) }));
  const name = 'Merchant variant proof';
  let owned = [];
  const capture = async suffix => page.screenshot({ path: `${process.env.COMMERCE_PROOF_ARTIFACTS}/variant-merchant-sandbox-${suffix}.png`, fullPage:true });
  try {
    // Native and Registry installs both sell from the product page's Dinkus Commerce panel.
    await page.goto('/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/plugins/dinkus-commerce/settings');
    const getStarted = page.getByRole('button',{name:'Get Started'});
    const ready = page.getByRole('heading',{name:'Commerce settings'});
    await getStarted.or(ready).first().waitFor({state:'visible',timeout:60000});
    if (await getStarted.isVisible()) await getStarted.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(`uidx_plugin_dinkus-commerce_${catalog}_skuKey`), {timeout:90000}).toBeTruthy();
    const opened = await openProductPage(page, name), ui = opened.panel;
    await ui.getByRole('textbox',{name:'SKU',exact:true}).fill('MERCHANT-PROOF-SMALL');
    await ui.getByRole('button',{name:'Save',exact:true}).click();
    // Commerce keeps the page's link; nothing waits on the page's Save.
    await expect.poll(() => all(catalog).filter(r => r.name === name).length).toBe(1);
    const root = all(catalog).find(r => r.name === name);
    owned = [root.itemId];
    expect(root.variantProduct.defaultMemberId).toBe(root.itemId);
    expect(root.variantProduct.options).toHaveLength(0);
    await expect(ui.getByRole('textbox',{name:'Regular',exact:true})).toHaveCount(1);
    // The Variants card is collapsed on a simple product; Add options makes it variable with the product itself as the first variant,
    // and a new variant for each other value whose SKU is the product's SKU plus the value (catalog-panel-cards-20261031).
    await openCard(ui, /^Variants/);
    await ui.getByRole('textbox',{name:'Option values',exact:true}).fill('Small, Large');
    await ui.getByRole('button',{name:'Add options',exact:true}).click();
    await expect.poll(() => (all(catalog).find(r => r.itemId === root.itemId).variantProduct?.members ?? []).length).toBe(2);
    expect(all(catalog).find(r => r.sku === 'MERCHANT-PROOF-SMALL-LARGE'), 'the new variant takes the product SKU plus the value').toBeTruthy();
    // Large is digital in this walk: a variant's fulfillment is set in Edit options.
    await openCard(ui, 'Edit options');
    await ui.getByRole('radio',{name:'Digital',exact:true}).last().check();
    await ui.getByRole('button',{name:'Save options',exact:true}).click();
    await expect.poll(() => all(catalog).find(r => r.itemId === root.itemId).variantProduct.members[1].fulfillment).toBe('digital');
    await openCard(ui, /^Large/);
    await expect(ui.getByRole('textbox',{name:'Regular',exact:true})).toHaveCount(2);
    const expanded = all(catalog).find(r => r.itemId === root.itemId).variantProduct;
    owned = expanded.members.map(m => m.catalogItemId);
    expect(expanded.defaultMemberId).toBe(root.itemId);
    // Each variant's price form sits in its own card; a save redraws the panel with only the first card open.
    const priceForms = ui.locator(BLOCK_FORM).filter({has:page.getByRole('textbox',{name:'Regular',exact:true})});
    const cards = [/^Small/, /^(Large|Big)/, /^Medium/];
    for (const [i, amount, status] of [[0,'20','Out of stock'],[1,'24','In stock']]) {
      await openCard(ui, cards[i]);
      const form = priceForms.nth(i);
      await form.getByRole('textbox',{name:'Regular',exact:true}).fill(amount);
      await form.getByRole('radio',{name:status,exact:true}).check();
      await form.getByRole('button',{name:/^Save/}).click();
      await expect(form.getByRole('textbox',{name:'Regular',exact:true})).toHaveValue(amount + '.00');
    }
    expect(all(catalog).find(r => r.itemId === owned[0]).catalogData.items[owned[0]].price.regular.minor).toBe('2000');
    expect(all(catalog).find(r => r.itemId === owned[0]).catalogData.items[owned[1]].price.regular.minor).toBe('2400');
    expect(all(catalog).find(r => r.itemId === owned[0]).catalogData.items[owned[0]].availability.status).toBe('out-of-stock');
    expect((all(catalog).find(r => r.itemId === owned[0]).catalogData.items[owned[1]].availability?.status ?? 'in-stock')).toBe('in-stock');
    // The product page panel has no bulk price form; each choice keeps its own Save.
    await priceForms.nth(0).getByRole('textbox',{name:'Regular',exact:true}).fill('22');
    await priceForms.nth(0).getByRole('button',{name:/^Save/}).click();
    await expect.poll(() => all(catalog).find(r => r.itemId === owned[0]).catalogData.items[owned[0]].price.regular.minor).toBe('2200');
    await expect(priceForms.nth(0).getByRole('textbox',{name:'Regular',exact:true})).toHaveValue('22.00');
    await openCard(ui, 'Edit options');
    await expect(ui.getByRole('button',{name:'Save options',exact:true})).toBeEnabled();
    expect(all(catalog).find(r => r.itemId === owned[0]).catalogData.items[owned[1]].price.regular.minor).toBe('2400');
    await ui.getByRole('textbox',{name:'Value: Large',exact:true}).fill('Big');
    await ui.locator(BLOCK_FORM).filter({has:page.getByRole('button',{name:'Save options'})}).getByRole('radio',{name:'Physical',exact:true}).last().check();
    const detailResponse = page.waitForResponse(r => r.url().split('?')[0].endsWith('/panel/product') && r.request().method() === 'POST');
    await ui.getByRole('button',{name:'Save options',exact:true}).click();
    { const r = await detailResponse; writeFileSync(`${process.env.COMMERCE_PROOF_ARTIFACTS}/merchant-details-sandbox.json`, JSON.stringify({request:r.request().postDataJSON(),response:await r.json()},null,2)); }
    await expect.poll(() => all(catalog).find(r => r.itemId === root.itemId).variantProduct.options[0].values[1].label).toBe('Big');
    await openCard(ui, 'Edit options');
    await expect(ui.getByRole('textbox',{name:'Value: Big',exact:true})).toHaveValue('Big');
    await expect(ui.getByRole('button',{name:'Save options',exact:true})).toBeEnabled();
    const final = all(catalog).find(r => r.itemId === root.itemId).variantProduct;
    expect(final.members.map(m => m.catalogItemId)).toEqual(owned);
    expect(final.members[1].fulfillment).toBe('physical');
    // A concurrent price edit must refuse the stale form and retain the clerk's input.
    const { id: productKey, ...concurrentProduct } = all(catalog).find(r => r.itemId === root.itemId);
    concurrentProduct.catalogData.items[owned[1]].price.regular.minor = '2600';
    db.prepare('UPDATE _plugin_storage SET data=?,revision=?,updated_at=? WHERE plugin_id=? AND collection=? AND id=?')
      .run(JSON.stringify(concurrentProduct),crypto.randomUUID(),new Date().toISOString(),'dinkus-commerce',catalog,productKey);
    await openCard(ui, cards[1]);
    const staleForm = priceForms.nth(1);
    await staleForm.getByRole('textbox',{name:'Regular',exact:true}).fill('25');
    await staleForm.getByRole('button',{name:/^Save/}).click();
    // The refused form comes back with the typing, in its own card, which is the one left open.
    await expect(priceForms.last().getByRole('textbox',{name:'Regular',exact:true})).toHaveValue('25');
    await expect.poll(() => all(catalog).find(r => r.itemId === owned[0]).catalogData.items[owned[1]].price.regular.minor).toBe('2600');
    await page.reload(); await openPanel(page);
    await openCard(ui, cards[1]);
    const freshForm = priceForms.nth(1);
    await expect(freshForm.getByRole('textbox',{name:'Regular',exact:true})).toHaveValue('26.00');
    await freshForm.getByRole('radio',{name:'Out of stock',exact:true}).check();
    await freshForm.getByRole('button',{name:/^Save/}).click();
    await expect.poll(() => all(catalog).find(r => r.itemId === owned[0]).catalogData.items[owned[1]].availability?.status).toBe('out-of-stock');

    // Append second option (Size × Color) with explicit existing-member values (Sand for Small and Big), then add Medium / Ink.
    await openCard(ui, 'Add another option');
    await ui.getByRole('textbox',{name:'Option values',exact:true}).fill('Sand, Ink');
    await ui.getByRole('textbox',{name:'Value for Small',exact:true}).fill('Sand');
    await ui.getByRole('textbox',{name:'Value for Big',exact:true}).fill('Sand');
    await ui.getByRole('button',{name:'Add option',exact:true}).click();
    await expect.poll(() => all(catalog).find(r => r.itemId === root.itemId).variantProduct.options.length).toBe(2);
    await openCard(ui, 'Add a variant');
    await expect(ui.getByRole('textbox',{name:'Size',exact:true})).toBeVisible();
    await ui.getByRole('textbox',{name:'Size',exact:true}).fill('Medium');
    await ui.getByRole('textbox',{name:'Color',exact:true}).fill('Ink');
    await ui.getByRole('textbox',{name:'SKU',exact:true}).last().fill('MERCHANT-PROOF-MEDIUM-INK');
    await ui.locator(BLOCK_FORM).filter({has:page.getByRole('button',{name:'Add variant',exact:true})}).getByRole('radio',{name:'Digital',exact:true}).check();
    await ui.getByRole('button',{name:'Add variant',exact:true}).click();
    await expect.poll(() => all(catalog).find(r => r.itemId === root.itemId).variantProduct.members.length).toBe(3);
    owned = all(catalog).find(r => r.itemId === root.itemId).variantProduct.members.map(m => m.catalogItemId);
    await openCard(ui, cards[2]);
    const mediumForm = priceForms.last();
    await mediumForm.getByRole('textbox',{name:'Regular',exact:true}).fill('28');
    await mediumForm.getByRole('radio',{name:'In stock',exact:true}).check();
    await mediumForm.getByRole('button',{name:/^Save/}).click();
    await expect(mediumForm.getByRole('textbox',{name:'Regular',exact:true})).toHaveValue('28.00');
    expect(all(catalog).find(r => r.itemId === owned[0]).catalogData.items[owned[2]].price.regular.minor).toBe('2800');


    // Rename Color and Ink in the editor; the pending Medium / Ink order must keep its frozen Size / Color selections.
    await openCard(ui, 'Edit options');
    await ui.getByRole('textbox',{name:'Option: Color',exact:true}).fill('Shade');
    await ui.getByRole('textbox',{name:'Value: Ink',exact:true}).fill('Midnight');
    await ui.getByRole('button',{name:'Save options',exact:true}).click();
    await expect.poll(() => all(catalog).find(r => r.itemId === root.itemId).variantProduct.options[1].label).toBe('Shade');

    await capture('desktop');
    // Resizing alone can leave the Commerce panel collapsed in the phone sidebar.
    // Open the mounted controls and prove an actual save, not just a screenshot.
    await page.setViewportSize({width:390,height:844});
    const phonePanel = await openPanel(page);
    // Medium's card, opened on the phone; after its save the redraw leaves only that card open, so read the last price form.
    await openCard(phonePanel, cards[2]);
    const phoneForm = phonePanel.locator(BLOCK_FORM).filter({has:page.getByRole('textbox',{name:'Regular',exact:true})}).last();
    await expect(phoneForm.getByRole('textbox',{name:'Regular',exact:true})).toHaveValue('28.00');
    await phoneForm.getByRole('textbox',{name:'Regular',exact:true}).fill('29');
    await phoneForm.getByRole('button',{name:/^Save/}).click();
    await expect.poll(() => all(catalog).find(r => r.itemId === owned[0]).catalogData.items[owned[2]].price.regular.minor).toBe('2900');
    // The pinned host can close its phone sheet after a panel action. Reload
    // and reopen for durable readback; do not resubmit the price mutation.
    await page.reload();
    await openPanel(page);
    await openCard(phonePanel, cards[2]);
    await expect(phoneForm.getByRole('textbox',{name:'Regular',exact:true})).toHaveValue('29.00');
    await phoneForm.getByRole('textbox',{name:'Regular',exact:true}).scrollIntoViewIfNeeded();
    await capture('phone');
  } finally {
    for (const id of owned) for (const c of [catalog,prices,availability]) db.prepare('DELETE FROM _plugin_storage WHERE plugin_id=? AND collection=? AND id=?').run('dinkus-commerce',c,id);
    db.close();
  }
});
