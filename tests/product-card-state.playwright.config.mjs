import { defineConfig } from '@playwright/test';

// Real pinned Block Kit renderer with disposable Commerce responses; no Astro server.
export default defineConfig({
  testDir: './sandbox', testMatch: ['product-card-state.spec.mjs', 'backorder-price-recovery.spec.mjs'], workers: 1,
  timeout: 30000, reporter: 'list', outputDir: '../.tmp/product-card-state',
  use: { browserName: 'chromium', headless: true, screenshot: 'off', trace: 'off' },
});
