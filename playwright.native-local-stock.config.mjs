import { defineConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const run = process.env.COMMERCE_PROOF_RUN ?? `native-local-stock-${Date.now()}`;
process.env.COMMERCE_PROOF_RUN = run;
const directory = resolve(".tmp/sandbox-proof", run);
mkdirSync(directory, { recursive: true });

const port = Number(process.env.COMMERCE_LOCAL_STOCK_PORT ?? 19751);
const siteUrl = "http://127.0.0.1:" + port;

process.env.COMMERCE_NATIVE_DB = "file:" + directory + "/native-local-stock.db";
process.env.COMMERCE_PROOF_ARTIFACTS = directory;
process.env.EMDASH_SITE_URL = siteUrl;
process.env.COMMERCE_ENABLE_LOCAL_STOCK = "true";

export default defineConfig({
  testDir: "./tests/sandbox",
  timeout: 180000,
  workers: 1,
  outputDir: directory + "/test-results",
  reporter: "list",
  projects: [
    {
      name: "native-local-stock",
      testMatch: /native-local-stock\.spec\.mjs/,
      use: {
        baseURL: siteUrl,
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  webServer: {
    command: "../../node_modules/.bin/astro dev --host 127.0.0.1 --port " + port,
    cwd: "tests/native-local-site",
    url: siteUrl,
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      ASTRO_DEV_BACKGROUND: "1",
      COMMERCE_PROOF_DB: process.env.COMMERCE_NATIVE_DB,
      COMMERCE_ENABLE_LOCAL_STOCK: "true",
      EMDASH_SITE_URL: siteUrl,
      NO_PROXY: "127.0.0.1,localhost,::1",
      no_proxy: "127.0.0.1,localhost,::1",
    },
  },
});
