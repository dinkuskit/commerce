import { expect, test } from "@playwright/test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Kysely, SqliteDialect } from "kysely";
import { PluginStorageRepository } from "emdash";
import { createCouponAdmin, createCouponAttemptOwner } from "../../dist/features/coupons/index.js";
import { COMMERCE_PLUGIN_ID } from "../../dist/index.js";

const artifacts = process.env.COMMERCE_COUPON_BROWSER_ARTIFACTS;
const dbPath = process.env.COMMERCE_COUPON_BROWSER_DB.replace(/^file:/, "");

function storageRow(db, collection, id) {
  const row = db.prepare(
    "SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = ? AND id = ?",
  ).get(COMMERCE_PLUGIN_ID, collection, id);
  return row ? JSON.parse(row.data) : null;
}

async function seedRealAttempts(coupon) {
  const db = new Kysely({ dialect: new SqliteDialect({ database: new Database(dbPath) }) });
  const collection = new PluginStorageRepository(db, COMMERCE_PLUGIN_ID, "coupons", ["normalizedCode"]);
  const owner = createCouponAttemptOwner(collection);
  const quote = {
    quoteId: "browser-quote-1",
    couponId: coupon.couponId,
    ruleId: coupon.rule.ruleId,
    ruleVersion: coupon.rule.version,
    eligibleSubtotal: { currency: "USD", minor: "1000" },
    discount: { currency: "USD", minor: "125" },
    payableMerchandiseTotal: { currency: "USD", minor: "875" },
    lines: [{
      productId: "browser-item",
      quantity: 1,
      unitPrice: { currency: "USD", minor: "1000" },
      lineSubtotal: { currency: "USD", minor: "1000" },
      eligible: true,
      discount: { currency: "USD", minor: "125" },
    }],
  };
  const pending = await owner.reserve({
    couponId: coupon.couponId,
    attemptId: "browser-pending",
    quote,
    overallPayableTotal: { currency: "USD", minor: "875" },
    now: "2026-06-01T12:00:00Z",
  });
  const consumed = await owner.reserve({
    couponId: coupon.couponId,
    attemptId: "browser-consumed",
    quote: { ...quote, quoteId: "browser-quote-2" },
    overallPayableTotal: { currency: "USD", minor: "875" },
    now: "2026-06-01T12:00:00Z",
  });
  await owner.attachProviderSession(coupon.couponId, consumed.attemptId, "browser-provider-session");
  await owner.reconcile(coupon.couponId, consumed.attemptId, {
    kind: "verified-success",
    providerSessionId: "browser-provider-session",
  });
  const released = await owner.reserve({
    couponId: coupon.couponId,
    attemptId: "browser-released",
    quote: { ...quote, quoteId: "browser-quote-3" },
    overallPayableTotal: { currency: "USD", minor: "875" },
    now: "2026-06-01T12:00:00Z",
  });
  await owner.reconcile(coupon.couponId, released.attemptId, { kind: "verified-not-created" });
  await db.destroy();
  return { pending, consumed };
}

test("supported native coupon fixture proves real CRUD, invalid input, usage, disable, and reload", async ({ page, request }) => {
  mkdirSync(artifacts, { recursive: true });
  expect((await request.get("/_emdash/api/setup/dev-bypass")).status()).toBe(200);
  await page.goto("/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/plugins/dinkus-commerce/coupons");
  const getStarted = page.getByRole("button", { name: "Get Started" });
  await getStarted.click({ timeout: 30000 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("h1")).toHaveText("Coupons");
  await page.screenshot({ path: resolve(artifacts, "coupon-empty-before.png"), fullPage: true });

  await page.getByLabel("Code").fill("BROWSER25");
  await page.getByLabel("Percentage (0–100%, up to 2 decimals)").fill("12.5");
  await page.getByLabel("Usage limit").fill("3");
  await page.getByLabel("Starts at (ISO offset)").fill("2026-01-01T00:00:00-04:00");
  await page.getByLabel("Ends at (ISO offset, exclusive)").fill("2027-01-01T00:00:00-04:00");
  await page.getByLabel("Merchant timezone (IANA)").fill("America/New_York");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("BROWSER25 — Active")).toBeVisible();
  await page.screenshot({ path: resolve(artifacts, "coupon-created-percent.png"), fullPage: true });

  let db = new Database(dbPath);
  const couponId = db.prepare(
    "SELECT id FROM _plugin_storage WHERE plugin_id = ? AND collection = 'coupons'",
  ).get(COMMERCE_PLUGIN_ID).id;
  let coupon = storageRow(db, "coupons", couponId);
  assert.equal(coupon.rule.discount.basisPoints, 1250);
  assert.equal(coupon.rule.includeSaleItems, false);

  await page.getByRole("button", { name: /BROWSER25/ }).click();
  await page.getByLabel("Discount").selectOption("fixed");
  await expect(page.getByLabel("Discount")).toHaveValue("fixed");
  await page.getByLabel("Amount in USD").fill("2.50");
  const fixedSave = page.waitForResponse((response) =>
    response.url().endsWith("/admin/coupons/edit") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await fixedSave).status()).toBe(200);
  await expect(page.getByLabel("Amount in USD")).toHaveValue("2.50");
  db.close();
  db = new Database(dbPath);
  coupon = storageRow(db, "coupons", couponId);
  assert.deepEqual(coupon.rule.discount, { kind: "fixed", amount: { currency: "USD", minor: "250" } });

  await page.getByRole("button", { name: "Create coupon", exact: true }).click();
  await page.getByLabel("Code").fill("BROWSERUSD");
  await page.getByLabel("Discount").selectOption("fixed");
  await page.getByLabel("Amount in USD").fill("4.25");
  await page.getByLabel("Usage limit").fill("2");
  await page.getByLabel("Starts at (ISO offset)").fill("2026-01-01T00:00:00-04:00");
  await page.getByLabel("Ends at (ISO offset, exclusive)").fill("2027-01-01T00:00:00-04:00");
  await page.getByLabel("Merchant timezone (IANA)").fill("America/New_York");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("BROWSERUSD — Active")).toBeVisible();
  await page.screenshot({ path: resolve(artifacts, "coupon-created-fixed.png"), fullPage: true });
  db.close();
  db = new Database(dbPath);
  const fixedId = db.prepare(
    "SELECT id FROM _plugin_storage WHERE plugin_id = ? AND collection = 'coupons' AND json_extract(data, '$.code') = ?",
  ).get(COMMERCE_PLUGIN_ID, "BROWSERUSD").id;
  assert.deepEqual(storageRow(db, "coupons", fixedId).rule.discount, {
    kind: "fixed",
    amount: { currency: "USD", minor: "425" },
  });

  await page.getByLabel("Discount").selectOption("percentage");
  await page.getByLabel("Percentage (0–100%, up to 2 decimals)").fill("100.01");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/percentage/i);
  assert.equal(storageRow(db, "coupons", couponId).rule.discount.kind, "fixed");

  await page.getByLabel("Percentage (0–100%, up to 2 decimals)").fill("12.5");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("BROWSER25 — Active")).toBeVisible();
  coupon = storageRow(db, "coupons", couponId);
  db.close();
  await seedRealAttempts(coupon);
  const proofDb = new Database(dbPath);
  await page.reload();
  await page.getByRole("button", { name: /BROWSER25/ }).click();
  await expect(page.getByText("Consumed redemptions")).toBeVisible();
  await expect(page.getByText("Pending holds")).toBeVisible();
  await expect(page.getByText("Remaining capacity")).toBeVisible();
  await expect(page.locator('[aria-label="Coupon usage"] dd')).toHaveText(["1", "1", "1", "1"]);
  await page.locator('[aria-label="Coupon usage"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(artifacts, "coupon-usage-real-attempts.png"), fullPage: true });

  await page.getByRole("button", { name: /BROWSER25/ }).click();
  await page.getByLabel("Code").fill("BROWSER25-DRAFT");
  db.close();
  db = new Database(dbPath);
  const concurrent = storageRow(db, "coupons", couponId);
  const concurrentDb = new Kysely({ dialect: new SqliteDialect({ database: db }) });
  const admin = createCouponAdmin(new PluginStorageRepository(
    concurrentDb,
    COMMERCE_PLUGIN_ID,
    "coupons",
    ["normalizedCode"],
  ));
  await admin.edit(couponId, concurrent.revision, { ...concurrent, code: "BROWSER25-CONCURRENT" });
  await concurrentDb.destroy();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/revision/i);
  await page.route("**/admin/coupons/list", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "temporary reload failure" }) });
  }, { times: 1 });
  await page.getByRole("button", { name: "Reload current and keep draft" }).click();
  await expect(page.getByRole("alert")).toHaveText("Could not load coupons: Service Unavailable");
  await page.getByRole("button", { name: "Reload current and keep draft" }).click();
  await expect(page.getByLabel("Code")).toHaveValue("BROWSER25-DRAFT");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("BROWSER25-DRAFT — Active")).toBeVisible();
  db.close();
  db = new Database(dbPath);
  coupon = storageRow(db, "coupons", couponId);
  assert.equal(coupon.code, "BROWSER25-DRAFT");
  db.close();
  db = new Database(dbPath);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Disable" }).click();
  await expect(page.getByText("BROWSER25-DRAFT — Disabled")).toBeVisible();
  coupon = storageRow(proofDb, "coupons", couponId);
  db.close();
  assert.equal(coupon.disabled, true);
  assert.equal(coupon.attempts.length, 3);
  writeFileSync(resolve(artifacts, "coupon-storage-evidence.json"), JSON.stringify({
    pluginId: COMMERCE_PLUGIN_ID,
    collection: "coupons",
    couponId,
    disabled: coupon.disabled,
    attemptStates: coupon.attempts.map((attempt) => ({
      attemptId: attempt.attemptId,
      state: attempt.state,
      providerSessionId: attempt.providerSessionId ?? null,
    })),
  }, null, 2) + "\n");
  await page.screenshot({ path: resolve(artifacts, "coupon-disabled-persisted.png"), fullPage: true });
  await page.locator('[aria-label="Coupon usage"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(artifacts, "coupon-final-after.png"), fullPage: true });
  await page.reload();
  await expect(page.getByText("BROWSER25-DRAFT — Disabled")).toBeVisible();
  proofDb.close();
});
