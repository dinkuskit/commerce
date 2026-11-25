import { expect, test as base } from '@playwright/test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { compiledProductPanel } from '../helpers/compiled-product-panel.mjs';

const require = createRequire(import.meta.url);
const test = base.extend({
  fixture: async ({}, use) => {
    const fixture = await compiledProductPanel();
    try { await use(fixture); } finally { await fixture.close(); }
  },
});
let renderer;
test.beforeAll(async () => {
  const result = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { BlockRenderer } from '@emdash-cms/blocks';
      const root = createRoot(document.getElementById('panel'));
      window.draw = (view) => root.render(React.createElement(BlockRenderer, {
        blocks: view.blocks, onAction: async (input) => window.draw(await window.invoke(input)),
      }));` },
    bundle: true, write: false, format: 'iife', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  renderer = result.outputFiles[0].text;
});

for (const width of [1440, 390]) {
  test(`${width}px: a refused price keeps the backorder draft without publishing it`, async ({ page, fixture }) => {
    const offer = await fixture.offer('page-tote', 'TRAIL-TOTE');
    await page.exposeFunction('invoke', offer.panel);
    await page.setViewportSize({ width, height: 900 });
    await page.setContent('<main id="panel" style="max-width:360px;margin:0 auto;padding:16px"></main>');
    await page.addStyleTag({ path: require.resolve('@cloudflare/kumo/styles').replace(/kumo\.css$/, 'kumo-standalone.css') });
    await page.addScriptTag({ content: renderer });
    await page.evaluate((view) => window.draw(view), await offer.panel({ type: 'panel_load' }));

    const panel = page.locator('#panel');
    const regular = panel.getByRole('textbox', { name: 'Regular', exact: true });
    const sale = panel.getByRole('textbox', { name: 'Sale', exact: true });
    const save = panel.getByRole('button', { name: 'Save', exact: true });
    const backorder = panel.getByRole('radio', { name: 'On backorder', exact: true });
    const date = panel.locator('input[type="date"]');
    await expect(regular).toHaveValue('20.00');
    const readOffer = async () => {
      const product = await offer.publicOffer();
      return { status: product.availability.status, shipBy: product.availability.shipBy ?? null, minor: product.price.minor };
    };
    const startingOffer = { status: 'in-stock', shipBy: null, minor: '2000' };
    expect(await readOffer()).toEqual(startingOffer);

    const shipBy = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    await backorder.check();
    await date.fill(shipBy);
    await sale.fill('25');
    await save.click();
    const error = panel.getByText('Sale must be lower than Regular.', { exact: true });
    await expect(error).toBeVisible();
    expect(await readOffer()).toEqual(startingOffer);
    await test.info().attach('Refused price panel', { body: await panel.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
    await test.info().attach('Rendered state', { body: JSON.stringify({
      backorderChecked: await backorder.getAttribute('aria-checked'), dateVisible: await date.isVisible(),
      dateValue: await date.isVisible() ? await date.inputValue() : null, publicOffer: await readOffer(),
    }), contentType: 'application/json' });
    if (process.env.COMMERCE_CAPTURE_PANEL_HTML === '1') {
      const html = await page.evaluate(() => document.documentElement.outerHTML);
      await test.info().attach('Panel HTML', { body: '<!doctype html>' + html, contentType: 'text/html' });
    }
    await expect(backorder).toBeChecked();
    await expect(date).toBeVisible();
    await expect(date).toHaveValue(shipBy);

    // The clerk fixes only the invalid price. Stock and date must not need re-entry.
    await sale.fill('15');
    await save.click();
    await expect(error).not.toBeVisible();
    await expect.poll(readOffer).toEqual({ status: 'available-on-backorder', shipBy, minor: '1500' });
    await test.info().attach('Corrected offer', { body: JSON.stringify(await readOffer()), contentType: 'application/json' });
  });
}
