import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runCli } from "../../cli/kernel.mjs";
import { spec } from "../../cli/spec.mjs";
import { shop } from "../features/catalog/catalog-store.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const BASE = "https://base.example.test";
const TARGET = "https://selected.example.test";
const TOKEN = "synthetic-profile-fixture-credential";
const CREATE = ["products", "create", "--name", "Profile fixture", "--sku", "PROFILE-FIXTURE", "--command-id", "profile-fixture", "--no-input"];
const INHERITED = ["constructor", "toString", "__proto__", "hasOwnProperty"];

async function fixture(t, { user, project } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "commerce-profile-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cwd = join(directory, "project");
  const configHome = join(directory, "config");
  await mkdir(cwd, { recursive: true });
  for (const [path, config] of [
    [join(cwd, ".dinkuskit", "commerce.json"), project],
    [join(configHome, "dinkuskit", "commerce", "config.json"), user],
  ]) {
    if (config === undefined) continue;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(config));
  }
  const env = { HOME: directory, XDG_CONFIG_HOME: configHome, EMDASH_TOKEN: TOKEN };
  async function run(argv, overrides = {}) {
    let stdout = "", stderr = "";
    const calls = [];
    const code = await runCli(spec, {
      argv, env: { ...env, ...overrides }, cwd,
      stdout: { write: (chunk) => { stdout += chunk; return true; } },
      stderr: { write: (chunk) => { stderr += chunk; return true; } },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ success: true, data: { catalogItemId: "fixture-draft" } }), { status: 200 });
      },
    });
    assert.equal(stdout.includes(TOKEN) || stderr.includes(TOKEN), false);
    return { code, stdout, stderr, calls };
  }
  return { run, env, cwd };
}

function refused(result, code) {
  assert.equal(result.code, 2, result.stderr);
  assert.equal(result.calls.length, 0, "invalid profile must not dispatch any request");
  const document = JSON.parse(result.stdout);
  assert.equal(document.error.code, code);
  assert.equal(document.outcome, "error");
  assert.equal(document.data, undefined);
}

for (const location of ["user", "project"]) {
  test(`inherited profile names are absent from ${location} config`, async (t) => {
    const { run } = await fixture(t, { [location]: { url: BASE, profiles: {} } });
    for (const name of INHERITED) {
      await t.test(name, async () => {
        refused(await run(["--profile", name, ...CREATE, "--json"]), "unknown_profile");
      });
    }
  });
}

test("malformed selected profiles cannot silently inherit the base destination", async (t) => {
  for (const value of [null, false, true, 0, 1, TARGET, []]) {
    await t.test(JSON.stringify(value), async (t) => {
      const { run } = await fixture(t, { user: { url: BASE, profiles: { staging: value } } });
      const result = await run(["--profile", "staging", ...CREATE, "--json"]);
      refused(result, "invalid_config");
      assert.match(result.stderr, /staging.*JSON object/);
    });
  }
});

test("a requested profile requires an object profile map", async (t) => {
  for (const value of [null, false, true, 42, TARGET, []]) {
    await t.test(JSON.stringify(value), async (t) => {
      const { run } = await fixture(t, { user: { url: BASE, profiles: value } });
      const result = await run(["--profile", "staging", ...CREATE, "--json"]);
      refused(result, "invalid_config");
      assert.match(result.stderr, /profiles.*JSON object/);
    });
  }
});

test("environment-selected profiles fail closed in every output mode", async (t) => {
  for (const mode of [[], ["--plain"], ["--json"]]) {
    await t.test(mode[0] ?? "human", async (t) => {
      const { run } = await fixture(t, { user: { url: BASE, profiles: { staging: TARGET } } });
      for (const [name, code] of [["constructor", "unknown_profile"], ["staging", "invalid_config"]]) {
        const result = await run([...CREATE, ...mode], { DINKUS_COMMERCE_PROFILE: name });
        assert.equal(result.code, 2, result.stderr);
        assert.equal(result.calls.length, 0);
        if (mode[0] === "--json") assert.equal(JSON.parse(result.stdout).error.code, code);
        else if (mode[0] === "--plain") assert.match(result.stdout, new RegExp(`code=${code}`));
        else assert.equal(result.stdout, "");
      }
    });
  }
});

test("explicit own profile names, including prototype-like names, remain usable", async (t) => {
  for (const name of [...INHERITED, "staging"]) {
    await t.test(name, async (t) => {
      const profiles = Object.fromEntries([[name, { url: TARGET, "plugin-id": "selected-commerce" }]]);
      const { run } = await fixture(t, { user: { url: BASE, profiles }, project: { profiles: {} } });
      const result = await run(["--profile", name, ...CREATE, "--json"]);
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout).context, { siteUrl: TARGET, pluginId: "selected-commerce" });
      assert.equal(result.calls.length, 1);
      assert.equal(result.calls[0].url.href, `${TARGET}/_emdash/api/plugins/selected-commerce/catalog`);
      assert.equal(result.calls[0].init.headers.authorization, `Bearer ${TOKEN}`);
      assert.equal(result.calls[0].init.method, "POST");
    });
  }
});

test("valid empty overrides and unselected malformed entries retain their existing behavior", async (t) => {
  const { run } = await fixture(t, { user: { url: BASE, profiles: { staging: {}, unused: TARGET } } });
  const result = await run(["--profile", "staging", ...CREATE, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).context.siteUrl, BASE);
  const base = await run([...CREATE, "--json"]);
  assert.equal(base.code, 0, base.stderr);
  assert.equal(JSON.parse(base.stdout).context.siteUrl, BASE);
});

test("profile flag still overrides profile environment and explicit endpoint flags retain precedence", async (t) => {
  const { run } = await fixture(t, { user: { url: BASE, profiles: { staging: { url: TARGET } } } });
  const result = await run(["--profile", "staging", "--url", "https://flag.example.test", ...CREATE, "--json"], { DINKUS_COMMERCE_PROFILE: "constructor" });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).context.siteUrl, "https://flag.example.test");
});

test("project profile authority is unchanged and malformed project selections are rejected", async (t) => {
  const { run } = await fixture(t, { project: { url: BASE, profiles: { valid: { url: TARGET }, broken: true } } });
  refused(await run(["--profile", "broken", ...CREATE, "--json"]), "invalid_config");
  const result = await run(["--profile", "valid", ...CREATE, "--json"]);
  assert.equal(result.code, 4);
  assert.equal(JSON.parse(result.stdout).error.code, "untrusted_site_url");
  assert.equal(result.calls.length, 0);
});

test("help and version still bypass malformed requested configuration", async (t) => {
  const { run } = await fixture(t, { user: { url: BASE, profiles: { staging: true } } });
  for (const argv of [["--profile", "staging", ...CREATE, "--help"], ["--profile", "staging", "--version"]]) {
    const result = await run(argv);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.calls.length, 0);
    assert.equal(result.stderr, "");
  }
});

async function subprocess(argv, options) {
  const child = spawn(process.execPath, [join(root, "bin", "dinkus-commerce.mjs"), ...argv], { ...options, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    return await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
  } finally {
    clearTimeout(timer);
  }
}

test("the executable never creates a Draft at the base loopback site for an invalid requested profile", async (t) => {
  for (const [name, profiles, errorCode] of [
    ["constructor", {}, "unknown_profile"],
    ["staging", { staging: TARGET }, "invalid_config"],
  ]) {
    await t.test(name, { timeout: 15_000 }, async (t) => {
      const { ctx, call } = shop();
      const requests = [];
      const serverErrors = [];
      const server = createServer(async (request, response) => {
        try {
          let text = "";
          for await (const chunk of request) text += chunk;
          requests.push({ method: request.method, url: request.url });
          assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
          assert.equal(request.method, "POST");
          assert.equal(request.url, "/_emdash/api/plugins/dinkus-commerce/catalog");
          const data = await call(JSON.parse(text));
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ success: true, data }));
        } catch (error) {
          serverErrors.push(error);
          response.writeHead(500).end();
        }
      });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
      const { env, cwd } = await fixture(t, { user: { url: `http://127.0.0.1:${server.address().port}`, profiles } });
      const result = await subprocess(["--profile", name, ...CREATE, "--json"], { cwd, env });
      assert.equal(result.signal, null, result.stderr);
      assert.deepEqual(serverErrors, []);
      t.diagnostic(JSON.stringify({ profile: name, requests: requests.length, catalogItems: ctx.storage.catalog_items.records.size }));
      assert.equal(requests.length, 0, "invalid profile must not send an authenticated creation request to the base site");
      assert.equal(ctx.storage.catalog_items.records.size, 0, "no Draft may be created in the synthetic base-site catalog");
      assert.equal(result.code, 2, result.stderr);
      assert.equal(JSON.parse(result.stdout).error.code, errorCode);
    });
  }
});
