import assert from "node:assert/strict";
import test from "node:test";
import { handleMaintenanceProof } from "../sandbox-site/src/maintenance-proof.mjs";

function context(path = "/__proof/maintenance", { host = "127.0.0.1", method = "POST", locals = { emdash: { db: {} } } } = {}) {
  const url = new URL(`http://${host}${path}`);
  return { url, request: new Request(url, { method }), locals };
}

test("fixture maintenance leaves unrelated routes untouched", async () => {
  const expected = new Response("next"); let next = 0; let run = 0;
  const result = await handleMaintenanceProof(context("/"), () => { next++; return expected; }, {
    development: true, runMaintenance: async () => { run++; return { published: [] }; },
  });
  assert.equal(result, expected); assert.equal(next, 1); assert.equal(run, 0);
});

test("fixture maintenance requires local development, POST and initialized host", async () => {
  for (const [ctx, development, status] of [
    [context(), false, 403], [context(undefined, { host: "example.test" }), true, 403],
    [context(undefined, { method: "GET" }), true, 405],
    [context(undefined, { locals: {} }), true, 503], [context(undefined, { locals: { emdash: {} } }), true, 503],
  ]) {
    let run = 0;
    const response = await handleMaintenanceProof(ctx, () => assert.fail("guard must not fall through"), {
      development, runMaintenance: async () => { run++; return { published: [] }; },
    });
    assert.equal(response.status, status); assert.equal(run, 0);
    if (status === 405) assert.equal(response.headers.get("allow"), "POST");
  }
  const missingLocals = context(); delete missingLocals.locals;
  assert.equal((await handleMaintenanceProof(missingLocals, () => assert.fail(), { development: true, runMaintenance: () => assert.fail() })).status, 503);
});

test("fixture maintenance calls the supplied maintenance operation and returns only an empty publishing result", async () => {
  for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
    let run = 0;
    const response = await handleMaintenanceProof(context(undefined, { host }), () => assert.fail(), {
      development: true, runMaintenance: async () => { run++; return { published: [], ignored: "not returned" }; },
    });
    assert.equal(response.status, 200); assert.equal(run, 1);
    assert.deepEqual(await response.json(), { published: [] });
  }
});

test("fixture maintenance fails visibly for operation errors or unexpected publishing", async () => {
  for (const operation of [async () => { throw new Error("synthetic internal failure"); }, async () => undefined,
    async () => ({}), async () => ({ published: [{}] })]) {
    const response = await handleMaintenanceProof(context(), () => assert.fail(), { development: true, runMaintenance: operation });
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /synthetic internal failure/);
  }
});
