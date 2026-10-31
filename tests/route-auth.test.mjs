import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { describeRoutes, loadRouteManifest, ROUTE_PREFIX } from "../scripts/route-manifest.mjs";

// Issue #79: every route says public or admin, and the published manifest
// lists only the exact public shopper paths.
const root = resolve(import.meta.dirname, "..");
const sandbox = (await import("../dist/sandbox/plugin.mjs")).default;
const { createPlugin } = await import("../dist/index.js");

const SANDBOX_PUBLIC = [
  "catalog/public GET",
  "catalog/public/item GET",
  "store-proof GET",
  "checkout/guest/prepare POST",
  "checkout/guest/start POST",
  "checkout/guest/status POST",
  "checkout/guest/readiness GET",
  "account/sign-in/start POST",
  "account/sign-in/verify POST",
  "account/sign-out POST",
  "account/orders GET",
  "account/profile GET,POST",
];
// Connect is a Registry install's only: the native entry has no store-proof route.
const NATIVE_PUBLIC = SANDBOX_PUBLIC.filter((route) => !route.includes("/readiness") && !route.startsWith("store-proof"));

function publicSet(routes) {
  return Object.entries(routes)
    .filter(([, route]) => route.public === true)
    .map(([name, route]) => `${name} ${route.methods.join(",")}`)
    .sort();
}

for (const [label, routes, expected] of [
  ["sandbox", sandbox.routes, SANDBOX_PUBLIC],
  ["native", createPlugin().routes, NATIVE_PUBLIC],
]) {
  test(`${label}: every route declares public or admin`, () => {
    const undeclared = Object.entries(routes).filter(([, route]) => typeof route.public !== "boolean").map(([name]) => name);
    assert.deepEqual(undeclared, []);
    for (const [name, route] of Object.entries(routes)) {
      if (route.public) assert.equal(route.permission, undefined, `${name} is public but names a permission`);
      else assert.equal(typeof route.permission, "string", `${name} is admin but names no EmDash permission`);
    }
  });
  test(`${label}: public routes are exactly the shopper routes`, () => {
    assert.deepEqual(publicSet(routes), [...expected].sort());
  });
}

test("describeRoutes refuses a route without a declaration", () => {
  assert.throws(() => describeRoutes({ x: { permission: "content:edit_any" } }, "fixture"), /lacks an explicit public\/admin/);
  assert.throws(() => describeRoutes({ x: { public: false } }, "fixture"), /must name an EmDash permission/);
  assert.throws(() => describeRoutes({ x: { public: true } }, "fixture"), /explicit methods/);
});

test("published route manifest matches the built sandbox plugin", async () => {
  const published = JSON.parse(await readFile(resolve(root, "dist/sandbox/route-manifest.json"), "utf8"));
  const fresh = await loadRouteManifest(root, published.artifact);
  assert.deepEqual(published, fresh);
  assert.equal(published.artifact.bytes > 0 && /^[0-9a-f]{64}$/.test(published.artifact.sha256), true);
  for (const path of published.publicRoutes) {
    assert.match(path, /^\/_emdash\/api\/plugins\/dinkus-commerce\/[A-Za-z0-9._~/-]+$/);
    assert.ok(path.startsWith(ROUTE_PREFIX) && !path.endsWith("/") && !path.includes("*"));
  }
  assert.deepEqual(published.publicRoutes, published.routes.filter((r) => r.public).map((r) => r.path));
});
