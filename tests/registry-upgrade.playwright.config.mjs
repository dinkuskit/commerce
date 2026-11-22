import { defineConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Run by scripts/registry-upgrade-proof.mjs against one database: the older
// release's build on its own site and EmDash (COMMERCE_UPGRADE_PHASE=old), this
// build on that same old site (bridge), then this build on this checkout (new).
const phase = process.env.COMMERCE_UPGRADE_PHASE;
if (!["old", "bridge", "new"].includes(phase)) throw new Error("Run scripts/registry-upgrade-proof.mjs");
const directory = resolve(process.env.COMMERCE_UPGRADE_DIR);
mkdirSync(directory, { recursive: true });
process.env.COMMERCE_PROOF_DB = "file:" + directory + "/content.db";
process.env.COMMERCE_PROOF_ARTIFACTS = directory;
const port = Number(process.env.COMMERCE_PROOF_PORT ?? 64561);
const old = phase === "old" ? { COMMERCE_SANDBOX_DESCRIPTOR: process.env.COMMERCE_UPGRADE_FROM_DESCRIPTOR,
  COMMERCE_SANDBOX_ARTIFACT: process.env.COMMERCE_UPGRADE_FROM_ARTIFACT }
  : phase === "bridge" ? { COMMERCE_SANDBOX_DESCRIPTOR: resolve("dist/sandbox/index.mjs"), COMMERCE_SANDBOX_ARTIFACT: resolve("dist/sandbox/plugin.mjs") } : {};
// A release pins its own EmDash; this checkout's EmDash may name storage indexes differently (1.5 does).
const host = phase === "new" ? resolve(".") : resolve(process.env.COMMERCE_UPGRADE_FROM_HOST);

export default defineConfig({
  testDir: "./sandbox", testMatch: process.env.COMMERCE_UPGRADE_SPEC ?? "registry-upgrade.spec.mjs", timeout: 240000, workers: 1,
  outputDir: directory + "/test-results-" + phase, reporter: "list",
  use: { baseURL: "http://127.0.0.1:" + port, viewport: { width: 1440, height: 1000 } },
  webServer: {
    // --force: the old phase's dev server may still hold the site's lock for a moment when the new phase starts.
    command: resolve(host, "node_modules/.bin/astro") + " dev --force --host 127.0.0.1 --port " + port,
    cwd: resolve(host, "tests/sandbox-site"), url: "http://127.0.0.1:" + port, reuseExistingServer: false, timeout: 120000,
    env: { ASTRO_DEV_BACKGROUND: "1", COMMERCE_PROOF_DB: process.env.COMMERCE_PROOF_DB, ...old,
      EMDASH_SITE_URL: "http://127.0.0.1:" + port, COMMERCE_SITE_URL: "http://127.0.0.1:" + port,
      NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" },
  },
});
