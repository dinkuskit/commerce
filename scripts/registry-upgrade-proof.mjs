#!/usr/bin/env node
// Registry upgrade proof: a sandboxed (Registry-shaped) store runs an older
// Commerce release on that release's own EmDash host, gets products, prices,
// settings and a product page through that release's own admin, then moves to
// this build in the documented order: this build on the old host first
// ("bridge", when the old host can load another build), then this build on this
// checkout's EmDash against the same database, which upgrades it. Run `npm run build` first. COMMERCE_UPGRADE_FROM picks the release;
// COMMERCE_UPGRADE_SPEC picks the spec in tests/sandbox (registry-upgrade.spec.mjs by default).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
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
  // The older release's library (its proof site's pages import it) and Registry bundle, built from its own tag;
  // the size gate is that release's, not this proof's.
  step(process.execPath, ["scripts/build.mjs"], { cwd: source });
  step(process.execPath, ["scripts/build-sandbox.mjs"], { cwd: source });
  const env = { COMMERCE_UPGRADE_DIR: directory, COMMERCE_UPGRADE_FROM: from,
    COMMERCE_UPGRADE_FROM_DESCRIPTOR: resolve(source, "dist/sandbox/index.mjs"),
    COMMERCE_UPGRADE_FROM_ARTIFACT: resolve(source, "dist/sandbox/plugin.mjs"), COMMERCE_UPGRADE_FROM_HOST: source };
  // Releases before 0.8.0 run a site that always loads its own build, so they skip the bridge.
  const bridge = readFileSync(resolve(source, "tests/sandbox-site/astro.config.mjs"), "utf8").includes("COMMERCE_SANDBOX_DESCRIPTOR");
  const phases = bridge ? ["old", "bridge", "new"] : ["old", "new"];
  for (const phase of phases) step(resolve("node_modules/.bin/playwright"), ["test", "--config=" + config], { env: { ...env, COMMERCE_UPGRADE_PHASE: phase } });
  console.log("registry_upgrade=pass from=" + from + " phases=" + phases.join(",") + " evidence=" + directory);
} finally {
  spawnSync("git", ["worktree", "remove", "--force", source], { stdio: "inherit" });
  rmSync(source, { recursive: true, force: true });
}
