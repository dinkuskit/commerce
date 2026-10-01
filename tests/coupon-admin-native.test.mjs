import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { PluginStorageRepository } from "emdash";
import { COMMERCE_PLUGIN_ID } from "../dist/index.js";
import * as nativeAdmin from "../dist/admin/native.js";
import couponFixture from "./native-coupon-site/coupon-plugin.mjs";
import * as couponFixtureAdmin from "./native-coupon-site/coupon-admin.mjs";
import {
  createCoupon,
  createCouponAdminPorts,
  editCoupon,
} from "../dist/admin/coupons-controller.js";
import { createCouponAdminRoutes } from "../dist/admin/coupons-routes.js";

const schema = `CREATE TABLE _plugin_storage (
  plugin_id TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL,
  data TEXT NOT NULL, revision TEXT NOT NULL DEFAULT '0',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (plugin_id, collection, id)
)`;

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "coupon-admin-repair-"));
  const path = join(dir, "db.sqlite");
  const raw = new BetterSqlite3(path);
  raw.exec(schema);
  raw.exec("CREATE UNIQUE INDEX coupon_code_uq ON _plugin_storage(plugin_id, collection, json_extract(data, '$.normalizedCode')) WHERE collection = 'coupons'");
  raw.close();
  const db = new Kysely({ dialect: new SqliteDialect({ database: new BetterSqlite3(path) }) });
  const coupons = new PluginStorageRepository(db, COMMERCE_PLUGIN_ID, "coupons", ["normalizedCode"]);
  return { coupons, db, close: async () => { await db.destroy(); await rm(dir, { recursive: true, force: true }); } };
}

const form = (overrides = {}) => ({
  code: "SAVE10",
  discountKind: "percentage",
  discountValue: "12.5",
  usageLimit: "3",
  startsAt: "2026-01-01T00:00:00-04:00",
  endsAt: "2027-01-01T00:00:00-04:00",
  timeZone: "America/New_York",
  ...overrides,
});

function routeContext(coupons, input) {
  return { request: { method: "POST" }, input, storage: { coupons } };
}

test("default native pages omit unmounted coupons while the test fixture composes the named page", () => {
  assert.equal(nativeAdmin.pages["/coupons"], undefined);
  assert.equal(typeof nativeAdmin.CouponsPage, "function");
  assert.equal(couponFixtureAdmin.pages["/coupons"], nativeAdmin.CouponsPage);
  assert.match(couponFixture.adminEntry, /tests\/native-coupon-site\/coupon-admin\.mjs$/);
  assert.deepEqual(couponFixture.adminPages.at(-1), {
    path: "/coupons",
    label: "Coupons",
    icon: "tag",
  });
});

test("real SQLite controller uses merchant units and preserves rule eligibility and percentage maximum", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const ports = createCouponAdminPorts({ coupons: f.coupons });
  const created = await createCoupon(ports, form());
  assert.equal(created.rule.includeSaleItems, false);
  assert.equal(created.rule.discount.basisPoints, 1250);

  const seeded = await editCoupon(ports, {
    ...form({ discountValue: "20" }),
    couponId: created.couponId,
    expectedRevision: created.revision,
  });
  const withMaximum = await f.coupons.compareAndSet(
    created.couponId,
    (await f.coupons.getVersioned(created.couponId)).revision,
    { ...seeded, rule: { ...seeded.rule, discount: { ...seeded.rule.discount, maximum: { currency: "USD", minor: "500" } } } },
  );
  assert.equal(withMaximum.applied, true);
  const edited = await editCoupon(ports, {
    ...form({ discountValue: "12.50" }),
    couponId: created.couponId,
    expectedRevision: seeded.revision,
  });
  assert.deepEqual(edited.rule.discount, { kind: "percentage", basisPoints: 1250, maximum: { currency: "USD", minor: "500" } });
  const fixed = await editCoupon(ports, {
    ...form({ discountKind: "fixed", discountValue: "2.50" }),
    couponId: created.couponId,
    expectedRevision: edited.revision,
  });
  assert.deepEqual(fixed.rule.discount, { kind: "fixed", amount: { currency: "USD", minor: "250" } });
  assert.equal(fixed.rule.includeSaleItems, false);
});

test("route adapter rejects malformed runtime input as 400 without coercion or writes", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const routes = createCouponAdminRoutes((ctx) => ({ coupons: ctx.storage.coupons }));
  const create = routes["admin/coupons/create"];
  await assert.rejects(
    () => create.handler(routeContext(f.coupons, { ...form(), discountKind: "bogus" })),
    (error) => error.code === "INVALID_INPUT" && error.status === 400,
  );
  await assert.rejects(
    () => create.handler(routeContext(f.coupons, { ...form(), usageLimit: 3 })),
    (error) => error.code === "INVALID_INPUT" && error.status === 400,
  );
  const rows = await f.coupons.query({ limit: 10 });
  assert.equal(rows.items.length, 0);
});

test("stale edit is a 409, disable preserves accepted attempts, and counts remain authoritative", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const ports = createCouponAdminPorts({ coupons: f.coupons });
  const coupon = await createCoupon(ports, form({ usageLimit: "2" }));
  const quote = {
    quoteId: "quote-1", couponId: coupon.couponId, ruleId: coupon.rule.ruleId, ruleVersion: coupon.rule.version,
    eligibleSubtotal: { currency: "USD", minor: "1000" }, discount: { currency: "USD", minor: "100" },
    payableMerchandiseTotal: { currency: "USD", minor: "900" },
    lines: [{ productId: "item-1", quantity: 1, unitPrice: { currency: "USD", minor: "1000" }, lineSubtotal: { currency: "USD", minor: "1000" }, eligible: true, discount: { currency: "USD", minor: "100" } }],
  };
  const attempt = await ports.attempts.reserve({ couponId: coupon.couponId, attemptId: "attempt-1", quote, overallPayableTotal: { currency: "USD", minor: "900" }, now: "2026-06-01T12:00:00Z" });
  await ports.attempts.attachProviderSession(coupon.couponId, attempt.attemptId, "provider-session-1");
  await ports.attempts.reconcile(coupon.couponId, attempt.attemptId, { kind: "verified-success", providerSessionId: "provider-session-1" });
  const routes = createCouponAdminRoutes((ctx) => ({ coupons: ctx.storage.coupons }));
  await assert.rejects(
    () => routes["admin/coupons/edit"].handler(routeContext(f.coupons, { ...form({ code: "NEWCODE" }), couponId: coupon.couponId, expectedRevision: "1" })),
    (error) => error.code === "INVALID_INPUT" && error.status === 400,
  );
  await ports.admin.edit(coupon.couponId, coupon.revision, { code: "CHANGED" });
  await assert.rejects(
    () => routes["admin/coupons/edit"].handler(routeContext(f.coupons, { ...form({ code: "NEWCODE" }), couponId: coupon.couponId, expectedRevision: coupon.revision })),
    (error) => error.code === "REVISION_CONFLICT" && error.status === 409,
  );
  const current = await ports.admin.get(coupon.couponId);
  const disabled = await ports.admin.disable(coupon.couponId, current.revision);
  assert.equal(disabled.disabled, true);
  const storedAttempt = await ports.attempts.get(coupon.couponId, attempt.attemptId);
  assert.equal(storedAttempt.providerSessionId, "provider-session-1");
  assert.equal(storedAttempt.state, "consumed");
  assert.deepEqual(await ports.attempts.getCounts(coupon.couponId), {
    couponId: coupon.couponId, cap: 2, capacity: 2, pending: 0, consumed: 1, released: 0, remaining: 1,
  });
});
