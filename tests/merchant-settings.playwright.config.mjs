import { defineConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const directory = resolve(".grilltrack/work/country-settings-20261008/browser", process.env.COMMERCE_SETTINGS_PROOF_RUN ?? Date.now().toString());
mkdirSync(directory, { recursive: true });
const port = Number(process.env.COMMERCE_SETTINGS_PROOF_PORT ?? 64635);
process.env.COMMERCE_SETTINGS_ARTIFACTS = directory;
export default defineConfig({
  testDir: "./sandbox", testMatch: "merchant-settings.spec.mjs", timeout: 180000,
  workers: 1, reporter: "list", outputDir: directory + "/test-results",
  projects: [
    { name: "registry", use: { baseURL: "http://127.0.0.1:" + port, viewport: { width: 1440, height: 1100 } } },
    { name: "native", use: { baseURL: "http://127.0.0.1:" + (port + 2), viewport: { width: 1440, height: 1100 } } },
  ],
  webServer: ["sandbox-site", "native-site"].map((site, index) => ({
    command: "../../node_modules/.bin/astro dev --host 127.0.0.1 --port " + (port + index * 2),
    cwd: resolve("tests/" + site), url: "http://127.0.0.1:" + (port + index * 2), reuseExistingServer: false,
    timeout: 120000, env: { ASTRO_DEV_BACKGROUND: "1", COMMERCE_PROOF_DB: "file:" + directory + "/" + site + ".db",
      EMDASH_SITE_URL: "http://127.0.0.1:" + (port + index * 2), COMMERCE_SITE_URL: "http://127.0.0.1:" + (port + index * 2),
      NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" },
  })),
});
