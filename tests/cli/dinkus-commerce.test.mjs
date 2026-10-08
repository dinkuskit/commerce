import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DEFAULT_PLUGIN_ID, ROUTES } from "../../cli/client.mjs";
import { runCli } from "../../cli/kernel.mjs";
import { spec } from "../../cli/spec.mjs";
import {
  COMMERCE_PLUGIN_ID,
  LIST_CATALOG_PRODUCTS_ROUTE,
  PUBLIC_CATALOG_ITEM_ROUTE,
  PUBLIC_CATALOG_ROUTE,
  SET_CATALOG_ITEM_REGULAR_PRICE_ROUTE,
  SET_CATALOG_ITEM_SALE_PRICE_ROUTE,
  SET_CATALOG_ITEM_SKU_ROUTE,
} from "../../dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const SITE = "https://shop.example";
const BASE = `${SITE}/_emdash/api/plugins/dinkus-commerce`;
const TOKEN = ["fixture", "never", "printed"].join("-");

function sink() {
  let text = "";
  return { write: (chunk) => { text += chunk; return true; }, get text() { return text; } };
}

function product(id, overrides = {}) {
  return {
    id,
    name: `Demo ${id}`,
    sku: id.toUpperCase(),
    price: { currency: "USD", minor: "1999" },
    availability: { status: "in-stock", sellable: true, listable: true },
    image: null,
    gallery: [],
    ...overrides,
  };
}

const ok = (data) => ({ status: 200, body: { success: true, data } });
const fail = (status, code, message = code) => ({ status, body: { success: false, error: { code, message } } });

// Fake fetch: routes map "<route>" or "<route>?<query>" to a response.
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, init });
    const route = parsed.pathname.replace("/_emdash/api/plugins/dinkus-commerce/", "");
    const reply = routes[`${route}${parsed.search}`] ?? routes[route] ?? fail(404, "NOT_FOUND", "Plugin route not found");
    if (reply instanceof Error) throw reply;
    const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
    return new Response(text, { status: reply.status });
  };
  return { fetchImpl, calls };
}

async function run(argv, { routes = {}, env = {}, cwd = root, fetchImpl } = {}) {
  const stdout = sink();
  const stderr = sink();
  const fake = fakeFetch(routes);
  const code = await runCli(spec, {
    argv,
    env: { HOME: "/nonexistent-home", ...env },
    cwd,
    stdout,
    stderr,
    fetchImpl: fetchImpl ?? fake.fetchImpl,
  });
  return { code, stdout: stdout.text, stderr: stderr.text, calls: fake.calls };
}

const singleJson = (text) => {
  assert.equal(text.trim().split("\n").length, 1, "JSON mode prints exactly one line");
  return JSON.parse(text);
};

test("help works at every depth, ignores other arguments, and writes only stdout", async () => {
  for (const argv of [
    ["--help"],
    ["help"],
    ["-h", "--bogus-flag"],
    ["catalog", "--help"],
    ["help", "catalog", "list"],
    ["catalog", "show", "--help", "--json", "--plain"],
    ["products", "set-price", "-h"],
    ["orders", "--help"],
    ["settings", "show", "--help"],
  ]) {
    const result = await run(argv);
    assert.equal(result.code, 0, argv.join(" "));
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /^Usage:$/m);
    assert.match(result.stdout, /Docs: https:\/\/github\.com\/dinkuskit\/commerce\/blob\/main\/docs\/CLI-SPEC\.md/);
    assert.equal(result.calls.length, 0);
  }
  assert.match((await run(["--help"])).stdout, /EMDASH_TOKEN/);
  assert.match((await run(["catalog", "list", "--help"])).stdout, /--cursor <cursor>/);
});

test("--version prints only the package version at any depth", async () => {
  for (const argv of [["--version"], ["catalog", "list", "--version"], ["products", "set-sku", "--version"]]) {
    const result = await run(argv);
    assert.equal(result.code, 0);
    assert.equal(result.stdout, `${version}\n`);
    assert.equal(result.stderr, "");
  }
});

test("the bin entrypoint runs as an executable", () => {
  const result = spawnSync(process.execPath, [join(root, "bin", "dinkus-commerce.mjs"), "--version"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${version}\n`);
});

test("catalog list reads the public route without the credential and emits one JSON document", async () => {
  const result = await run(["--url", SITE, "catalog", "list", "--json"], {
    env: { EMDASH_TOKEN: TOKEN },
    routes: { "catalog/public": ok({ products: [product("item_a")], cursor: "c1" }) },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  const document = singleJson(result.stdout);
  assert.deepEqual(document, {
    schema: "dinkuskit.commerce.cli/v1",
    command: "catalog.list",
    outcome: "ok",
    context: { siteUrl: SITE, pluginId: "dinkus-commerce" },
    data: { products: [product("item_a")], cursor: "c1" },
  });
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].url.href, `${BASE}/catalog/public`);
  assert.equal(result.calls[0].init.method, "GET");
  assert.equal(result.calls[0].init.headers.authorization, undefined);
});

test("catalog list --all follows cursors and rejects a repeated cursor as a contract violation", async () => {
  const pages = {
    "catalog/public": ok({ products: [product("item_a")], cursor: "c1" }),
    "catalog/public?cursor=c1": ok({ products: [], cursor: "c2" }),
    "catalog/public?cursor=c2": ok({ products: [product("item_b")] }),
  };
  const result = await run(["--url", SITE, "catalog", "list", "--all", "--json"], { routes: pages });
  assert.equal(result.code, 0, result.stderr);
  const { data } = singleJson(result.stdout);
  assert.deepEqual(data.products.map((p) => p.id), ["item_a", "item_b"]);
  assert.equal(data.pages, 3);
  assert.equal(data.cursor, undefined);
  assert.deepEqual(result.calls.map((call) => call.url.search), ["", "?cursor=c1", "?cursor=c2"]);

  const looping = await run(["--url", SITE, "catalog", "list", "--all"], {
    routes: { "catalog/public": ok({ products: [], cursor: "c1" }), "catalog/public?cursor=c1": ok({ products: [], cursor: "c1" }) },
  });
  assert.equal(looping.code, 5);
  assert.match(looping.stderr, /repeated a page cursor/);
});

test("human output goes to stdout with the next-page hint on stderr", async () => {
  const result = await run(["--url", SITE, "catalog", "list"], {
    routes: { "catalog/public": ok({ products: [product("item_a", { name: "Mug\u001b[31m" })], cursor: "c1\u001b[0m" }) },
  });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^ID\s+SKU\s+PRICE\s+STATUS\s+NAME$/m);
  assert.match(result.stdout, /item_a\s+ITEM_A\s+19\.99 USD\s+in-stock\s+Mug\\u001b\[31m/);
  assert.doesNotMatch(result.stdout + result.stderr, /\u001b/);
  assert.equal(result.stderr, "More products: dinkus-commerce catalog list --cursor c1\\u001b[0m (or --all).\n");
});

test("plain output is one escaped key=value record per product plus the cursor", async () => {
  const result = await run(["--url", SITE, "catalog", "list", "--plain"], {
    routes: { "catalog/public": ok({ products: [product("item_a", { name: "Tab\there\nnew\\line" })], cursor: "c1" }) },
  });
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  const lines = result.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(
    lines[0],
    [
      "schema=dinkuskit.commerce.cli/v1",
      "command=catalog.list",
      "outcome=ok",
      "record=product",
      "id=item_a",
      "sku=ITEM_A",
      "name=Tab\\there\\nnew\\\\line",
      "price.minor=1999",
      "price.currency=USD",
      "availability.status=in-stock",
      "availability.sellable=true",
      "variants=0",
    ].join("\t"),
  );
  assert.equal(lines[1], "schema=dinkuskit.commerce.cli/v1\tcommand=catalog.list\toutcome=ok\trecord=cursor\tcursor=c1");
});

test("catalog show passes the item id as a query and exits 1 when nothing is listable", async () => {
  const found = await run(["--url", SITE, "catalog", "show", "item a&b", "--json"], {
    routes: { "catalog/public/item": ok(product("item a&b")) },
  });
  assert.equal(found.code, 0, found.stderr);
  assert.equal(found.calls[0].url.searchParams.get("itemId"), "item a&b");
  assert.equal(singleJson(found.stdout).data.id, "item a&b");

  const missing = await run(["--url", SITE, "catalog", "show", "item_gone", "--json"], {
    routes: { "catalog/public/item": ok(null) },
  });
  assert.equal(missing.code, 1);
  const document = singleJson(missing.stdout);
  assert.equal(document.outcome, "error");
  assert.equal(document.error.code, "not_found");
  assert.deepEqual(document.context, { siteUrl: SITE, pluginId: "dinkus-commerce" });
  assert.match(missing.stderr, /^dinkus-commerce: No listable public product has item id item_gone\./);
});

test("products list sends the bearer token on GET and passes the native payload through", async () => {
  const payload = {
    products: [{ catalogItemId: "item_a", name: "Demo", sku: "A-1", regular: "19.99", sale: null, manageStock: false, stockStatus: "in_stock" }],
    manageStockControl: { state: "coming-soon" },
  };
  const result = await run(["--url", SITE, "--plugin-id", "shop-commerce", "products", "list", "--json"], {
    env: { EMDASH_TOKEN: TOKEN },
    fetchImpl: async (url, init) => {
      assert.equal(new URL(url).href, `${SITE}/_emdash/api/plugins/shop-commerce/catalog-items/list`);
      assert.equal(init.method, "GET");
      assert.equal(init.headers.authorization, `Bearer ${TOKEN}`);
      return new Response(JSON.stringify({ success: true, data: payload }), { status: 200 });
    },
  });
  assert.equal(result.code, 0, result.stderr);
  const document = singleJson(result.stdout);
  assert.deepEqual(document.data, payload);
  assert.deepEqual(document.context, { siteUrl: SITE, pluginId: "shop-commerce" });
});

test("products list explains a Registry install and a missing credential", async () => {
  const registry = await run(["--url", SITE, "products", "list"], { env: { EMDASH_TOKEN: TOKEN } });
  assert.equal(registry.code, 1);
  assert.match(registry.stderr, /does not expose catalog-items\/list\. .*Registry build only has the Block Kit admin/);

  const anonymous = await run(["--url", SITE, "products", "list", "--json"]);
  assert.equal(anonymous.code, 4);
  assert.equal(anonymous.calls.length, 0);
  assert.equal(singleJson(anonymous.stdout).error.code, "credential_required");
  assert.match(anonymous.stderr, /EMDASH_TOKEN/);
});

test("exit codes follow the shared 0-5 contract", async () => {
  const cases = [
    [0, ["catalog", "list"], { "catalog/public": ok({ products: [] }) }],
    [1, ["catalog", "show", "item_gone"], { "catalog/public/item": ok(null) }],
    [1, ["orders", "list"], {}],
    [2, ["catalog", "list", "--json", "--plain"], {}],
    [2, ["catalog", "list", "--bogus"], {}],
    [2, ["catalog", "show"], {}],
    [2, ["catalog", "list", "--cursor", ""], {}],
    [2, ["--plugin-id", "../admin", "catalog", "list"], {}],
    [2, ["--timeout", "forever", "catalog", "list"], {}],
    [3, ["catalog", "list"], { "catalog/public": fail(500, "INTERNAL_ERROR", "Plugin route error") }],
    [3, ["catalog", "list"], { "catalog/public": new TypeError("fetch failed") }],
    [4, ["products", "list"], { "catalog-items/list": fail(401, "INVALID_TOKEN", "Invalid or expired token") }],
    [4, ["products", "list"], { "catalog-items/list": fail(403, "INSUFFICIENT_SCOPE", "Token lacks required scope: admin") }],
    [5, ["catalog", "list"], { "catalog/public": { status: 200, body: { products: [] } } }],
    [5, ["catalog", "list"], { "catalog/public": { status: 200, body: { success: false, data: { products: [] } } } }],
    [5, ["catalog", "list"], { "catalog/public": { status: 200, body: "<html>not emdash</html>" } }],
    [5, ["catalog", "list"], { "catalog/public": ok({ products: [{ id: 7 }] }) }],
  ];
  for (const [expected, argv, routes] of cases) {
    const result = await run(["--url", SITE, ...argv], { routes, env: { EMDASH_TOKEN: TOKEN } });
    assert.equal(result.code, expected, `${argv.join(" ")}: ${result.stderr}`);
    if (expected !== 0) assert.match(result.stderr, /^dinkus-commerce: /);
  }
});

test("a site URL is required, validated, and resolved flag > env > project config", async () => {
  const missing = await run(["catalog", "list"]);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /--url <site-url> or EMDASH_URL/);

  const credentialedSite = new URL("https://shop.example");
  credentialedSite.username = "user";
  credentialedSite.password = "pass";
  for (const url of ["http://shop.example", credentialedSite.href, "https://shop.example/?a=1", "not a url"]) {
    const invalid = await run(["--url", url, "catalog", "list"]);
    assert.equal(invalid.code, 2, url);
    assert.equal(invalid.calls.length, 0);
  }

  const cwd = await mkdtemp(join(tmpdir(), "dinkus-commerce-cli-"));
  try {
    await mkdir(join(cwd, ".dinkuskit"));
    await writeFile(
      join(cwd, ".dinkuskit", "commerce.json"),
      JSON.stringify({ url: "https://project.example", profiles: { staging: { url: "https://staging.example", "plugin-id": "commerce-staging" } } }),
    );
    const routes = { "catalog/public": ok({ products: [] }) };
    const fromProject = await run(["catalog", "list", "--json"], { cwd, routes });
    assert.equal(singleJson(fromProject.stdout).context.siteUrl, "https://project.example");
    const fromEnv = await run(["catalog", "list", "--json"], { cwd, routes, env: { EMDASH_URL: "https://env.example" } });
    assert.equal(singleJson(fromEnv.stdout).context.siteUrl, "https://env.example");
    const fromFlag = await run(["--url", "http://localhost:4321", "catalog", "list", "--json"], { cwd, routes, env: { EMDASH_URL: "https://env.example" } });
    assert.equal(singleJson(fromFlag.stdout).context.siteUrl, "http://localhost:4321");
    const fromProfile = await run(["--profile", "staging", "catalog", "list", "--json"], { cwd, routes: {}, fetchImpl: async (url) => {
      assert.equal(new URL(url).pathname, "/_emdash/api/plugins/commerce-staging/catalog/public");
      return new Response(JSON.stringify({ success: true, data: { products: [] } }));
    } });
    assert.deepEqual(singleJson(fromProfile.stdout).context, { siteUrl: "https://staging.example", pluginId: "commerce-staging" });

    await writeFile(join(cwd, ".dinkuskit", "commerce.json"), JSON.stringify({ url: SITE, token: "nope" }));
    const secret = await run(["catalog", "list"], { cwd });
    assert.equal(secret.code, 2);
    assert.match(secret.stderr, /non-secret metadata only/);
    assert.doesNotMatch(secret.stderr, /nope/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("admin commands never send the token to a site URL from project config", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dinkus-commerce-cli-"));
  const configHome = await mkdtemp(join(tmpdir(), "dinkus-commerce-home-"));
  try {
    await mkdir(join(cwd, ".dinkuskit"));
    await writeFile(join(cwd, ".dinkuskit", "commerce.json"), JSON.stringify({ url: "https://project.example" }));
    const routes = { "catalog-items/list": ok({ products: [] }), "catalog/public": ok({ products: [] }) };

    const refused = await run(["products", "list", "--json"], { cwd, routes, env: { EMDASH_TOKEN: TOKEN } });
    assert.equal(refused.code, 4);
    assert.equal(refused.calls.length, 0, "nothing is sent to the project-config host");
    assert.equal(singleJson(refused.stdout).error.code, "untrusted_site_url");

    const publicRead = await run(["catalog", "list", "--json"], { cwd, routes, env: { EMDASH_TOKEN: TOKEN } });
    assert.equal(publicRead.code, 0, "public reads may still use the project URL");
    assert.equal(publicRead.calls[0].init.headers?.authorization, undefined);

    for (const [argv, env] of [
      [["--url", SITE], { EMDASH_TOKEN: TOKEN }],
      [[], { EMDASH_TOKEN: TOKEN, EMDASH_URL: SITE }],
      [[], { EMDASH_TOKEN: TOKEN, XDG_CONFIG_HOME: configHome }],
    ]) {
      if (env.XDG_CONFIG_HOME) {
        await mkdir(join(configHome, "dinkuskit", "commerce"), { recursive: true });
        await writeFile(join(configHome, "dinkuskit", "commerce", "config.json"), JSON.stringify({ url: SITE }));
        await rm(join(cwd, ".dinkuskit", "commerce.json"));
      }
      const allowed = await run([...argv, "products", "list", "--json"], { cwd, routes, env });
      assert.equal(allowed.code, 0, allowed.stderr);
      assert.equal(allowed.calls[0].url.origin, SITE);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(configHome, { recursive: true, force: true });
  }
});

test("the credential never appears in stdout or stderr", async () => {
  const scenarios = [
    [["products", "list"], { "catalog-items/list": ok({ products: [] }) }],
    [["products", "list", "--json"], { "catalog-items/list": fail(401, "INVALID_TOKEN", "Invalid or expired token") }],
    [["products", "list", "--plain"], { "catalog-items/list": fail(500, "INTERNAL_ERROR") }],
    [["products", "list"], { "catalog-items/list": { status: 200, body: "garbage" } }],
    [["catalog", "list", "--json"], { "catalog/public": ok({ products: [product("item_a")] }) }],
    [["products", "set-price", "item_a", "--amount", "1.00", "--json"], {}],
    [["--help"], {}],
  ];
  for (const [argv, routes] of scenarios) {
    const result = await run(["--url", SITE, ...argv], { routes, env: { EMDASH_TOKEN: TOKEN } });
    assert.ok(!result.stdout.includes(TOKEN) && !result.stderr.includes(TOKEN), argv.join(" "));
    assert.ok(!result.stdout.includes("fixture_never") && !result.stderr.includes("fixture_never"));
  }
});

test("planned commands stay in help and fail closed without contacting the site", async () => {
  const plannedCommands = [
    ["orders", "list"],
    ["orders", "show", "order_demo"],
    ["settings", "show"],
    ["products", "set-price", "item_demo", "--amount", "19.99"],
    ["products", "set-sale-price", "item_demo", "--amount", "9.99"],
    ["products", "set-sku", "item_demo", "--sku", "DEMO-2"],
  ];
  for (const argv of plannedCommands) {
    const result = await run(["--url", SITE, ...argv, "--json"], { env: { EMDASH_TOKEN: TOKEN } });
    assert.equal(result.code, 1, argv.join(" "));
    assert.equal(result.calls.length, 0);
    const document = singleJson(result.stdout);
    assert.equal(document.error.code, "not_implemented");
    assert.match(document.error.message, /^Not implemented yet: /);
    const node = argv.slice(0, 2).reduce((tree, name) => tree.commands[name], spec.tree);
    assert.match(node.summary, /\(planned\)$/);
  }
});

test("--no-input mutations fail closed: nothing is sent with or without --confirm", async () => {
  for (const extra of [["--no-input"], ["--no-input", "--confirm", "confirm_demo"], ["--dry-run"]]) {
    const result = await run(["--url", SITE, "products", "set-price", "item_demo", "--amount", "19.99", ...extra], { env: { EMDASH_TOKEN: TOKEN } });
    assert.equal(result.code, 1);
    assert.equal(result.calls.length, 0);
    assert.equal(result.stdout, "");
  }
  const missingAmount = await run(["--url", SITE, "products", "set-price", "item_demo", "--no-input"]);
  assert.equal(missingAmount.code, 2);
  assert.match(missingAmount.stderr, /requires --amount/);
});

test("a real HTTP round trip uses the EmDash plugin path and envelope", async () => {
  const seen = [];
  const server = createServer((request, response) => {
    seen.push({ url: request.url, authorization: request.headers.authorization });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ success: true, data: { products: [product("item_a")] } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const result = await run(["--url", `http://127.0.0.1:${port}`, "catalog", "list", "--plain"], {
      env: { EMDASH_TOKEN: TOKEN },
      fetchImpl: globalThis.fetch,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /\trecord=product\tid=item_a\t/);
    assert.deepEqual(seen, [{ url: "/_emdash/api/plugins/dinkus-commerce/catalog/public", authorization: undefined }]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("CLI route ids and named routes match the built Commerce package", async () => {
  assert.equal(DEFAULT_PLUGIN_ID, COMMERCE_PLUGIN_ID);
  assert.deepEqual(ROUTES, {
    publicCatalog: PUBLIC_CATALOG_ROUTE,
    publicCatalogItem: PUBLIC_CATALOG_ITEM_ROUTE,
    listProducts: LIST_CATALOG_PRODUCTS_ROUTE,
  });
  // Planned mutations name the native routes they would wrap.
  const specSource = await readFile(join(root, "cli", "spec.mjs"), "utf8");
  for (const route of [SET_CATALOG_ITEM_REGULAR_PRICE_ROUTE, SET_CATALOG_ITEM_SALE_PRICE_ROUTE, SET_CATALOG_ITEM_SKU_ROUTE]) {
    assert.ok(specSource.includes(`"${route}"`), route);
  }
});

test("the CLI stays outside the Registry bundle and the package source", async () => {
  for (const file of ["kernel.mjs", "client.mjs", "spec.mjs"]) {
    const source = await readFile(join(root, "cli", file), "utf8");
    for (const [, specifier] of source.matchAll(/^import\s[^"']*["']([^"']+)["']/gm)) {
      assert.ok(specifier.startsWith("node:") || /^\.\/[a-z-]+\.mjs$/.test(specifier), `${file} imports ${specifier}`);
    }
  }
  const bin = await readFile(join(root, "bin", "dinkus-commerce.mjs"), "utf8");
  assert.deepEqual([...bin.matchAll(/from "([^"]+)"/g)].map((match) => match[1]), ["../cli/kernel.mjs", "../cli/spec.mjs"]);

  async function sources(directory) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) files.push(...(await sources(path)));
      else files.push(path);
    }
    return files;
  }
  for (const file of await sources(join(root, "src"))) {
    assert.doesNotMatch(await readFile(file, "utf8"), /["'][./]*cli\/(?:kernel|client|spec)\.mjs["']/, file);
  }
  const bundle = await readFile(join(root, "dist", "sandbox", "plugin.mjs"), "utf8");
  assert.ok(!bundle.includes("dinkuskit.commerce.cli/v1"));
  assert.ok(!bundle.includes("EMDASH_TOKEN"));
});
