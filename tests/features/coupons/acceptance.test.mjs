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
  CouponAdminError,
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

function createDb(path) {
  const sqlite = new BetterSqlite3(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  return new Kysely({ dialect: new SqliteDialect({ database: sqlite }) });
}

async function setupDatabase(path) {
  const sqlite = new BetterSqlite3(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(TABLE);
  sqlite.exec(
    `CREATE UNIQUE INDEX coupon_code_uq ON _plugin_storage(plugin_id, collection, json_extract(data, '$.normalizedCode')) WHERE collection = 'coupons'`,
  );
  sqlite.close();
}

const ruleFixture = (overrides = {}) => ({
  ruleId: "rule-accept-v1",
  discount: { kind: "percentage", basisPoints: 2500 },
  appliesTo: "all-merchandise",
  selectedProductIds: [],
  includeSaleItems: true,
  minimumEligibleMerchandise: { currency: "USD", minor: "0" },
  startsAt: "2026-09-30T00:00:00.000Z",
  endsAt: "2026-10-02T00:00:00.000Z",
  timeZone: "UTC",
  ...overrides,
});

async function acceptanceFixture({ cap = 5 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "coupon-accept-"));
  const path = join(dir, "commerce.sqlite");
  await setupDatabase(path);

  const db1 = createDb(path);
  const db2 = createDb(path);

  const coupons1 = new PluginStorageRepository(db1, COMMERCE_PLUGIN_ID, "coupons", ["normalizedCode"]);
  const coupons2 = new PluginStorageRepository(db2, COMMERCE_PLUGIN_ID, "coupons", ["normalizedCode"]);
  const catalog = new PluginStorageRepository(db1, COMMERCE_PLUGIN_ID, "catalogItems", []);
  const prices = new PluginStorageRepository(db1, COMMERCE_PLUGIN_ID, "catalogPrices", []);

  return {
    dir,
    path,
    db1,
    db2,
    coupons1,
    coupons2,
    admin1: createCouponAdmin(coupons1),
    admin2: createCouponAdmin(coupons2),
    owner1: createCouponAttemptOwner(coupons1),
    owner2: createCouponAttemptOwner(coupons2),
    catalog,
    prices,
    close: async () => {
      await db1.destroy();
      await db2.destroy();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function addProduct(fix, id, regular, sale) {
  await fix.catalog.put(id, { recordKind: "catalog-item", itemId: id });
  await fix.prices.put(id, {
    recordKind: "catalog-price",
    recordId: id,
    catalogItemId: id,
    regular: { currency: "USD", minor: regular },
    ...(sale ? { sale: { currency: "USD", minor: sale } } : {}),
  });
}

const expectCode = (code) => (error) => {
  assert.ok(error instanceof CouponRedemptionError, `expected CouponRedemptionError, got ${error}`);
  assert.equal(error.code, code);
  return true;
};

// ---------------------------------------------------------------------------
// TEST 1: Concurrent SAME free proof, duplicate replay, conflicting order,
//         sticky unknown, and malformed proof fail-closed
// ---------------------------------------------------------------------------
test("1 Concurrent SAME free proof on independent SQLite connections both same consumed, duplicate replay, conflicting order rejected, free unknown holds, free released cannot consume, positive fake zero rejected, malformed proofs fail closed", async (t) => {
  const fix = await acceptanceFixture({ cap: 5 });
  t.after(fix.close);

  await addProduct(fix, "free-item", "100");
  const coupon = await fix.admin1.create({
    code: "FREE-CONCURRENT",
    globalCap: 5,
    rule: ruleFixture({
      discount: { kind: "fixed", amount: { currency: "USD", minor: "100" } },
    }),
  });

  const quote = await evaluateCoupon(
    coupon,
    { catalog: fix.catalog, prices: fix.prices },
    {
      quoteId: "quote-free-1",
      now: "2026-10-01T12:00:00Z",
      lines: [{ productId: "free-item", quantity: 1 }],
    },
  );
  assert.equal(quote.payableMerchandiseTotal.minor, "0");

  // Reserve a free attempt with overall total 0
  const reserved = await fix.owner1.reserve({
    couponId: coupon.couponId,
    attemptId: "free-att-1",
    quote,
    overallPayableTotal: { currency: "USD", minor: "0" },
    now: "2026-10-01T12:00:00Z",
  });
  assert.equal(reserved.state, "pending");

  const validProof = {
    kind: "verified-free-order",
    attemptId: "free-att-1",
    couponId: coupon.couponId,
    ruleId: quote.ruleId,
    ruleVersion: quote.ruleVersion,
    quoteId: quote.quoteId,
    orderId: "ord-free-100",
    receiptId: "rcpt-free-200",
    overallPayableTotal: { currency: "USD", minor: "0" },
  };

  // Concurrent SAME free proof on independent SQLite connections
  const [res1, res2] = await Promise.all([
    fix.owner1.reconcileFreeOrder({
      couponId: coupon.couponId,
      attemptId: "free-att-1",
      proof: validProof,
    }),
    fix.owner2.reconcileFreeOrder({
      couponId: coupon.couponId,
      attemptId: "free-att-1",
      proof: validProof,
    }),
  ]);

  assert.equal(res1.state, "consumed");
  assert.equal(res2.state, "consumed");
  assert.equal(res1.freeOrder.orderId, "ord-free-100");
  assert.equal(res2.freeOrder.orderId, "ord-free-100");
  assert.equal(res1.freeOrder.receiptId, "rcpt-free-200");
  assert.equal(res2.freeOrder.receiptId, "rcpt-free-200");

  // Restart fresh DB connection: duplicate proof stays same
  const freshDb = createDb(fix.path);
  t.after(() => freshDb.destroy());
  const freshOwner = createCouponAttemptOwner(
    new PluginStorageRepository(freshDb, COMMERCE_PLUGIN_ID, "coupons", ["normalizedCode"]),
  );

  const resFresh = await freshOwner.reconcileFreeOrder({
    couponId: coupon.couponId,
    attemptId: "free-att-1",
    proof: validProof,
  });
  assert.equal(resFresh.state, "consumed");
  assert.equal(resFresh.freeOrder.orderId, "ord-free-100");

  // Conflicting order rejected
  const conflictingProof = {
    ...validProof,
    orderId: "ord-different",
  };
  await assert.rejects(
    () =>
      fix.owner1.reconcileFreeOrder({
        couponId: coupon.couponId,
        attemptId: "free-att-1",
        proof: conflictingProof,
      }),
    expectCode("TERMINAL_CONFLICT"),
  );

  // Free unknown holds in pending
  await fix.owner1.reserve({
    couponId: coupon.couponId,
    attemptId: "free-att-2",
    quote,
    overallPayableTotal: { currency: "USD", minor: "0" },
    now: "2026-10-01T12:00:00Z",
  });

  const unknownRes = await fix.owner1.reconcileFreeOrder({
    couponId: coupon.couponId,
    attemptId: "free-att-2",
    proof: {
      kind: "unknown",
      attemptId: "free-att-2",
      couponId: coupon.couponId,
      ruleId: quote.ruleId,
      ruleVersion: quote.ruleVersion,
      quoteId: quote.quoteId,
    },
  });
  assert.equal(unknownRes.state, "pending");

  // Free released cannot consume
  await fix.owner1.reconcile(coupon.couponId, "free-att-2", { kind: "confirmed-failure" });
  const releasedAttempt = await fix.owner1.get(coupon.couponId, "free-att-2");
  assert.equal(releasedAttempt.state, "released");

  await assert.rejects(
    () =>
      fix.owner1.reconcileFreeOrder({
        couponId: coupon.couponId,
        attemptId: "free-att-2",
        proof: {
          ...validProof,
          attemptId: "free-att-2",
        },
      }),
    expectCode("TERMINAL_CONFLICT"),
  );

  // Positive quote fake zero / non-zero overall with merchandise 0 reject
  await addProduct(fix, "paid-item", "500");
  const paidCoupon = await fix.admin1.create({
    code: "PAID-COUPON",
    globalCap: 5,
    rule: ruleFixture({
      discount: { kind: "fixed", amount: { currency: "USD", minor: "100" } },
    }),
  });
  const paidQuote = await evaluateCoupon(
    paidCoupon,
    { catalog: fix.catalog, prices: fix.prices },
    {
      quoteId: "quote-paid-1",
      now: "2026-10-01T12:00:00Z",
      lines: [{ productId: "paid-item", quantity: 1 }],
    },
  );
  await fix.owner1.reserve({
    couponId: paidCoupon.couponId,
    attemptId: "paid-att-1",
    quote: paidQuote,
    overallPayableTotal: { currency: "USD", minor: "400" },
    now: "2026-10-01T12:00:00Z",
  });

  await assert.rejects(
    () =>
      fix.owner1.reconcileFreeOrder({
        couponId: paidCoupon.couponId,
        attemptId: "paid-att-1",
        proof: {
          kind: "verified-free-order",
          attemptId: "paid-att-1",
          couponId: paidCoupon.couponId,
          ruleId: paidQuote.ruleId,
          ruleVersion: paidQuote.ruleVersion,
          quoteId: paidQuote.quoteId,
          orderId: "ord-fake-zero",
          receiptId: "rcpt-fake-zero",
          overallPayableTotal: { currency: "USD", minor: "0" },
        },
      }),
    expectCode("TERMINAL_CONFLICT"),
  );

  // Malformed free proofs: junk kind, null, array, missing IDs, paymentId, providerSessionId EVEN empty reject with no count mutation
  const countsBefore = await fix.owner1.getCounts(coupon.couponId);
  const malformedProofs = [
    null,
    [],
    { kind: "junk" },
    { ...validProof, kind: "unknown-kind" },
    { ...validProof, orderId: "" },
    { ...validProof, receiptId: "" },
    { ...validProof, paymentId: "pay-123" },
    { ...validProof, providerSessionId: "sess-123" },
    { ...validProof, providerSessionId: "" },
    { ...validProof, overallPayableTotal: { currency: "USD", minor: "100" } },
  ];

  for (const badProof of malformedProofs) {
    await assert.rejects(
      () =>
        fix.owner1.reconcileFreeOrder({
          couponId: coupon.couponId,
          attemptId: "free-att-1",
          proof: badProof,
        }),
      (err) => err instanceof CouponRedemptionError,
    );
  }

  const countsAfter = await fix.owner1.getCounts(coupon.couponId);
  assert.deepEqual(countsAfter, countsBefore);
});

// ---------------------------------------------------------------------------
// TEST 2: Existing attempt identical retry after admin edit/disable/expiry
//         retains original snapshot; conflicting quote/rule/total rejected;
//         new stale/current disabled rejected; no released retry resurrection
// ---------------------------------------------------------------------------
test("2 Existing attempt identical retry after admin edit/disable/expiry retains original snapshot; conflicting same quoteId rejected; new stale/current disabled rejected; no released retry resurrection", async (t) => {
  const fix = await acceptanceFixture({ cap: 5 });
  t.after(fix.close);

  await addProduct(fix, "retry-item", "1000");
  const coupon = await fix.admin1.create({
    code: "RETRY-TEST",
    globalCap: 5,
    rule: ruleFixture({
      discount: { kind: "percentage", basisPoints: 2000 }, // 20%
    }),
  });

  const quoteV1 = await evaluateCoupon(
    coupon,
    { catalog: fix.catalog, prices: fix.prices },
    {
      quoteId: "quote-v1",
      now: "2026-10-01T12:00:00Z",
      lines: [{ productId: "retry-item", quantity: 1 }],
    },
  );

  // Reserve attempt att-retry-1
  const attemptV1 = await fix.owner1.reserve({
    couponId: coupon.couponId,
    attemptId: "att-retry-1",
    quote: quoteV1,
    overallPayableTotal: { currency: "USD", minor: "800" },
    now: "2026-10-01T12:00:00Z",
  });
  assert.equal(attemptV1.ruleVersion, 1);
  assert.equal(attemptV1.quote.discount.minor, "200");

  // Admin edits coupon: revision 2, new discount, then disables coupon
  const edited = await fix.admin1.edit(coupon.couponId, 1, {
    rule: ruleFixture({
      discount: { kind: "percentage", basisPoints: 5000 }, // 50%
      startsAt: "2026-09-30T00:00:00.000Z",
      endsAt: "2026-10-01T00:00:00.000Z", // expired!
    }),
    disabled: true,
  });
  assert.equal(edited.revision, 2);
  assert.equal(edited.disabled, true);

  // Identical retry of att-retry-1 succeeds and retains original snapshot!
  const retry1 = await fix.owner1.reserve({
    couponId: coupon.couponId,
    attemptId: "att-retry-1",
    quote: quoteV1,
    overallPayableTotal: { currency: "USD", minor: "800" },
    now: "2026-10-01T12:00:00Z",
  });
  assert.equal(retry1.ruleVersion, 1);
  assert.equal(retry1.quote.discount.minor, "200");
  assert.equal(retry1.attemptId, "att-retry-1");

  // Identical retry with shuffled object property order still succeeds (canonical key order)
  const shuffledQuote = {
    lines: quoteV1.lines.map((l) => ({
      discount: { minor: l.discount.minor, currency: l.discount.currency },
      eligible: l.eligible,
      lineSubtotal: { minor: l.lineSubtotal.minor, currency: l.lineSubtotal.currency },
      productId: l.productId,
      quantity: l.quantity,
      unitPrice: { minor: l.unitPrice.minor, currency: l.unitPrice.currency },
    })),
    payableMerchandiseTotal: { minor: quoteV1.payableMerchandiseTotal.minor, currency: "USD" },
    discount: { minor: quoteV1.discount.minor, currency: "USD" },
    eligibleSubtotal: { minor: quoteV1.eligibleSubtotal.minor, currency: "USD" },
    ruleVersion: quoteV1.ruleVersion,
    ruleId: quoteV1.ruleId,
    couponId: quoteV1.couponId,
    quoteId: quoteV1.quoteId,
  };
  const retryShuffled = await fix.owner1.reserve({
    couponId: coupon.couponId,
    attemptId: "att-retry-1",
    quote: shuffledQuote,
    overallPayableTotal: { minor: "800", currency: "USD" },
    now: "2026-10-01T12:00:00Z",
  });
  assert.equal(retryShuffled.attemptId, "att-retry-1");

  // Conflicting retry: same quoteId but altered final total
  await assert.rejects(
    () =>
      fix.owner1.reserve({
        couponId: coupon.couponId,
        attemptId: "att-retry-1",
        quote: quoteV1,
        overallPayableTotal: { currency: "USD", minor: "801" },
        now: "2026-10-01T12:00:00Z",
      }),
    expectCode("CONFLICTING_ATTEMPT"),
  );

  // Conflicting retry: same quoteId but altered content (rule version, line, amount)
  const alteredQuote = {
    ...quoteV1,
    discount: { currency: "USD", minor: "300" },
    payableMerchandiseTotal: { currency: "USD", minor: "700" },
    lines: [{ ...quoteV1.lines[0], discount: { currency: "USD", minor: "300" } }],
  };
  await assert.rejects(
    () =>
      fix.owner1.reserve({
        couponId: coupon.couponId,
        attemptId: "att-retry-1",
        quote: alteredQuote,
        overallPayableTotal: { currency: "USD", minor: "800" },
        now: "2026-10-01T12:00:00Z",
      }),
    expectCode("CONFLICTING_ATTEMPT"),
  );

  // New attempt with stale quote (v1) rejected (fenced to current coupon rule)
  await assert.rejects(
    () =>
      fix.owner1.reserve({
        couponId: coupon.couponId,
        attemptId: "new-attempt-stale",
        quote: quoteV1,
        overallPayableTotal: { currency: "USD", minor: "800" },
        now: "2026-10-01T12:00:00Z",
      }),
    expectCode("CONFLICTING_ATTEMPT"),
  );

  // New attempt when coupon is disabled/expired rejected
  const reenabled = await fix.admin1.edit(coupon.couponId, 2, {
    disabled: false,
    rule: ruleFixture({
      startsAt: "2026-09-30T00:00:00.000Z",
      endsAt: "2026-10-02T00:00:00.000Z",
    }),
  });
  const quoteV3 = await evaluateCoupon(
    reenabled,
    { catalog: fix.catalog, prices: fix.prices },
    {
      quoteId: "quote-v3",
      now: "2026-10-01T12:00:00Z",
      lines: [{ productId: "retry-item", quantity: 1 }],
    },
  );
  // Now disable again (preserves rule version 3)
  await fix.admin1.disable(coupon.couponId, 3);
  await assert.rejects(
    () =>
      fix.owner1.reserve({
        couponId: coupon.couponId,
        attemptId: "new-attempt-disabled",
        quote: quoteV3,
        overallPayableTotal: { currency: "USD", minor: "750" },
        now: "2026-10-01T12:00:00Z",
      }),
    expectCode("INVALID_INPUT"),
  );

  // No released retry resurrection
  // Re-enable so we can test release on att-retry-1
  await fix.admin1.edit(coupon.couponId, 4, { disabled: false });
  await fix.owner1.attachProviderSession(coupon.couponId, "att-retry-1", "sess-retry");
  await fix.owner1.reconcile(coupon.couponId, "att-retry-1", {
    kind: "confirmed-failure",
    providerSessionId: "sess-retry",
  });
  const released = await fix.owner1.get(coupon.couponId, "att-retry-1");
  assert.equal(released.state, "released");

  // Re-reserve with same attemptId returns released state, does not resurrect to pending!
  const retryReleased = await fix.owner1.reserve({
    couponId: coupon.couponId,
    attemptId: "att-retry-1",
    quote: quoteV1,
    overallPayableTotal: { currency: "USD", minor: "800" },
    now: "2026-10-01T12:00:00Z",
  });
  assert.equal(retryReleased.state, "released");
});

// ---------------------------------------------------------------------------
// TEST 3: Full returned rule edits force trusted monotonic versions; stale
//         new attempts reject while original retries retain their quote
// ---------------------------------------------------------------------------
test("3 Full returned rule edits force trusted monotonic versions and preserve frozen attempts", async (t) => {
  const fix = await acceptanceFixture();
  t.after(fix.close);

  await addProduct(fix, "version-item", "1000");
  const createdWithFutureVersion = await fix.admin1.create({
    code: "VERSION-CREATE",
    globalCap: 5,
    rule: ruleFixture({ version: 99 }),
  });
  assert.equal(createdWithFutureVersion.rule.version, 1);

  const coupon = await fix.admin1.create({
    code: "VERSION-EDIT",
    globalCap: 5,
    rule: ruleFixture({
      ruleId: "rule-versioned",
      discount: { kind: "percentage", basisPoints: 2000 },
      minimumEligibleMerchandise: { currency: "USD", minor: "1000" },
    }),
  });
  const oldQuote = await evaluateCoupon(
    coupon,
    { catalog: fix.catalog, prices: fix.prices },
    {
      quoteId: "quote-version-old",
      now: "2026-10-01T12:00:00Z",
      lines: [{ productId: "version-item", quantity: 1 }],
    },
  );
  assert.equal(oldQuote.ruleVersion, 1);
  assert.equal(oldQuote.discount.minor, "200");

  const originalAttempt = await fix.owner1.reserve({
    couponId: coupon.couponId,
    attemptId: "att-version-original",
    quote: oldQuote,
    overallPayableTotal: { currency: "USD", minor: "800" },
    now: "2026-10-01T12:00:00Z",
  });
  assert.equal(originalAttempt.ruleVersion, 1);

  const editedWithOldReturnedRule = await fix.admin1.edit(coupon.couponId, 1, {
    rule: {
      ...coupon.rule,
      version: 1,
      discount: { kind: "percentage", basisPoints: 5000 },
      minimumEligibleMerchandise: { currency: "USD", minor: "500" },
    },
  });
  assert.equal(editedWithOldReturnedRule.rule.version, 2);
  assert.equal(editedWithOldReturnedRule.rule.discount.basisPoints, 5000);

  await assert.rejects(
    () =>
      fix.owner1.reserve({
        couponId: coupon.couponId,
        attemptId: "att-version-stale-new",
        quote: oldQuote,
        overallPayableTotal: { currency: "USD", minor: "800" },
        now: "2026-10-01T12:00:00Z",
      }),
    expectCode("CONFLICTING_ATTEMPT"),
  );

  const originalRetry = await fix.owner1.reserve({
    couponId: coupon.couponId,
    attemptId: "att-version-original",
    quote: oldQuote,
    overallPayableTotal: { currency: "USD", minor: "800" },
    now: "2026-10-01T12:00:00Z",
  });
  assert.equal(originalRetry.ruleVersion, 1);
  assert.equal(originalRetry.quote.discount.minor, "200");

  const freshQuote = await evaluateCoupon(
    editedWithOldReturnedRule,
    { catalog: fix.catalog, prices: fix.prices },
    {
      quoteId: "quote-version-fresh",
      now: "2026-10-01T12:00:00Z",
      lines: [{ productId: "version-item", quantity: 1 }],
    },
  );
  assert.equal(freshQuote.ruleVersion, 2);
  assert.equal(freshQuote.discount.minor, "500");

  const editedWithFutureReturnedRule = await fix.admin1.edit(coupon.couponId, 2, {
    rule: {
      ...editedWithOldReturnedRule.rule,
      version: 999,
      discount: { kind: "percentage", basisPoints: 1000 },
    },
  });
  assert.equal(editedWithFutureReturnedRule.rule.version, 3);
});

// ---------------------------------------------------------------------------
// TEST 3: Cap edit vs reserve concurrent independent connections actual CAS;
//         cap shrink below pending+consumed preserves counts remaining 0;
//         cap increase allows new reserve; fresh connection restart same counts
// ---------------------------------------------------------------------------
test("3 Cap edit vs reserve concurrent independent connections actual CAS; cap shrink below pending+consumed preserves counts remaining 0; cap increase allows new reserve; fresh connection restart same counts", async (t) => {
  const fix = await acceptanceFixture({ cap: 2 });
  t.after(fix.close);

  await addProduct(fix, "cap-item", "1000");
  const coupon = await fix.admin1.create({
    code: "CAP-CONCURRENT",
    globalCap: 2,
    rule: ruleFixture({
      discount: { kind: "fixed", amount: { currency: "USD", minor: "200" } },
    }),
  });

  const quote = await evaluateCoupon(
    coupon,
    { catalog: fix.catalog, prices: fix.prices },
    {
      quoteId: "quote-cap-1",
      now: "2026-10-01T12:00:00Z",
      lines: [{ productId: "cap-item", quantity: 1 }],
    },
  );

  // Reserve attempt 1 on connection 1
  await fix.owner1.reserve({
    couponId: coupon.couponId,
    attemptId: "cap-att-1",
    quote,
    overallPayableTotal: { currency: "USD", minor: "800" },
    now: "2026-10-01T12:00:00Z",
  });

  // Concurrent cap edit (on connection 2) vs reserve attempt 2 (on connection 1)
  const results = await Promise.allSettled([
    fix.admin2.edit(coupon.couponId, 1, { globalCap: 1 }), // shrink cap to 1
    fix.owner1.reserve({
      couponId: coupon.couponId,
      attemptId: "cap-att-2",
      quote,
      overallPayableTotal: { currency: "USD", minor: "800" },
      now: "2026-10-01T12:00:00Z",
    }),
  ]);

  // Both outcomes are serializable: either cap edit succeeded first (so reserve failed CAPACITY_EXHAUSTED),
  // or reserve succeeded first (and cap edit succeeded afterwards).
  for (const res of results) {
    if (res.status === "rejected") {
      assert.ok(
        res.reason instanceof CouponRedemptionError && res.reason.code === "CAPACITY_EXHAUSTED",
        `unexpected rejection: ${res.reason}`,
      );
    }
  }

  // Ensure cap is shrunk to 1 regardless of order
  const currentRecord = await fix.admin1.get(coupon.couponId);
  if (currentRecord.globalCap !== 1) {
    await fix.admin1.edit(coupon.couponId, currentRecord.revision, { globalCap: 1 });
  }

  // Cap shrink below pending + consumed preserves counts remaining 0
  const countsShrunk = await fix.owner1.getCounts(coupon.couponId);
  assert.equal(countsShrunk.cap, 1);
  assert.equal(countsShrunk.capacity, 1);
  assert.ok(countsShrunk.pending >= 1);
  assert.equal(countsShrunk.remaining, 0);

  // Reserving new attempt fails with CAPACITY_EXHAUSTED
  await assert.rejects(
    () =>
      fix.owner1.reserve({
        couponId: coupon.couponId,
        attemptId: "cap-att-never",
        quote,
        overallPayableTotal: { currency: "USD", minor: "800" },
        now: "2026-10-01T12:00:00Z",
      }),
    expectCode("CAPACITY_EXHAUSTED"),
  );

  // Cap increase: admin increases cap to 10
  const updatedCoupon = await fix.admin1.get(coupon.couponId);
  const increased = await fix.admin1.edit(coupon.couponId, updatedCoupon.revision, {
    globalCap: 10,
  });
  assert.equal(increased.globalCap, 10);

  // Fresh quote for updated coupon rule allows new reserve
  const freshQuote = await evaluateCoupon(
    increased,
    { catalog: fix.catalog, prices: fix.prices },
    {
      quoteId: "quote-cap-fresh",
      now: "2026-10-01T12:00:00Z",
      lines: [{ productId: "cap-item", quantity: 1 }],
    },
  );

  const newReserve = await fix.owner1.reserve({
    couponId: coupon.couponId,
    attemptId: "cap-att-expanded",
    quote: freshQuote,
    overallPayableTotal: { currency: "USD", minor: "800" },
    now: "2026-10-01T12:00:00Z",
  });
  assert.equal(newReserve.state, "pending");

  // Fresh connection restart yields identical counts
  const freshDb = createDb(fix.path);
  t.after(() => freshDb.destroy());
  const freshOwner = createCouponAttemptOwner(
    new PluginStorageRepository(freshDb, COMMERCE_PLUGIN_ID, "coupons", ["normalizedCode"]),
  );
  const restartCounts = await freshOwner.getCounts(coupon.couponId);
  assert.equal(restartCounts.cap, 10);
  assert.equal(restartCounts.remaining, 10 - restartCounts.pending - restartCounts.consumed);
});

// ---------------------------------------------------------------------------
// TEST 4: Actual unique index concurrent create same code exactly one succeeds;
//         code edit collision preserves original rules; query declared index
// ---------------------------------------------------------------------------
test("4 Actual unique index concurrent create same code exactly one succeeds; code edit collision preserves original rules; query declared index", async (t) => {
  const fix = await acceptanceFixture();
  t.after(fix.close);

  const sharedCode = "CONCURRENT-CODE-SAVE";

  // Concurrent create on independent connections with same code
  const [c1, c2] = await Promise.allSettled([
    fix.admin1.create({
      code: `  ${sharedCode}  `,
      globalCap: 5,
      rule: ruleFixture({ ruleId: "rule-winner-1" }),
    }),
    fix.admin2.create({
      code: sharedCode.toLowerCase(),
      globalCap: 10,
      rule: ruleFixture({ ruleId: "rule-winner-2" }),
    }),
  ]);

  const fulfilled = [c1, c2].filter((r) => r.status === "fulfilled");
  const rejected = [c1, c2].filter((r) => r.status === "rejected");

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(
    rejected[0].reason instanceof CouponAdminError &&
      rejected[0].reason.code === "STORAGE_UNAVAILABLE",
  );

  const winner = fulfilled[0].value;
  assert.equal(winner.normalizedCode, sharedCode);

  // Query declared index lookup
  const found = await fix.admin1.findByCode(`  ${sharedCode.toLowerCase()}  `);
  assert.ok(found);
  assert.equal(found.couponId, winner.couponId);

  // Create a second distinct coupon
  const second = await fix.admin1.create({
    code: "SECOND-COUPON",
    globalCap: 3,
    rule: ruleFixture({ ruleId: "rule-second" }),
  });

  // Edit collision: editing second coupon to have sharedCode collides with unique index
  await assert.rejects(
    () =>
      fix.admin1.edit(second.couponId, second.revision, {
        code: sharedCode,
      }),
    (err) => err instanceof CouponAdminError && err.code === "STORAGE_UNAVAILABLE",
  );

  // Verify original rules and code preserved on collision
  const secondAfter = await fix.admin1.get(second.couponId);
  assert.equal(secondAfter.code, "SECOND-COUPON");
  assert.equal(secondAfter.rule.ruleId, "rule-second");
  assert.equal(secondAfter.revision, 1);
});

// ---------------------------------------------------------------------------
// TEST 5: Stored record corruption fails closed on getCounts and new reserve
// ---------------------------------------------------------------------------
test("5 Stored record corruption: missing attempts, invalid state, consumed no proof, duplicate attempt, quote allocations bad fail closed on getCounts and new reserve", async (t) => {
  const fix = await acceptanceFixture();
  t.after(fix.close);

  await addProduct(fix, "corrupt-item", "1000");
  const coupon = await fix.admin1.create({
    code: "CORRUPT-TEST",
    globalCap: 5,
    rule: ruleFixture(),
  });

  const quote = await evaluateCoupon(
    coupon,
    { catalog: fix.catalog, prices: fix.prices },
    {
      quoteId: "quote-corrupt-1",
      now: "2026-10-01T12:00:00Z",
      lines: [{ productId: "corrupt-item", quantity: 1 }],
    },
  );

  // Reserve a valid attempt first
  await fix.owner1.reserve({
    couponId: coupon.couponId,
    attemptId: "att-valid",
    quote,
    overallPayableTotal: { currency: "USD", minor: "750" },
    now: "2026-10-01T12:00:00Z",
  });

  // Helper to mutate raw JSON in SQLite
  const rawDb = new BetterSqlite3(fix.path);
  t.after(() => rawDb.close());

  // Snapshot clean record data before corruptions
  const cleanRow = rawDb
    .prepare(
      "SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = 'coupons' AND id = ?",
    )
    .get(COMMERCE_PLUGIN_ID, coupon.couponId);
  const cleanData = JSON.parse(cleanRow.data);

  function injectCorruptedRecord(mutator) {
    const data = structuredClone(cleanData);
    mutator(data);
    rawDb
      .prepare(
        "UPDATE _plugin_storage SET data = ?, revision = CAST((CAST(revision AS INTEGER) + 1) AS TEXT) WHERE plugin_id = ? AND collection = 'coupons' AND id = ?",
      )
      .run(JSON.stringify(data), COMMERCE_PLUGIN_ID, coupon.couponId);
  }

  // Corruptions to test:
  const corruptions = [
    {
      name: "missing attempts property",
      mutate: (d) => { delete d.attempts; },
    },
    {
      name: "invalid state in attempt",
      mutate: (d) => { d.attempts = [{ ...d.attempts[0], state: "invalid-state" }]; },
    },
    {
      name: "consumed without proof",
      mutate: (d) => {
        d.attempts = [{
          ...d.attempts[0],
          state: "consumed",
          providerSessionId: undefined,
          freeOrder: undefined,
        }];
      },
    },
    {
      name: "consumed attempt with both providerSessionId and freeOrder",
      mutate: (d) => {
        d.attempts = [{
          ...d.attempts[0],
          state: "consumed",
          providerSessionId: "sess-1",
          freeOrder: { orderId: "ord-1", receiptId: "rcpt-1" },
        }];
      },
    },
    {
      name: "duplicate attemptId in attempts array",
      mutate: (d) => { d.attempts = [d.attempts[0], { ...d.attempts[0] }]; },
    },
    {
      name: "corrupted quote line allocations (lineSubtotal !== unitPrice * qty)",
      mutate: (d) => {
        d.attempts = [{
          ...d.attempts[0],
          quote: {
            ...d.attempts[0].quote,
            lines: [{ ...d.attempts[0].quote.lines[0], lineSubtotal: { currency: "USD", minor: "9999" } }],
          },
        }];
      },
    },
    {
      name: "corrupted stored start instant (impossible calendar date)",
      mutate: (d) => { d.rule.startsAt = "2026-02-31T00:00:00.000Z"; },
    },
    {
      name: "corrupted stored timeZone (invalid IANA)",
      mutate: (d) => { d.rule.timeZone = "Mars/Olympus"; },
    },
  ];

  for (const { name, mutate } of corruptions) {
    injectCorruptedRecord(mutate);

    // getCounts must fail closed with CORRUPTED_RECORD
    await assert.rejects(
      () => fix.owner1.getCounts(coupon.couponId),
      expectCode("CORRUPTED_RECORD"),
      `expected getCounts to fail closed on ${name}`,
    );

    // reserve must fail closed with CORRUPTED_RECORD (no free capacity)
    await assert.rejects(
      () =>
        fix.owner1.reserve({
          couponId: coupon.couponId,
          attemptId: `att-fail-${Math.random()}`,
          quote,
          overallPayableTotal: { currency: "USD", minor: "750" },
          now: "2026-10-01T12:00:00Z",
        }),
      expectCode("CORRUPTED_RECORD"),
      `expected reserve to fail closed on ${name}`,
    );
  }
});

// ---------------------------------------------------------------------------
// TEST 6: Attempt lookup is nullable for missing coupons/attempts, while
//         stored attempts remain frozen clones and corruption fails closed
// ---------------------------------------------------------------------------
test("6 Attempt get returns null for absent coupon or attempt, clones present attempts, and fails closed on corrupt records", async (t) => {
  const fix = await acceptanceFixture();
  t.after(fix.close);

  assert.equal(await fix.owner1.get("missing-coupon", "missing-attempt"), null);

  await addProduct(fix, "get-item", "1000");
  const coupon = await fix.admin1.create({
    code: "GET-NULLABLE",
    globalCap: 5,
    rule: ruleFixture(),
  });
  assert.equal(await fix.owner1.get(coupon.couponId, "missing-attempt"), null);

  const quote = await evaluateCoupon(
    coupon,
    { catalog: fix.catalog, prices: fix.prices },
    {
      quoteId: "quote-get",
      now: "2026-10-01T12:00:00Z",
      lines: [{ productId: "get-item", quantity: 1 }],
    },
  );
  await fix.owner1.reserve({
    couponId: coupon.couponId,
    attemptId: "att-get",
    quote,
    overallPayableTotal: { currency: "USD", minor: "750" },
    now: "2026-10-01T12:00:00Z",
  });

  const present = await fix.owner1.get(coupon.couponId, "att-get");
  assert.equal(present.attemptId, "att-get");
  assert.ok(Object.isFrozen(present));
  assert.equal((await fix.owner1.get(coupon.couponId, "att-get")).quoteId, "quote-get");

  const rawDb = new BetterSqlite3(fix.path);
  t.after(() => rawDb.close());
  rawDb
    .prepare(
      "UPDATE _plugin_storage SET data = ?, revision = CAST((CAST(revision AS INTEGER) + 1) AS TEXT) WHERE plugin_id = ? AND collection = 'coupons' AND id = ?",
    )
    .run(
      JSON.stringify({ ...coupon, attempts: undefined }),
      COMMERCE_PLUGIN_ID,
      coupon.couponId,
    );

  await assert.rejects(
    () => fix.owner1.get(coupon.couponId, "absent-after-corruption"),
    expectCode("CORRUPTED_RECORD"),
  );
});

// ---------------------------------------------------------------------------
// TEST 7: Evaluator HALFUP total two 1-cent at 25% = 1 cent; deterministic
//         largest remainder allocations sum; sale inclusion true + default false;
//         minimum fails despite unrelated lines; percent max / fixed clamp;
//         inclusive start and exclusive end equal instant offset;
//         browser unit price / total fields rejected; immutable quote
// ---------------------------------------------------------------------------
test("6 Evaluator half-up total two 1-cent at 25% = 1 cent; deterministic largest remainder; sale inclusion; minimum fails despite unrelated; clamp; instant boundaries; browser fields rejected; immutable quote", async (t) => {
  const fix = await acceptanceFixture();
  t.after(fix.close);

  // Setup catalog items
  await addProduct(fix, "one-cent-1", "1");
  await addProduct(fix, "one-cent-2", "1");
  await addProduct(fix, "sale-item", "1000", "600");
  await addProduct(fix, "reg-item", "1000");
  await addProduct(fix, "expensive-unrelated", "50000");

  // 1. Evaluator HALF-UP: two 1-cent lines at 25% = 1 cent discount
  const halfUpCoupon = await fix.admin1.create({
    code: "HALF-UP",
    globalCap: 10,
    rule: ruleFixture({
      discount: { kind: "percentage", basisPoints: 2500 }, // 25%
    }),
  });
  const halfUpQuote = await evaluateCoupon(
    halfUpCoupon,
    { catalog: fix.catalog, prices: fix.prices },
    {
      quoteId: "q-halfup",
      now: "2026-10-01T12:00:00Z",
      lines: [
        { productId: "one-cent-1", quantity: 1 },
        { productId: "one-cent-2", quantity: 1 },
      ],
    },
  );
  // Total eligible: 2 cents. 2 * 25% = 0.5 cents -> half-up rounds to 1 cent.
  assert.equal(halfUpQuote.discount.minor, "1");
  assert.equal(halfUpQuote.merchandiseTotal.minor, "2");
  assert.equal(halfUpQuote.payableMerchandiseTotal.minor, "1");
  // Exactly one line gets 1 cent discount; the other gets 0. Sum of line discounts == 1.
  const lineDiscountSum = halfUpQuote.lines.reduce(
    (sum, l) => sum + BigInt(l.discount.minor),
    0n,
  );
  assert.equal(lineDiscountSum, 1n);

  // 2. Deterministic largest remainder allocations sum
  await addProduct(fix, "rem-1", "1000");
  await addProduct(fix, "rem-2", "1000");
  await addProduct(fix, "rem-3", "1000");
  const remCoupon = await fix.admin1.create({
    code: "REMAINDER-TEST",
    globalCap: 10,
    rule: ruleFixture({
      discount: { kind: "percentage", basisPoints: 3333 }, // 33.33%
    }),
  });
  const remQuote = await evaluateCoupon(
    remCoupon,
    { catalog: fix.catalog, prices: fix.prices },
    {
      quoteId: "q-rem",
      now: "2026-10-01T12:00:00Z",
      lines: [
        { productId: "rem-1", quantity: 1 },
        { productId: "rem-2", quantity: 1 },
        { productId: "rem-3", quantity: 1 },
      ],
    },
  );
  // 3000 * 3333 / 10000 = 999.9 -> 1000 discount
  assert.equal(remQuote.discount.minor, "1000");
  const remSum = remQuote.lines.reduce((sum, l) => sum + BigInt(l.discount.minor), 0n);
  assert.equal(remSum, 1000n);

  // 3. Sale inclusion: includeSaleItems true vs false (default false)
  const couponSaleTrue = await fix.admin1.create({
    code: "SALE-INCLUDED",
    globalCap: 10,
    rule: ruleFixture({
      includeSaleItems: true,
      discount: { kind: "percentage", basisPoints: 1000 },
    }),
  });
  const quoteSaleTrue = await evaluateCoupon(
    couponSaleTrue,
    { catalog: fix.catalog, prices: fix.prices },
    {
      quoteId: "q-sale-true",
      now: "2026-10-01T12:00:00Z",
      lines: [{ productId: "sale-item", quantity: 1 }],
    },
  );
  assert.equal(quoteSaleTrue.lines[0].eligible, true);
  assert.equal(quoteSaleTrue.discount.minor, "60"); // 10% of 600 sale price

  const couponSaleFalse = await fix.admin1.create({
    code: "SALE-EXCLUDED",
    globalCap: 10,
    rule: ruleFixture({
      includeSaleItems: false,
      discount: { kind: "percentage", basisPoints: 1000 },
    }),
  });
  const quoteSaleFalse = await evaluateCoupon(
    couponSaleFalse,
    { catalog: fix.catalog, prices: fix.prices },
    {
      quoteId: "q-sale-false",
      now: "2026-10-01T12:00:00Z",
      lines: [{ productId: "sale-item", quantity: 1 }],
    },
  );
  assert.equal(quoteSaleFalse.lines[0].eligible, false);
  assert.equal(quoteSaleFalse.discount.minor, "0");

  // 4. Minimum fails despite unrelated lines
  const couponMin = await fix.admin1.create({
    code: "MIN-THRESHOLD",
    globalCap: 10,
    rule: ruleFixture({
      appliesTo: "selected-products",
      selectedProductIds: ["reg-item"],
      minimumEligibleMerchandise: { currency: "USD", minor: "5000" }, // $50 minimum on eligible
      discount: { kind: "fixed", amount: { currency: "USD", minor: "200" } },
    }),
  });
  // Cart has reg-item ($10) and expensive-unrelated ($500). Total cart = $510, but eligible is only $10 < $50.
  await assert.rejects(
    () =>
      evaluateCoupon(
        couponMin,
        { catalog: fix.catalog, prices: fix.prices },
        {
          quoteId: "q-min-fail",
          now: "2026-10-01T12:00:00Z",
          lines: [
            { productId: "reg-item", quantity: 1 },
            { productId: "expensive-unrelated", quantity: 1 },
          ],
        },
      ),
    (err) => {
      assert.ok(err instanceof CouponAdminError, `expected CouponAdminError, got ${err}`);
      assert.equal(err.code, "INVALID_INPUT");
      assert.equal(err.message, "minimum eligible merchandise spend not met");
      return true;
    },
  );
  // getCounts unchanged / no attempt capacity consumed
  const minCountsInitial = await fix.owner1.getCounts(couponMin.couponId);
  assert.deepEqual(minCountsInitial, {
    couponId: couponMin.couponId,
    cap: 10,
    capacity: 10,
    pending: 0,
    consumed: 0,
    released: 0,
    remaining: 10,
  });

  // Direct injection into reserve: canonical arithmetic-consistent quote below minimum
  const forgedBelowMinQuote = {
    quoteId: "q-forged-below-min",
    couponId: couponMin.couponId,
    ruleId: couponMin.rule.ruleId,
    ruleVersion: couponMin.rule.version,
    eligibleSubtotal: { currency: "USD", minor: "1000" },
    discount: { currency: "USD", minor: "0" },
    payableMerchandiseTotal: { currency: "USD", minor: "51000" },
    merchandiseTotal: { currency: "USD", minor: "51000" },
    lines: [
      {
        productId: "reg-item",
        quantity: 1,
        unitPrice: { currency: "USD", minor: "1000" },
        lineSubtotal: { currency: "USD", minor: "1000" },
        eligible: true,
        discount: { currency: "USD", minor: "0" },
      },
      {
        productId: "expensive-unrelated",
        quantity: 1,
        unitPrice: { currency: "USD", minor: "50000" },
        lineSubtotal: { currency: "USD", minor: "50000" },
        eligible: false,
        discount: { currency: "USD", minor: "0" },
      },
    ],
  };
  await assert.rejects(
    () =>
      fix.owner1.reserve({
        couponId: couponMin.couponId,
        attemptId: "att-stale-below-min",
        quote: forgedBelowMinQuote,
        overallPayableTotal: { currency: "USD", minor: "51000" },
        now: "2026-10-01T12:00:00Z",
      }),
    (err) => {
      assert.ok(err instanceof CouponRedemptionError, `expected CouponRedemptionError, got ${err}`);
      assert.equal(err.code, "INVALID_INPUT");
      assert.equal(err.message, "minimum eligible merchandise spend not met");
      return true;
    },
  );
  // Atomic guard check: getCounts remains unchanged, no attempt created
  assert.deepEqual(await fix.owner1.getCounts(couponMin.couponId), minCountsInitial);
  assert.equal(await fix.owner1.get(couponMin.couponId, "att-stale-below-min"), null);

  // Existing valid retry after changed minimum is still accepted:
  const couponDynamic = await fix.admin1.create({
    code: "MIN-DYNAMIC",
    globalCap: 5,
    rule: ruleFixture({
      appliesTo: "selected-products",
      selectedProductIds: ["reg-item"],
      minimumEligibleMerchandise: { currency: "USD", minor: "1000" }, // $10 minimum met by 1x reg-item ($10)
      discount: { kind: "fixed", amount: { currency: "USD", minor: "200" } },
    }),
  });
  const validDynQuote = await evaluateCoupon(
    couponDynamic,
    { catalog: fix.catalog, prices: fix.prices },
    {
      quoteId: "q-dyn-valid",
      now: "2026-10-01T12:00:00Z",
      lines: [{ productId: "reg-item", quantity: 1 }],
    },
  );
  assert.equal(validDynQuote.eligibleSubtotal.minor, "1000");
  assert.equal(validDynQuote.discount.minor, "200");
  const reservedDynAttempt = await fix.owner1.reserve({
    couponId: couponDynamic.couponId,
    attemptId: "att-dyn-1",
    quote: validDynQuote,
    overallPayableTotal: { currency: "USD", minor: "800" },
    now: "2026-10-01T12:00:00Z",
  });
  assert.equal(reservedDynAttempt.attemptId, "att-dyn-1");
  assert.equal(reservedDynAttempt.state, "pending");

  // Admin edits rule to raise minimum to $50 ($5000 minor)
  await fix.admin1.edit(couponDynamic.couponId, 1, {
    rule: ruleFixture({
      appliesTo: "selected-products",
      selectedProductIds: ["reg-item"],
      minimumEligibleMerchandise: { currency: "USD", minor: "5000" },
      discount: { kind: "fixed", amount: { currency: "USD", minor: "200" } },
    }),
  });

  // Existing valid retry of att-dyn-1 after changed minimum is still accepted
  const replayedDynAttempt = await fix.owner1.reserve({
    couponId: couponDynamic.couponId,
    attemptId: "att-dyn-1",
    quote: validDynQuote,
    overallPayableTotal: { currency: "USD", minor: "800" },
    now: "2026-10-01T12:00:00Z",
  });
  assert.equal(replayedDynAttempt.attemptId, "att-dyn-1");
  assert.equal(replayedDynAttempt.state, "pending");
  assert.equal(replayedDynAttempt.quote.ruleVersion, 1);

  // 5. Percent max / fixed 1000 - 250 = 750 / clamp
  const couponPctMax = await fix.admin1.create({
    code: "PCT-MAX",
    globalCap: 10,
    rule: ruleFixture({
      discount: {
        kind: "percentage",
        basisPoints: 5000, // 50%
        maximum: { currency: "USD", minor: "250" }, // max $2.50
      },
    }),
  });
  const quotePctMax = await evaluateCoupon(
    couponPctMax,
    { catalog: fix.catalog, prices: fix.prices },
    {
      quoteId: "q-pctmax",
      now: "2026-10-01T12:00:00Z",
      lines: [{ productId: "reg-item", quantity: 1 }], // $10.00
    },
  );
  // 50% of 1000 is 500, but clamped to maximum 250
  assert.equal(quotePctMax.discount.minor, "250");
  assert.equal(quotePctMax.payableMerchandiseTotal.minor, "750");

  // Fixed discount clamping to eligible subtotal:
  const couponClamp = await fix.admin1.create({
    code: "FIXED-CLAMP",
    globalCap: 10,
    rule: ruleFixture({
      discount: { kind: "fixed", amount: { currency: "USD", minor: "5000" } }, // $50 discount on $10 item
    }),
  });
  const quoteClamp = await evaluateCoupon(
    couponClamp,
    { catalog: fix.catalog, prices: fix.prices },
    {
      quoteId: "q-clamp",
      now: "2026-10-01T12:00:00Z",
      lines: [{ productId: "reg-item", quantity: 1 }], // $10.00
    },
  );
  assert.equal(quoteClamp.discount.minor, "1000"); // Clamped to eligible subtotal!
  assert.equal(quoteClamp.payableMerchandiseTotal.minor, "0");

  // 6. Inclusive start and exclusive end equal instant offset
  const couponBoundary = await fix.admin1.create({
    code: "BOUNDARIES",
    globalCap: 10,
    rule: ruleFixture({
      startsAt: "2026-10-01T12:00:00.000Z",
      endsAt: "2026-10-01T14:00:00.000Z",
    }),
  });
  // Exact inclusive start instant with non-zero offset: 12:00:00.000Z is 08:00:00-04:00
  const quoteAtStart = await evaluateCoupon(
    couponBoundary,
    { catalog: fix.catalog, prices: fix.prices },
    {
      quoteId: "q-start",
      now: "2026-10-01T08:00:00-04:00",
      lines: [{ productId: "reg-item", quantity: 1 }],
    },
  );
  assert.ok(quoteAtStart);

  // Exact exclusive end instant: 14:00:00.000Z is 10:00:00-04:00 -> must throw!
  await assert.rejects(
    () =>
      evaluateCoupon(
        couponBoundary,
        { catalog: fix.catalog, prices: fix.prices },
        {
          quoteId: "q-end",
          now: "2026-10-01T10:00:00-04:00",
          lines: [{ productId: "reg-item", quantity: 1 }],
        },
      ),
    (err) => err instanceof CouponAdminError && err.code === "INVALID_INPUT",
  );

  // 7. Browser unit price / total fields rejected
  await assert.rejects(
    () =>
      evaluateCoupon(
        couponBoundary,
        { catalog: fix.catalog, prices: fix.prices },
        {
          quoteId: "q-browser",
          now: "2026-10-01T12:30:00Z",
          total: "1000", // Forbidden browser total field!
          lines: [{ productId: "reg-item", quantity: 1 }],
        },
      ),
    (err) => err instanceof CouponAdminError && err.code === "INVALID_INPUT",
  );
  await assert.rejects(
    () =>
      evaluateCoupon(
        couponBoundary,
        { catalog: fix.catalog, prices: fix.prices },
        {
          quoteId: "q-browser-unit",
          now: "2026-10-01T12:30:00Z",
          lines: [{ productId: "reg-item", quantity: 1, unitPrice: "100" }], // Forbidden browser line price!
        },
      ),
    (err) => err instanceof CouponAdminError && err.code === "INVALID_INPUT",
  );

  // 8. Immutable quote
  assert.throws(() => {
    quotePctMax.discount.minor = "999";
  }, TypeError);
  assert.throws(() => {
    quotePctMax.lines[0].discount.minor = "999";
  }, TypeError);
});
