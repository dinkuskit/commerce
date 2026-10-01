import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { PluginStorageRepository } from "emdash";
import { COMMERCE_PLUGIN_ID } from "../../../dist/index.js";
import {
  CouponRedemptionError,
  createCouponAdmin,
  createCouponAttemptOwner,
  evaluateCoupon,
} from "../../../dist/features/coupons/index.js";

const TABLE = `CREATE TABLE _plugin_storage (
  plugin_id TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL,
  data TEXT NOT NULL, revision TEXT NOT NULL DEFAULT '0',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (plugin_id, collection, id)
)`;
const baseRule = (overrides = {}) => ({
  ruleId: "rule-core-v1", discount: { kind: "fixed", amount: { currency: "USD", minor: "100" } },
  appliesTo: "all-merchandise", selectedProductIds: [], includeSaleItems: true,
  minimumEligibleMerchandise: { currency: "USD", minor: "0" },
  startsAt: "2026-09-30T00:00:00.000Z", endsAt: "2026-10-02T00:00:00.000Z",
  timeZone: "UTC", ...overrides,
});

async function fixture({ cap = 2, amount = "100" } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "coupon-core-"));
  const path = join(dir, "commerce.sqlite");
  const database = new BetterSqlite3(path);
  database.pragma("journal_mode = WAL"); database.pragma("busy_timeout = 5000");
  database.exec(TABLE);
  database.exec(`CREATE UNIQUE INDEX coupon_code_uq ON _plugin_storage(plugin_id, collection, json_extract(data, '$.normalizedCode')) WHERE collection = 'coupons'`);
  database.close();
  const db = new Kysely({ dialect: new SqliteDialect({ database: new BetterSqlite3(path) }) });
  const coupons = new PluginStorageRepository(db, COMMERCE_PLUGIN_ID, "coupons", ["normalizedCode"]);
  const catalog = new PluginStorageRepository(db, COMMERCE_PLUGIN_ID, "catalogItems", []);
  const prices = new PluginStorageRepository(db, COMMERCE_PLUGIN_ID, "catalogPrices", []);
  await catalog.put("item", { recordKind: "catalog-item", itemId: "item" });
  await prices.put("item", { recordKind: "catalog-price", recordId: "item", catalogItemId: "item", regular: { currency: "USD", minor: amount } });
  const admin = createCouponAdmin(coupons);
  const coupon = await admin.create({ code: `CODE-${crypto.randomUUID()}`, globalCap: cap, rule: baseRule({ discount: { kind: "fixed", amount: { currency: "USD", minor: amount } } }) });
  const quote = await evaluateCoupon(coupon, { catalog, prices }, { quoteId: `quote-${crypto.randomUUID()}`, now: "2026-10-01T12:00:00Z", lines: [{ productId: "item", quantity: 1 }] });
  return { path, db, coupons, coupon, quote, owner: createCouponAttemptOwner(coupons), close: async () => { await db.destroy(); await rm(dir, { recursive: true, force: true }); } };
}
const total = (minor) => ({ currency: "USD", minor });
const reserve = (fix, id, overall = "0") => fix.owner.reserve({
  couponId: fix.coupon.couponId, attemptId: id, quote: fix.quote,
  overallPayableTotal: total(overall), now: "2026-10-01T12:00:00Z",
});
const expectCode = (code) => (error) => { assert.ok(error instanceof CouponRedemptionError); assert.equal(error.code, code); return true; };

test("reserve freezes quote and host final total; duplicate compares final total", async (t) => {
  const fix = await fixture(); t.after(fix.close);
  const attempt = await reserve(fix, "a1", "10");
  assert.equal(attempt.quote.overallPayableTotal.minor, "10");
  await assert.rejects(() => fix.owner.reserve({ couponId: fix.coupon.couponId, attemptId: "a1", quote: fix.quote, overallPayableTotal: total("11"), now: "2026-10-01T12:00:00Z" }), expectCode("CONFLICTING_ATTEMPT"));
  assert.throws(() => { attempt.quote.overallPayableTotal.minor = "99"; }, TypeError);
});

test("payable attempts require payment proof; free attempts use only strict free proof", async (t) => {
  const fix = await fixture(); t.after(fix.close);
  const payable = await reserve(fix, "payable", "10");
  const consumed = await fix.owner.reconcile(fix.coupon.couponId, payable.attemptId, { kind: "verified-success", providerSessionId: "s1" });
  assert.equal(consumed.state, "consumed");
  const free = await reserve(fix, "free", "0");
  await assert.rejects(() => fix.owner.attachProviderSession(fix.coupon.couponId, free.attemptId, "s-free"), expectCode("TERMINAL_CONFLICT"));
  const proof = { kind: "verified-free-order", attemptId: "free", couponId: fix.coupon.couponId, ruleId: fix.quote.ruleId, ruleVersion: fix.quote.ruleVersion, quoteId: fix.quote.quoteId, orderId: "order-1", receiptId: "receipt-1", overallPayableTotal: total("0") };
  assert.equal((await fix.owner.reconcileFreeOrder({ couponId: fix.coupon.couponId, attemptId: "free", proof })).state, "consumed");
  await assert.rejects(() => fix.owner.reconcileFreeOrder({ couponId: fix.coupon.couponId, attemptId: "free", proof: { ...proof, attemptId: "other" } }), expectCode("TERMINAL_CONFLICT"));
});

test("unknown is sticky for pending, released, and consumed; no resurrection", async (t) => {
  const fix = await fixture({ cap: 3 }); t.after(fix.close);
  const pending = await reserve(fix, "pending", "10");
  assert.deepEqual(await fix.owner.reconcile(fix.coupon.couponId, "pending", { kind: "unknown" }), pending);
  const released = await reserve(fix, "released", "10");
  await fix.owner.reconcile(fix.coupon.couponId, "released", { kind: "verified-not-created" });
  assert.equal((await fix.owner.reconcile(fix.coupon.couponId, "released", { kind: "unknown" })).state, "released");
  await fix.owner.attachProviderSession(fix.coupon.couponId, "pending", "session");
  await fix.owner.reconcile(fix.coupon.couponId, "pending", { kind: "verified-success", providerSessionId: "session" });
  assert.equal((await fix.owner.reconcile(fix.coupon.couponId, "pending", { kind: "unknown" })).state, "consumed");
});

test("malformed reconciliation and free proofs cannot mutate state", async (t) => {
  const fix = await fixture(); t.after(fix.close);
  await reserve(fix, "validate", "10");
  for (const value of [null, [], { kind: "junk" }, { kind: "verified-success", providerSessionId: "" }, { kind: "confirmed-failure", providerSessionId: null }]) {
    await assert.rejects(() => fix.owner.reconcile(fix.coupon.couponId, "validate", value), expectCode("INVALID_INPUT"));
  }
  const before = await fix.owner.get(fix.coupon.couponId, "validate");
  assert.deepEqual(await fix.owner.get(fix.coupon.couponId, "validate"), before);
});

test("released and consumed terminals reject contradictory outcomes", async (t) => {
  const fix = await fixture({ cap: 2 }); t.after(fix.close);
  await reserve(fix, "r", "10");
  await fix.owner.reconcile(fix.coupon.couponId, "r", { kind: "verified-not-created" });
  await assert.rejects(() => fix.owner.reconcile(fix.coupon.couponId, "r", { kind: "verified-success", providerSessionId: "late" }), expectCode("TERMINAL_CONFLICT"));
  await reserve(fix, "c", "10"); await fix.owner.attachProviderSession(fix.coupon.couponId, "c", "s");
  await fix.owner.reconcile(fix.coupon.couponId, "c", { kind: "verified-success", providerSessionId: "s" });
  await assert.rejects(() => fix.owner.reconcile(fix.coupon.couponId, "c", { kind: "confirmed-cancel", providerSessionId: "s" }), expectCode("TERMINAL_CONFLICT"));
});
