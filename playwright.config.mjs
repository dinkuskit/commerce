import { defineConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Project and host entries below share this order; diagnostic selection keeps
// their existing configuration intact. Commerce has one build, the Registry
// (sandboxed) one, so its sandbox lane is the only one; the native lanes went
// with the native entry (commerce-remove-native-entry-20261101).
const profiles = ["sandbox"];
const profile = process.env.COMMERCE_BROWSER_PROOF_PROFILE;
if (profile && !profiles.includes(profile)) {
  throw new Error("COMMERCE_BROWSER_PROOF_PROFILE must be sandbox");
}
const selected = (_, index) => !profile || profiles[index] === profile;

const run = process.env.COMMERCE_PROOF_RUN ?? Date.now().toString();
process.env.COMMERCE_PROOF_RUN = run;
const directory = resolve(".tmp/sandbox-proof", run);
mkdirSync(directory, { recursive: true });

const port = Number(process.env.COMMERCE_PROOF_PORT ?? 64525);

process.env.COMMERCE_PROOF_DB = "file:" + directory + "/content.db";
process.env.COMMERCE_PROOF_ARTIFACTS = directory;

export default defineConfig({
  testDir: "./tests/sandbox",
  timeout: 180000,
  workers: 1,
  outputDir: directory + "/test-results",
  reporter: "list",
  projects: [
    {
      name: "sandbox",
      testMatch: /commerce\.spec\.mjs|guest-checkout\.spec\.mjs|product-needs-page\.spec\.mjs|variant-checkout\.spec\.mjs|shopper-profile\.spec\.mjs/,
      use: {
        baseURL: "http://127.0.0.1:" + port,
        viewport: { width: 1440, height: 1000 },
      },
    },
  ].filter(selected),
  webServer: [
    {
      command: "../../node_modules/.bin/astro dev --host 127.0.0.1 --port " + port,
      cwd: "tests/sandbox-site",
      url: "http://127.0.0.1:" + port,
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        ASTRO_DEV_BACKGROUND: "1",
        COMMERCE_PROOF_DB: process.env.COMMERCE_PROOF_DB,
        EMDASH_SITE_URL: "http://127.0.0.1:" + port,
        COMMERCE_SITE_URL: "http://127.0.0.1:" + port,
        NO_PROXY: "127.0.0.1,localhost,::1",
        no_proxy: "127.0.0.1,localhost,::1",
      },
    },
  ].filter(selected),
});
