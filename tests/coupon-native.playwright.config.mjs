import { defineConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const run = process.env.COMMERCE_COUPON_BROWSER_RUN ?? Date.now().toString();
process.env.COMMERCE_COUPON_BROWSER_RUN = run;
const artifacts = resolve(root, ".grilltrack/work/coupon-admin-browser-proof", run);
mkdirSync(artifacts, { recursive: true });
process.env.COMMERCE_COUPON_BROWSER_ARTIFACTS = artifacts;
process.env.COMMERCE_COUPON_BROWSER_DB = `file:${artifacts}/native-content.db`;

const port = Number(process.env.COMMERCE_COUPON_BROWSER_PORT ?? 64535);

export default defineConfig({
  testDir: "./sandbox",
  testMatch: /coupon-native\.spec\.mjs/,
  timeout: 180000,
  workers: 1,
  outputDir: `${artifacts}/test-results`,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: `../../node_modules/.bin/astro dev --host 127.0.0.1 --port ${port}`,
    cwd: resolve(root, "tests/native-coupon-site"),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      ASTRO_DEV_BACKGROUND: "1",
      COMMERCE_COUPON_BROWSER_DB: process.env.COMMERCE_COUPON_BROWSER_DB,
      EMDASH_SITE_URL: `http://127.0.0.1:${port}`,
      NO_PROXY: "127.0.0.1,localhost,::1",
      no_proxy: "127.0.0.1,localhost,::1",
    },
  },
});
