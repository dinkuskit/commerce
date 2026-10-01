import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { PluginStorageRepository } from "emdash";
import { COMMERCE_PLUGIN_ID } from "../../../dist/index.js";
import { createCouponAdmin, evaluateCoupon } from "../../../dist/features/coupons/index.js";

const TABLE = `CREATE TABLE _plugin_storage (
  plugin_id TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL,
  data TEXT NOT NULL, revision TEXT NOT NULL DEFAULT '0',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (plugin_id, collection, id)
)`;
const rule = (overrides = {}) => ({
  ruleId: "rule-eval-v1", discount: { kind: "percentage", basisPoints: 2500 },
  appliesTo: "all-merchandise", selectedProductIds: [], includeSaleItems: true,
  minimumEligibleMerchandise: { currency: "USD", minor: "0" },
  startsAt: "2026-09-30T00:00:00.000Z", endsAt: "2026-10-02T00:00:00.000Z", timeZone: "UTC", ...overrides,
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "coupons-eval-")); const path = join(dir, "db.sqlite");
  const raw = new BetterSqlite3(path); raw.exec(TABLE); raw.exec(`CREATE UNIQUE INDEX coupon_code_uq ON _plugin_storage(plugin_id, collection, json_extract(data, '$.normalizedCode')) WHERE collection = 'coupons'`); raw.close();
  const db = new Kysely({ dialect: new SqliteDialect({ database: new BetterSqlite3(path) }) });
  const coupons = new PluginStorageRepository(db, COMMERCE_PLUGIN_ID, "coupons", ["normalizedCode"]);
  const catalog = new PluginStorageRepository(db, COMMERCE_PLUGIN_ID, "catalogItems", []);
  const prices = new PluginStorageRepository(db, COMMERCE_PLUGIN_ID, "catalogPrices", []);
  return { db, coupons, catalog, prices, close: async () => { await db.destroy(); await rm(dir, { recursive: true, force: true }); } };
}
async function product(fix, id, regular, sale) {
  await fix.catalog.put(id, { recordKind: "catalog-item", itemId: id });
  await fix.prices.put(id, { recordKind: "catalog-price", recordId: id, catalogItemId: id, regular: { currency: "USD", minor: regular }, ...(sale ? { sale: { currency: "USD", minor: sale } } : {}) });
}

test("admin uses actual indexed lookup, unique writes, CAS edits, and paginated listing", async (t) => {
  const fix = await fixture(); t.after(fix.close); const admin = createCouponAdmin(fix.coupons);
  const created = await admin.create({ code: "  save10 ", globalCap: 2, rule: rule() });
  assert.equal((await admin.findByCode(" SAVE10 ")).couponId, created.couponId);
  await assert.rejects(() => admin.create({ code: "save10", globalCap: 2, rule: rule() }), /normalized-code uniqueness/);
  const edited = await admin.edit(created.couponId, 1, { globalCap: 3 }); assert.equal(edited.globalCap, 3);
  await assert.rejects(() => admin.edit(created.couponId, 1, { globalCap: 4 }), /revision/);
  for (let i = 0; i < 105; i++) await admin.create({ code: `code-${i}`, globalCap: 1, rule: rule({ ruleId: `r-${i}` }) });
  assert.equal((await admin.list()).length, 106);
});

test("evaluator applies merchandise-only eligibility, caps, fixed discounts, clamps, and boundaries", async (t) => {
  const fix = await fixture(); t.after(fix.close);
  await product(fix, "a", "1000"); await product(fix, "sale", "500", "250"); await product(fix, "other", "900");
  const admin = createCouponAdmin(fix.coupons);
  const percent = await admin.create({ code: "percent", globalCap: 1, rule: rule({ appliesTo: "selected-products", selectedProductIds: ["a", "sale"], discount: { kind: "percentage", basisPoints: 5000, maximum: { currency: "USD", minor: "250" } }, includeSaleItems: false, minimumEligibleMerchandise: { currency: "USD", minor: "1000" } }) });
  const quote = (await evaluateCoupon(percent, { catalog: fix.catalog, prices: fix.prices }, { quoteId: "q", now: "2026-10-01T12:00:00-04:00", lines: [{ productId: "a", quantity: 1 }, { productId: "sale", quantity: 1 }, { productId: "other", quantity: 1 }] }));
  assert.equal(quote.eligibleSubtotal.minor, "1000"); assert.equal(quote.discount.minor, "250");
  const fixed = await admin.create({ code: "fixed", globalCap: 1, rule: rule({ discount: { kind: "fixed", amount: { currency: "USD", minor: "250" } } }) });
  const fixedQuote = await evaluateCoupon(fixed, { catalog: fix.catalog, prices: fix.prices }, { quoteId: "fixed-q", now: "2026-10-01T12:00:00Z", lines: [{ productId: "a", quantity: 1 }] });
  assert.equal(fixedQuote.discount.minor, "250");
  const boundary = await admin.create({ code: "boundary", globalCap: 1, rule: rule({ startsAt: "2026-10-01T12:00:00.000Z", endsAt: "2026-10-01T13:00:00.000Z" }) });
  await assert.rejects(() => evaluateCoupon(boundary, { catalog: fix.catalog, prices: fix.prices }, { quoteId: "before", now: "2026-10-01T11:59:59Z", lines: [{ productId: "a", quantity: 1 }] }));
  await assert.rejects(() => evaluateCoupon(boundary, { catalog: fix.catalog, prices: fix.prices }, { quoteId: "after", now: "2026-10-01T13:00:00+00:00", lines: [{ productId: "a", quantity: 1 }] }));
});

test("admin and evaluator reject local/impossible dates and forged price inputs", async (t) => {
  const fix = await fixture(); t.after(fix.close); const admin = createCouponAdmin(fix.coupons);
  await assert.rejects(() => admin.create({ code: "local", globalCap: 1, rule: rule({ startsAt: "2026-10-01T00:00:00", endsAt: "2026-10-02T00:00:00Z" }) }), /explicit UTC offset/);
  await assert.rejects(() => admin.create({ code: "bad", globalCap: 1, rule: rule({ startsAt: "2026-02-30T00:00:00Z" }) }), /real calendar date/);
  await fix.catalog.put("x", { recordKind: "catalog-item", itemId: "x" });
  await fix.prices.put("x", { recordKind: "catalog-price", recordId: "x", catalogItemId: "x", regular: { currency: "USD", minor: "01" } });
  const coupon = await admin.create({ code: "price", globalCap: 1, rule: rule() });
  await assert.rejects(() => evaluateCoupon(coupon, { catalog: fix.catalog, prices: fix.prices }, { quoteId: "x", now: "2026-10-01T00:00:00Z", lines: [{ productId: "x", quantity: 1 }] }));
});
