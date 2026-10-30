#!/usr/bin/env node
// Registry upgrade proof: a sandboxed (Registry-shaped) store runs an older
// Commerce release, gets products, prices, settings and a product page through
// that release's own admin, then restarts on this build against the same
// database. Run `npm run build` first. COMMERCE_UPGRADE_FROM picks the release.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const from = process.env.COMMERCE_UPGRADE_FROM ?? "v0.5.0";
const run = process.env.COMMERCE_PROOF_RUN ?? String(Date.now());
const directory = resolve(".tmp/registry-upgrade", run);
const source = resolve(directory, "source");
const config = process.env.COMMERCE_UPGRADE_PLAYWRIGHT_CONFIG ?? "tests/registry-upgrade.playwright.config.mjs";
const step = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: "inherit", ...options, env: { ...process.env, ...options.env } });
  if (result.status !== 0) throw new Error(command + " " + args.join(" ") + " failed");
};
if (!existsSync("dist/sandbox/plugin.mjs")) throw new Error("Run npm run build first");
step("git", ["worktree", "add", "--detach", source, from]);
try {
  // The older release installs from its own lockfile: its audited build pins
  // that release's EmDash packages, so this checkout's newer ones would fail it.
  step("npm", ["ci", "--no-audit", "--no-fund"], { cwd: source });
  // The older release's Registry bundle, built from its own tag; the size gate is that release's, not this proof's.
  step(process.execPath, ["scripts/build-sandbox.mjs"], { cwd: source });
  const env = { COMMERCE_UPGRADE_DIR: directory, COMMERCE_UPGRADE_FROM: from,
    COMMERCE_UPGRADE_FROM_DESCRIPTOR: resolve(source, "dist/sandbox/index.mjs"),
    COMMERCE_UPGRADE_FROM_ARTIFACT: resolve(source, "dist/sandbox/plugin.mjs") };
  for (const phase of ["old", "new"]) step(resolve("node_modules/.bin/playwright"), ["test", "--config=" + config], { env: { ...env, COMMERCE_UPGRADE_PHASE: phase } });
  console.log("registry_upgrade=pass from=" + from + " evidence=" + directory);
} finally {
  spawnSync("git", ["worktree", "remove", "--force", source], { stdio: "inherit" });
  rmSync(source, { recursive: true, force: true });
}
