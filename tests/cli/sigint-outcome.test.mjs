import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createCommerceClient } from "../../cli/client.mjs";

const BIN = fileURLToPath(new URL("../../bin/dinkus-commerce.mjs", import.meta.url));
const TOKEN = "synthetic-sigint-fixture";
const PROCESS_OPTIONS = { timeout: 15_000, skip: process.platform === "win32" && "Windows does not deliver SIGINT to child handlers" };
const PRODUCT = {
  product: { catalogItemId: "item_fixture", name: "Fixture", sku: "FIXTURE", regular: "12.00", sale: null, manageStock: false, stockStatus: "in_stock" },
  media: { image: null, gallery: [] },
  feeds: { channels: [] },
};
const CONFIRM = createHash("sha256").update(JSON.stringify(PRODUCT)).digest("hex").slice(0, 12);
const MUTATIONS = [
  { name: "create product", argv: ["products", "create", "--name", "Fixture", "--sku", "FIXTURE", "--command-id", "fixture-create", "--page", "page-fixture"], op: "create" },
  { name: "change product", argv: ["products", "set-price", "item_fixture", "--amount", "14.00", "--confirm", CONFIRM], op: "prices" },
  { name: "complete order", argv: ["orders", "complete", "order:fixture", "--confirm", "1"], op: "complete" },
  { name: "reopen order", argv: ["orders", "reopen", "order:fixture", "--confirm", "2"], op: "reopen" },
];

// Exercise the executable's actual main() SIGINT handler, not just runCli's
// AbortSignal path. All requests and credentials stay on this loopback server.
async function interrupt(argv, { partialResponse = false, stopAt = "mutation" } = {}) {
  let child;
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      const input = JSON.parse(body);
      requests.push(input);
      if (input.op === "get" && stopAt === "mutation") {
        response.end(JSON.stringify({ success: true, data: PRODUCT }));
        return;
      }
      // The change has reached the server. An actual store could already have
      // committed it; neither a missing response nor SIGINT can undo that.
      if (partialResponse) {
        response.writeHead(200, { "content-type": "application/json" });
        response.write('{"success":true,"data":', () => child.kill("SIGINT"));
      } else {
        child.kill("SIGINT");
      }
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let stdout = "", stderr = "";
  let closed;
  let watchdog;
  try {
    child = spawn(process.execPath, [BIN, "--url", `http://127.0.0.1:${server.address().port}`, "--timeout", "5s", ...argv, "--json"], {
      env: { HOME: "/nonexistent-home", XDG_CONFIG_HOME: "/nonexistent-home", EMDASH_TOKEN: TOKEN },
      cwd: "/",
      stdio: ["ignore", "pipe", "pipe"],
    });
    closed = once(child, "close");
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    watchdog = setTimeout(() => child.kill("SIGKILL"), 8000);
    const [code, signal] = await closed;
    assert.equal(signal, null, `child did not exit normally: ${stderr}`);
    assert.equal(stdout.trim().split("\n").length, 1, "one JSON error document");
    assert.equal(JSON.parse(stdout).error.code, "interrupted", stderr);
    assert.ok(!(stdout + stderr).includes(TOKEN));
    return { code, stderr, requests };
  } finally {
    clearTimeout(watchdog);
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (closed) await closed;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

for (const partialResponse of [false, true]) {
  for (const mutation of MUTATIONS) {
    test(`SIGINT after ${mutation.name}, ${partialResponse ? "partial response" : "no response headers"}: outcome unknown`, PROCESS_OPTIONS, async () => {
      const result = await interrupt(mutation.argv, { partialResponse });
      assert.equal(result.code, 3, result.stderr);
      assert.match(result.stderr, /interrupted after the request was sent; the outcome is unknown/);
      assert.doesNotMatch(result.stderr, /nothing was sent/);
      assert.equal(result.requests.filter(body => (body.op ?? body.action) === mutation.op).length, 1, "exactly one change request reached the server");
    });
  }
}

for (const argv of [
  ["products", "set-price", "item_fixture", "--amount", "14.00", "--confirm", CONFIRM],
  ["orders", "complete", "order:fixture", "--dry-run"],
]) {
  test(`SIGINT during ${argv[0]} preflight: no change was sent`, PROCESS_OPTIONS, async () => {
    const result = await interrupt(argv, { stopAt: "read" });
    assert.equal(result.code, 4, result.stderr);
    assert.match(result.stderr, /interrupted; nothing was sent/);
    assert.doesNotMatch(result.stderr, /outcome is unknown/);
    assert.equal(result.requests.length, 1);
    assert.ok(["get", "show"].includes(result.requests[0].op ?? result.requests[0].action));
  });
}

function client({ lifecycle = { sending: false }, fetchImpl, ...options } = {}) {
  return createCommerceClient({ siteUrl: "https://shop.example", pluginId: "dinkus-commerce", token: TOKEN, timeoutMs: 1000, lifecycle, fetchImpl, ...options });
}

// POST is not a sufficient mutation classifier: both APIs also read with POST.
for (const [route, inputs] of [
  ["catalog", ["get", "list", "create", "prices", "choice", "labels", "sku", "weight", "identifiers", "archive", "media", "feeds"]],
  ["orders", ["show", "list", "complete", "reopen"]],
]) {
  test(`${route}: only a dispatched mutation marks the shared lifecycle`, async () => {
    for (const op of inputs) {
      const lifecycle = { sending: false };
      const read = ["get", "list", "show"].includes(op);
      const api = client({ lifecycle, fetchImpl: async () => {
        assert.equal(lifecycle.sending, !read, op);
        const data = route === "catalog" ? {} : op === "list" ? { orders: [], total: 0 } : op === "show" ? { order: null } : { result: "saved" };
        return new Response(JSON.stringify({ success: true, data }));
      } });
      if (route === "catalog") await api.catalog({ op }, "Fixture");
      else if (op === "list") await api.listOrders({});
      else if (op === "show") await api.showOrder("order:fixture");
      else await api.changeOrder({ action: op });
      assert.equal(lifecycle.sending, !read, op);
    }
  });
}

test("public and native GET reads never mark a mutation", async () => {
  const lifecycle = { sending: false };
  let calls = 0;
  const api = client({ lifecycle, fetchImpl: async (_url, init) => {
    calls += 1;
    assert.equal(init.method, "GET");
    assert.equal(lifecycle.sending, false);
    return new Response(JSON.stringify({ success: true, data: { products: [] } }));
  } });
  await api.publicCatalogPage();
  await api.listProducts();
  assert.equal(calls, 2);
  assert.equal(lifecycle.sending, false);
});

test("blocked and pre-cancelled mutations never mark a send or invoke fetch", async () => {
  const controller = new AbortController();
  controller.abort();
  for (const options of [{ token: undefined }, { siteUrlSource: "project" }, { pluginIdSource: "project" }, { signal: controller.signal }]) {
    for (const route of ["catalog", "orders"]) {
      const lifecycle = { sending: false };
      let calls = 0;
      const api = client({ ...options, lifecycle, fetchImpl: async () => { calls += 1; throw new Error("Unexpected dispatch"); } });
      await assert.rejects(route === "catalog" ? api.catalog({ op: "create" }, "Fixture") : api.changeOrder({ action: "complete" }));
      assert.equal(calls, 0);
      assert.equal(lifecycle.sending, false);
    }
  }
});
