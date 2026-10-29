import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { CliError, createHttp, EXIT, runCli } from "../../cli/kernel.mjs";
import { spec } from "../../cli/spec.mjs";

const PRIVATE_DETAIL = "synthetic-private-transport-detail";

// A failure can happen while fetching headers OR while consuming the body.
// Neither phase may escape as an internal error or expose the raw exception.
for (const phase of ["headers", "body"]) {
  for (const [name, code] of [["TimeoutError", "timeout"], ["AbortError", "interrupted"], ["TypeError", "service_unreachable"]]) {
    test(`${phase}: ${name} uses the transport error contract`, async () => {
      let calls = 0;
      const error = new Error(PRIVATE_DETAIL);
      error.name = name;
      const http = createHttp({
        baseUrl: "https://shop.example",
        timeoutMs: 1000,
        fetchImpl: async () => {
          calls += 1;
          if (phase === "headers") throw error;
          return { text: async () => { throw error; } };
        },
      });
      await assert.rejects(http("POST", "/orders", { body: { action: "complete" } }), (error) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.code, code);
        assert.equal(error.exit, EXIT.unavailable);
        assert.ok(!error.message.includes(PRIVATE_DETAIL));
        return true;
      });
      assert.equal(calls, 1, "a transport failure must not retry a possibly applied write");
    });
  }
}

for (const phase of ["headers", "body"]) {
  test(`${phase}: cancellation with a custom reason is still an interruption`, async () => {
    const controller = new AbortController();
    const http = createHttp({
      baseUrl: "https://shop.example",
      timeoutMs: 1000,
      signal: controller.signal,
      fetchImpl: async (_url, init) => {
        const abort = () => {
          controller.abort(new Error(PRIVATE_DETAIL));
          throw init.signal.reason;
        };
        if (phase === "headers") abort();
        return { text: async () => abort() };
      },
    });
    await assert.rejects(http("GET", "/catalog"), (error) => {
      assert.equal(error.code, "interrupted");
      assert.equal(error.exit, EXIT.unavailable);
      assert.ok(!error.message.includes(PRIVATE_DETAIL));
      return true;
    });
  });
}

test("the signal's timeout reason takes precedence over a body AbortError", async () => {
  const controller = new AbortController();
  const http = createHttp({
    baseUrl: "https://shop.example",
    timeoutMs: 1000,
    signal: controller.signal,
    fetchImpl: async () => ({ text: async () => {
      controller.abort(new DOMException(PRIVATE_DETAIL, "TimeoutError"));
      throw new DOMException(PRIVATE_DETAIL, "AbortError");
    } }),
  });
  await assert.rejects(http("GET", "/catalog"), { code: "timeout", exit: EXIT.unavailable });
});

test("a fully received non-JSON response remains a response, not a transport failure", async () => {
  const http = createHttp({
    baseUrl: "https://shop.example",
    timeoutMs: 1000,
    fetchImpl: async () => new Response("not JSON", { status: 200 }),
  });
  assert.deepEqual(await http("GET", "/catalog"), { status: 200, ok: true, json: undefined, text: "not JSON" });
});

// Use Node's real fetch/ReadableStream so the tests cover failures AFTER fetch
// has resolved, rather than just a mock fetch that immediately rejects.
for (const failure of ["timeout", "interrupted", "service_unreachable"]) {
  test(`CLI maps ${failure} after HTTP headers to exit 3 and one JSON error`, { timeout: 10_000 }, async () => {
    let requests = 0;
    let pendingResponse;
    const server = createServer((_request, response) => {
      requests += 1;
      pendingResponse = response;
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"success":true,"data":'); // Intentionally incomplete.
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const controller = new AbortController();
    let receivedHeaders = false;
    let stdout = "", stderr = "";
    try {
      const exit = await runCli(spec, {
        argv: ["--url", `http://127.0.0.1:${server.address().port}`, "--timeout", "1s", "catalog", "list", "--json"],
        env: { HOME: "/nonexistent-home" },
        cwd: "/",
        stdout: { write: chunk => { stdout += chunk; } },
        stderr: { write: chunk => { stderr += chunk; } },
        signal: controller.signal,
        fetchImpl: async (...args) => {
          const response = await fetch(...args);
          receivedHeaders = true;
          if (failure === "interrupted") controller.abort(new Error(PRIVATE_DETAIL));
          if (failure === "service_unreachable") pendingResponse.destroy();
          return response;
        },
      });
      assert.equal(receivedHeaders, true, "the failure must occur after fetch resolved");
      assert.equal(exit, EXIT.unavailable, stderr);
      assert.equal(stdout.trim().split("\n").length, 1);
      const document = JSON.parse(stdout);
      assert.equal(document.command, "catalog.list");
      assert.equal(document.outcome, "error");
      assert.equal(document.error.code, failure);
      assert.match(stderr, /^dinkus-commerce: /);
      assert.ok(!(stdout + stderr).includes(PRIVATE_DETAIL));
      assert.equal(requests, 1);
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
}
