import { defineConfig } from '@playwright/test';
import { bundlePlugin } from '@emdash-cms/plugin-cli';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Playwright reloads this config in workers. Persist the generated identity so
// the worker and web server use the same artifact and database directory.
process.env.COMMERCE_PROOF_RUN ??= String(Date.now());
const directory = resolve('.tmp/orders-blocks-proof', process.env.COMMERCE_PROOF_RUN);
mkdirSync(directory, { recursive: true });
const extracted = resolve(directory, 'extracted');
const receipt = resolve(directory, 'artifact.json');
if (!existsSync(receipt)) {
  const artifact = await bundlePlugin({ dir: resolve('.tmp/sandbox-source'), outDir: resolve(directory, 'build') });
  mkdirSync(extracted, { recursive: true });
  execFileSync('tar', ['-xf', artifact.tarballPath, '-C', extracted]);
  const manifest = JSON.parse(readFileSync(resolve(extracted, 'manifest.json')));
  writeFileSync(receipt, JSON.stringify({ tarballSha256: artifact.sha256, tarballBytes: artifact.tarballBytes,
    tarballPath: artifact.tarballPath, runtimeSha256: createHash('sha256').update(readFileSync(resolve(extracted, 'backend.js'))).digest('hex'), manifest }, null, 2));
}
const manifest = JSON.parse(readFileSync(resolve(extracted, 'manifest.json')));
if (manifest.id !== 'dinkus-commerce' || manifest.storage.coupons) throw new Error('Unexpected Commerce tarball registration');
const runtime = resolve(extracted, 'backend.js');
if (createHash('sha256').update(readFileSync(runtime)).digest('hex') !== JSON.parse(readFileSync(receipt)).runtimeSha256) {
  throw new Error('Frozen Commerce runtime changed');
}
const port = Number(process.env.COMMERCE_PROOF_PORT ?? 64541);
const publisher = 'did:plc:ekk4pjmkh3k3ql2kfoex3qt4';
const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
const digest = createHash('sha256').update(publisher + '\n' + manifest.id).digest();
let bits = 0, value = 0, encoded = '';
for (const byte of digest) {
  value = (value << 8) | byte; bits += 8;
  while (bits >= 5) { bits -= 5; encoded += alphabet[(value >>> bits) & 31]; }
}
// The installed harness site keeps its original coupon-era variable names.
process.env.COMMERCE_COUPON_PLUGIN_ID = 'r_' + encoded.slice(0, 16);
process.env.COMMERCE_COUPON_PUBLISHER = publisher;
process.env.COMMERCE_PROOF_DB = 'file:' + resolve(directory, 'content.db');
process.env.COMMERCE_PROOF_ARTIFACTS = directory;
process.env.COMMERCE_PROOF_STORAGE = resolve(directory, 'storage');
export default defineConfig({ testDir: './sandbox', testMatch: 'orders-blocks.spec.mjs', workers: 1, timeout: 180000,
  reporter: 'list', outputDir: resolve(directory, 'test-results'),
  use: { baseURL: 'http://127.0.0.1:' + port, viewport: { width: 1440, height: 1000 } },
  webServer: { command: '../../node_modules/.bin/astro dev --host 127.0.0.1 --port ' + port, cwd: resolve('tests/installed-coupon-site'),
    url: 'http://127.0.0.1:' + port, reuseExistingServer: false, timeout: 120000,
    env: { ASTRO_DEV_BACKGROUND: '1', COMMERCE_PROOF_DB: process.env.COMMERCE_PROOF_DB, COMMERCE_SANDBOX_ARTIFACT: runtime,
      EMDASH_SITE_URL: 'http://127.0.0.1:' + port, COMMERCE_SITE_URL: 'http://127.0.0.1:' + port,
      COMMERCE_PROOF_STORAGE: process.env.COMMERCE_PROOF_STORAGE, COMMERCE_COUPON_PLUGIN_ID: process.env.COMMERCE_COUPON_PLUGIN_ID,
      COMMERCE_COUPON_PUBLISHER: publisher,
      NO_PROXY: '127.0.0.1,localhost,::1', no_proxy: '127.0.0.1,localhost,::1' } },
});
