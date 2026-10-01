import assert from "node:assert/strict";
import test from "node:test";
import { fork } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { PluginStorageRepository } from "emdash";
import { COMMERCE_PLUGIN_ID } from "../../../dist/index.js";
import { CouponRedemptionError, createCouponAdmin, createCouponAttemptOwner, evaluateCoupon } from "../../../dist/features/coupons/index.js";

const workerPath = new URL("./coupon-process-worker.mjs", import.meta.url);
const TABLE = `CREATE TABLE _plugin_storage (plugin_id TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, revision TEXT NOT NULL DEFAULT '0', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (plugin_id, collection, id))`;
const rule = { ruleId: "race-rule", discount: { kind: "fixed", amount: { currency: "USD", minor: "100" } }, appliesTo: "all-merchandise", selectedProductIds: [], includeSaleItems: true, minimumEligibleMerchandise: { currency: "USD", minor: "0" }, startsAt: "2026-09-30T00:00:00.000Z", endsAt: "2026-10-02T00:00:00.000Z", timeZone: "UTC" };

test("real admin coupon and evaluator quote serialize one final slot across child processes and restart", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "coupon-process-")); const path = join(dir, "commerce.sqlite");
  const raw = new BetterSqlite3(path); raw.pragma("journal_mode = WAL"); raw.pragma("busy_timeout = 5000"); raw.exec(TABLE); raw.exec(`CREATE UNIQUE INDEX coupon_code_uq ON _plugin_storage(plugin_id, collection, json_extract(data, '$.normalizedCode')) WHERE collection = 'coupons'`); raw.close();
  const parentDb = new Kysely({ dialect: new SqliteDialect({ database: new BetterSqlite3(path) }) });
  const coupons = new PluginStorageRepository(parentDb, COMMERCE_PLUGIN_ID, "coupons", ["normalizedCode"]);
  const catalog = new PluginStorageRepository(parentDb, COMMERCE_PLUGIN_ID, "catalogItems", []); const prices = new PluginStorageRepository(parentDb, COMMERCE_PLUGIN_ID, "catalogPrices", []);
  await catalog.put("item", { recordKind: "catalog-item", itemId: "item" }); await prices.put("item", { recordKind: "catalog-price", recordId: "item", catalogItemId: "item", regular: { currency: "USD", minor: "100" } });
  const admin = createCouponAdmin(coupons); const coupon = await admin.create({ code: "race", globalCap: 1, rule }); const quote = await evaluateCoupon(coupon, { catalog, prices }, { quoteId: "race-quote", now: "2026-10-01T12:00:00Z", lines: [{ productId: "item", quantity: 1 }] });
  const encoded = Buffer.from(JSON.stringify(quote)).toString("base64");
  t.after(async () => { await parentDb.destroy(); await rm(dir, { recursive: true, force: true }); });
  const children = ["alpha", "beta"].map((id) => fork(workerPath, [path, coupon.couponId, id, encoded, "0"], { stdio: ["ignore", "ignore", "pipe", "ipc"] }));
  await Promise.all(children.map((child) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("ready timeout")), 10000); child.on("message", (msg) => { if (msg?.type === "ready") { clearTimeout(timer); resolve(); } }); child.on("error", reject); })));
  children.forEach((child) => child.send("go"));
  const results = await Promise.all(children.map((child) => new Promise((resolve, reject) => { child.on("message", (msg) => { if (msg?.type === "result") resolve(msg); }); child.on("error", reject); })));
  assert.equal(results.filter((item) => item.ok).length, 1); assert.equal(results.filter((item) => !item.ok)[0].code, "CAPACITY_EXHAUSTED");
  const reopenedDb = new Kysely({ dialect: new SqliteDialect({ database: new BetterSqlite3(path) }) }); const reopened = createCouponAttemptOwner(new PluginStorageRepository(reopenedDb, COMMERCE_PLUGIN_ID, "coupons", ["normalizedCode"]));
  const winner = results.find((item) => item.ok).attempt; assert.deepEqual((await reopened.getCounts(coupon.couponId)).remaining, 0); assert.equal((await reopened.get(coupon.couponId, winner.attemptId)).state, "pending");
  await assert.rejects(() => reopened.reserve({ couponId: coupon.couponId, attemptId: "gamma", quote, overallPayableTotal: { currency: "USD", minor: "0" }, now: "2026-10-01T12:00:00Z" }), (error) => { assert.ok(error instanceof CouponRedemptionError); return error.code === "CAPACITY_EXHAUSTED"; });
  await reopenedDb.destroy();
});
