import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import shell from "shell-quote";
import { runCli } from "../cli/kernel.mjs";
import { spec } from "../cli/spec.mjs";

function* manifestExamples(node, path = []) {
  if (node.read_only) {
    assert.ok(node.examples?.length, `${path.join(" ")} needs a read-only example`);
    assert.ok(!node.flags?.confirm && !node.flags?.["dry-run"], `${path.join(" ")} advertises writes`);
  }
  for (const line of node.examples ?? []) yield { line, owner: path.join(".") };
  for (const [name, child] of Object.entries(node.commands ?? {})) {
    yield* manifestExamples(child, [...path, name]);
  }
}

function* cliInvocations(line) {
  const words = shell.parse(line);
  for (let start = 0; start < words.length; start++) {
    if (![spec.name, `bin/${spec.name}.mjs`, `./bin/${spec.name}.mjs`].includes(words[start])) continue;
    const argv = [];
    while (typeof words[start + 1] === "string") argv.push(words[++start]);
    yield argv;
  }
}

function* readmeExamples(markdown) {
  for (const fence of markdown.matchAll(/^ {0,3}(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^ {0,3}\1[ \t]*$/gm)) {
    for (const line of fence[2].replaceAll(/\\\r?\n/g, "").split("\n")) {
      for (const argv of cliInvocations(line)) yield { line, argv };
    }
  }
}

function readTransport(attempts) {
  const product = { id: "item_demo", catalogItemId: "item_demo", name: "Demo", sku: "DEMO" };
  const order = { orderId: "order:demo", version: 1, status: "processing", test: true, lines: [] };
  const routes = new Map([
    ["GET catalog/public", { products: [product] }],
    ["GET catalog/public/item", product],
    ["POST catalog list", { products: [product] }],
    ["POST catalog get", { product, media: {} }],
    ["POST orders list", { orders: [order], total: 1 }],
    ["POST orders show", { order }],
  ]);
  return async (url, { method, body }) => {
    const route = new URL(url).pathname.replace(/^\/_emdash\/api\/plugins\/dinkus-commerce\//, "");
    const payload = body && JSON.parse(body);
    const action = route === "catalog" ? payload?.op : route === "orders" ? payload?.action : undefined;
    const key = [method, route, action].filter(Boolean).join(" ");
    if (!routes.has(key)) {
      attempts.push(key);
      throw new Error(`Unexpected request: ${key}`);
    }
    return Response.json({ success: true, data: routes.get(key) });
  };
}

test("test_command_manifest_examples_parse", async () => {
  assert.equal(process.permission?.has("fs.write"), false, "run with npm run audit:commands");
  const examples = [];
  for (const { line, owner } of [...manifestExamples(spec), ...manifestExamples(spec.tree)]) {
    const commands = [...cliInvocations(line)];
    assert.ok(commands.length, `No Commerce CLI invocation in: ${line}`);
    for (const argv of commands) examples.push({ line, owner, argv });
  }
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const documented = [...readmeExamples(readme)];
  assert.ok(documented.length, "README must document at least one Commerce CLI invocation");
  for (const { line, owner, argv } of [...examples, ...documented]) {
    let output = "";
    const sink = { write: (chunk) => { output += chunk; } };
    const options = { argv, stdout: sink, stderr: sink };
    let parsed;
    const code = await runCli(spec, {
      ...options,
      parseOnly: (node, name) => { parsed = { node, name }; },
      fetchImpl: assert.fail,
    });
    assert.equal(code, 0, `${line}\n${output}`);
    if (owner) assert.ok(parsed?.name === owner || parsed?.name.startsWith(`${owner}.`), `${owner}: ${line}`);
    if (!parsed?.node.read_only) continue;

    const attempts = [];
    const lifecycle = {};
    const result = await runCli(spec, {
      ...options, cwd: "tests/fixtures/cli-examples", lifecycle, fetchImpl: readTransport(attempts),
      env: { HOME: "tests/fixtures/cli-examples", EMDASH_URL: "https://shop.example", EMDASH_TOKEN: "fixture" },
    });
    assert.deepEqual(attempts, [], `${line}: ${attempts.join(", ")}`);
    assert.ok(!lifecycle.sending, `${line}: dispatched a mutation`);
    assert.equal(result, 0, `${line}\n${output}`);
  }
});
