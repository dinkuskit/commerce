import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const configUrl = new URL("../../playwright.config.mjs", import.meta.url).href;
const PROFILE = "COMMERCE_BROWSER_PROOF_PROFILE";
const names = ["sandbox", "native", "native-variant"];

function directory(t) {
  const cwd = mkdtempSync(join(tmpdir(), "commerce-browser-profile-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}
function environment(profile) {
  const env = { ...process.env, COMMERCE_PROOF_RUN: "profile-fixture", COMMERCE_PROOF_PORT: "64525" };
  delete env[PROFILE];
  if (profile !== undefined) env[PROFILE] = profile;
  return env;
}
function readConfig(cwd, profile) {
  const source = `
    const {default: config} = await import(${JSON.stringify(configUrl)});
    console.log(JSON.stringify({
      ...config,
      projects: config.projects.map(p => ({...p, testMatch: p.testMatch.source})),
      databases: [process.env.COMMERCE_PROOF_DB, process.env.COMMERCE_NATIVE_DB, process.env.COMMERCE_NATIVE_VARIANT_DB]
    }));
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd, env: environment(profile), encoding: "utf8", timeout: 15_000,
  });
  return { ...child, config: child.status === 0 ? JSON.parse(child.stdout) : undefined };
}

for (const profile of [undefined, ""]) {
  test(`default browser coverage remains three matched projects and hosts (${JSON.stringify(profile)})`, (t) => {
    const cwd = directory(t), result = readConfig(cwd, profile);
    assert.equal(result.status, 0, result.stderr);
    const config = result.config;
    assert.deepEqual(config.projects.map(p => p.name), names);
    assert.deepEqual(config.webServer.map(s => s.cwd), ["tests/sandbox-site", "tests/native-site", "tests/native-site"]);
    assert.deepEqual(config.projects.map(p => p.use.baseURL), config.webServer.map(s => s.url));
    assert.deepEqual(config.webServer.map(s => s.env.COMMERCE_PROOF_DB), config.databases);
    assert.equal(new Set(config.databases).size, 3);
    assert.equal(config.timeout, 180000);
    assert.equal(config.workers, 1);
    assert.ok(config.webServer.every(s => s.timeout === 120000 && s.reuseExistingServer === false));
    assert.equal(config.webServer[2].env.COMMERCE_NATIVE_SYNTHETIC, "1");
    assert.equal(config.webServer[2].env.COMMERCE_NATIVE_PUBLIC_CATALOG, "1");
  });
}

test("single-host opt-in retains the exact selected project/server configuration", async (t) => {
  const cwd = directory(t);
  const baseline = readConfig(cwd).config;
  for (const [index, profile] of names.entries()) {
    await t.test(profile, () => {
      const result = readConfig(cwd, profile);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.config, {
        ...baseline, projects: [baseline.projects[index]], webServer: [baseline.webServer[index]],
      });
    });
  }
});

test("unknown profile values fail before making artifact directories", async (t) => {
  for (const profile of ["registry", "Native", "native-varaint", "constructor", " "]) {
    await t.test(JSON.stringify(profile), (t) => {
      const cwd = directory(t), result = readConfig(cwd, profile);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /COMMERCE_BROWSER_PROOF_PROFILE/);
      assert.equal(existsSync(join(cwd, ".tmp")), false);
    });
  }
});

function gateFixture(t) {
  const cwd = directory(t), record = join(cwd, "calls.txt"), npm = join(cwd, "npm");
  writeFileSync(npm, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$COMMERCE_GATE_CALLS"\n');
  chmodSync(npm, 0o755);
  function run(mode, profile) {
    rmSync(record, { force: true });
    const result = spawnSync(join(root, "bin", "verify-commerce"), [mode], {
      env: { ...environment(profile), PATH: cwd + delimiter + process.env.PATH, COMMERCE_GATE_CALLS: record },
      encoding: "utf8", timeout: 15_000,
    });
    return { ...result, calls: existsSync(record) ? readFileSync(record, "utf8").trim().split("\n") : [] };
  }
  return run;
}

// bin/verify-commerce is POSIX sh; the mock npm records commands without running any gate.
const posix = { skip: process.platform === "win32" ? "POSIX verification wrapper" : false };
for (const mode of ["storefront", "core", "full"]) {
  test(`canonical ${mode} refuses a diagnostic profile before running any child gate`, posix, (t) => {
    const run = gateFixture(t);
    const result = run(mode, "native");
    assert.equal(result.status, 64, result.stderr);
    assert.match(result.stderr, /COMMERCE_BROWSER_PROOF_PROFILE/);
    assert.equal(result.stdout, "");
    assert.deepEqual(result.calls, []);
  });
}

test("canonical full still includes every gate by default and with an empty override", posix, (t) => {
  const run = gateFixture(t);
  const expected = [
    "run typecheck", "run test:unit", "run audit:repo", "run test:integration",
    "run build", "run test:sandbox", "run build", "run test:sandbox:orders",
    "run test:consumer:native", "run test:settings",
  ];
  for (const profile of [undefined, ""]) {
    const result = run("full", profile);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.calls, expected);
    assert.match(result.stdout, /verify-commerce: full passed/);
  }
});

test("quick checks ignore the browser-only override and unsupported modes remain usage errors", posix, (t) => {
  const run = gateFixture(t);
  const quick = run("quick", "native");
  assert.equal(quick.status, 0, quick.stderr);
  assert.deepEqual(quick.calls, ["run typecheck", "run test:unit", "run audit:repo"]);
  const invalid = run("unsupported", "native");
  assert.equal(invalid.status, 64);
  assert.deepEqual(invalid.calls, []);
});
