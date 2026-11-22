import assert from "node:assert/strict";
import test from "node:test";
import { handleCourierProof } from "../sandbox-site/src/courier-proof.mjs";

function context(path = "/__proof/courier-outbox", { host = "127.0.0.1", method = "POST", body } = {}) {
  const url = new URL(`http://${host}${path}`);
  return { url, request: new Request(url, { method, ...(body && { body: JSON.stringify(body) }) }) };
}

test("the courier proof leaves unrelated routes untouched", async () => {
  const expected = new Response("next"); let run = 0;
  const result = await handleCourierProof(context("/"), () => expected, { development: true, withRuntime: async () => { run++; } });
  assert.equal(result, expected); assert.equal(run, 0);
});

test("the courier proof answers only local development POSTs", async () => {
  for (const [ctx, development, status] of [[context(), false, 403], [context(undefined, { host: "example.test" }), true, 403], [context(undefined, { method: "GET" }), true, 405]]) {
    const response = await handleCourierProof(ctx, () => assert.fail("guard must not fall through"), { development, withRuntime: () => assert.fail("must not run") });
    assert.equal(response.status, status);
  }
});

test("the courier proof makes the courier's call: Commerce's outbox, POST, nobody signed in", async () => {
  const calls = [];
  const runtime = { async handlePluginApiRoute(...args) { calls.push(args); return { success: true, data: { courier: 1, items: [] } }; } };
  const response = await handleCourierProof(context(undefined, { body: { after: "k", limit: 2 } }), () => assert.fail("must not fall through"), {
    development: true, withRuntime: (run) => run(runtime) });
  assert.deepEqual(await response.json(), { success: true, data: { courier: 1, items: [] } });
  const [[plugin, method, route, request, user]] = calls;
  assert.deepEqual([plugin, method, route, user, calls[0].length], ["dinkus-commerce", "POST", "courier/outbox", undefined, 4]);
  assert.deepEqual(await request.json(), { courier: 1, op: "since", topic: "order.shipped", after: "k", limit: 2 });
});
