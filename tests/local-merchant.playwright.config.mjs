import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
const directory = process.env.LOCAL_MERCHANT_DIRECTORY;
if (!directory || !process.env.LOCAL_MERCHANT_RUN) throw new Error('Use npm run test:merchant:local -- --payments <checkout>');
const port = Number(process.env.LOCAL_MERCHANT_PORT ?? 64751);
export default defineConfig({
  testDir: './local-merchant', testMatch: 'journey.spec.mjs', workers: 1, retries: 0, timeout: 180000,
  reporter: [['list']], outputDir: resolve(directory, 'test-results'),
  use: { actionTimeout: 15000, baseURL: 'http://127.0.0.1:' + port, viewport: { width: 1440, height: 1100 }, trace: 'off', screenshot: 'off', video: 'off' },
  webServer: { command: '../../../node_modules/.bin/astro dev --host 127.0.0.1 --port ' + port,
    cwd: resolve('tests/local-merchant/site'), url: 'http://127.0.0.1:' + port,
    reuseExistingServer: false, timeout: 120000,
    env: { ASTRO_DEV_BACKGROUND: '1', EMDASH_SITE_URL: 'http://127.0.0.1:' + port,
      LOCAL_MERCHANT_DB: 'file:' + resolve(directory, 'content.db'), LOCAL_MERCHANT_STORAGE: resolve(directory, 'storage'),
      NO_PROXY: '127.0.0.1,localhost,::1', no_proxy: '127.0.0.1,localhost,::1' } },
});
