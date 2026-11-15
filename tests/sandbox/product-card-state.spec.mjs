import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { productCardFixture } from '../helpers/product-card-fixture.mjs';
import { setProductPageOnSale } from '../../dist/features/catalog/kernel/index.js';

let renderer;
// A refused save redraws the form under a fresh block id, so typing before React commits that redraw is lost.
const drawn = page => page.waitForFunction(() => window.sentBlocks !== undefined && window.renderedBlocks === window.sentBlocks);
test.beforeAll(async () => {
  const result = await build({ stdin: { contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { BlockRenderer } from '@emdash-cms/blocks';
    function Panel() {
      const [blocks, setBlocks] = React.useState([]);
      window.showBlocks = setBlocks;
      // Marks the blocks React has committed, so the test acts on the panel the response drew, not the one before it.
      React.useEffect(() => { window.renderedBlocks = blocks; }, [blocks]);
      return React.createElement(BlockRenderer, { blocks, onAction: async input => {
        const result = await window.invokePanel(input);
        window.sentBlocks = result.blocks;
        setBlocks(result.blocks);
      }});
    }
    createRoot(document.getElementById('panel')).render(React.createElement(Panel));
  `, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  renderer = result.outputFiles[0].text;
});

for (const width of [1440, 390]) for (const variants of [false, true]) {
  test(`${width}px ${variants ? 'variant' : 'simple'} Shipping stays open through refusal and correction`, async ({ page }) => {
    const fixture = await productCardFixture(variants);
    const before = fixture.snapshot();
    const responses = [];
    await page.exposeFunction('invokePanel', async input => {
      const result = await fixture.invoke(input);
      responses.push(result);
      return result;
    });
    await page.setViewportSize({ width, height: 900 });
    await page.setContent('<main id="panel"></main>');
    await page.addScriptTag({ content: renderer });
    await page.waitForFunction(() => typeof window.showBlocks === 'function');
    await page.evaluate(blocks => window.showBlocks(blocks), (await fixture.invoke({ type: 'panel_load' })).blocks);
    const shipping = page.getByRole('button', { name: 'Shipping', exact: true });
    await expect(shipping).toHaveAttribute('aria-expanded', 'false');
    await shipping.click();
    const weights = page.getByRole('textbox', { name: /^Weight \(oz\)/ });
    await expect(weights.first()).toBeVisible();
    await weights.first().fill('-1');
    if (variants) await weights.nth(1).fill('6.5');
    await page.getByRole('button', { name: 'Save weight', exact: true }).click();
    await expect.poll(() => responses.length).toBe(1);
    await drawn(page);
    expect(responses[0].toast.type).toBe('error');
    expect(fixture.snapshot()).toEqual(before);
    // No reopen helper: that hid this regression in the installed scenario.
    await expect(shipping).toHaveAttribute('aria-expanded', 'true');
    await expect(weights.first()).toBeVisible();
    await expect(weights.first()).toHaveValue('-1');
    if (variants) await expect(weights.nth(1)).toHaveValue('6.5');
    await weights.first().fill('7');
    await page.getByRole('button', { name: 'Save weight', exact: true }).click();
    await expect.poll(() => responses.length).toBe(2);
    await drawn(page);
    expect(responses[1].toast.type).toBe('success');
    await expect(shipping).toHaveAttribute('aria-expanded', 'true');
    await expect(weights.first()).toHaveValue('7');
    // Removing the validation banner must not transfer state to Identifiers.
    await expect(page.getByRole('button', { name: 'Identifiers', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await shipping.click();
    await expect(shipping).toHaveAttribute('aria-expanded', 'false');
    expect(fixture.snapshot()).not.toEqual(before);
  });
}

// Archive is the page's own Move to trash (catalog-archive-is-page-trash-20261115): the panel offers no Archive or
// Restore, the publish check takes the product off sale and back, and publishing also sells a product 0.8.0's
// Archive button left archived. COMMERCE_ARCHIVE_PROOF_DIR keeps a screenshot of each state.
test('the panel has no Archive or Restore, and publishing sells a product archived before', async ({ page }) => {
  const fixture = await productCardFixture(false);
  const shots = process.env.COMMERCE_ARCHIVE_PROOF_DIR;
  if (shots) mkdirSync(shots, { recursive: true });
  await page.exposeFunction('invokePanel', input => fixture.invoke(input));
  await page.setViewportSize({ width: 520, height: 900 });
  await page.setContent('<main id="panel" style="padding:16px;font-family:system-ui"></main>');
  await page.addScriptTag({ content: renderer });
  await page.waitForFunction(() => typeof window.showBlocks === 'function');
  const panel = page.locator('#panel');
  const show = async (name, status) => {
    await page.evaluate(blocks => window.showBlocks(blocks), (await fixture.invoke({ type: 'panel_load' })).blocks);
    await expect(panel.getByText(status, { exact: true })).toBeVisible();
    if (shots) await panel.screenshot({ path: resolve(shots, `${name}.png`) });
    for (const button of ['Archive product', 'Restore']) await expect(page.getByRole('button', { name: button, exact: true })).toHaveCount(0);
  };
  const publishCheck = onSale => setProductPageOnSale(fixture.store, { entryId: 'page-fixture', onSale });
  await show('1-draft', 'Draft: publish to sell it');
  await publishCheck(true);
  await show('2-published-on-sale', 'On sale');
  // Move to trash: the store's publish check takes the product off sale and keeps it linked to the page.
  await publishCheck(false);
  await show('3-page-in-trash', 'Draft: publish to sell it');
  // Restore brings the page back as a Draft; publishing it sells the product again.
  await publishCheck(true);
  await show('4-restored-and-published', 'On sale');
  // A product 0.8.0's Archive button archived stays archived through the trash, and publishing sells it.
  const stored = await fixture.store.catalog.get(fixture.id);
  await fixture.store.catalog.put(fixture.id, { ...stored, archivedAt: '2026-11-01T00:00:00.000Z' });
  await show('5-archived-on-0.8.0', 'Archived: off the shop');
  await publishCheck(false);
  await show('6-archived-page-in-trash', 'Archived: off the shop');
  await publishCheck(true);
  await show('7-archived-then-published', 'On sale');
});
