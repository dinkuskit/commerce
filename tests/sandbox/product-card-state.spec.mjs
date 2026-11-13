import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { productCardFixture } from '../helpers/product-card-fixture.mjs';

let renderer;
test.beforeAll(async () => {
  const result = await build({ stdin: { contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { BlockRenderer } from '@emdash-cms/blocks';
    function Panel() {
      const [blocks, setBlocks] = React.useState([]);
      window.showBlocks = setBlocks;
      return React.createElement(BlockRenderer, { blocks, onAction: async input => {
        const result = await window.invokePanel(input);
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
