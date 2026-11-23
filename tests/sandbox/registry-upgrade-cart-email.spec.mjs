import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Run by scripts/registry-upgrade-proof.mjs with COMMERCE_UPGRADE_FROM=v0.8.0 and
// COMMERCE_UPGRADE_SPEC=registry-upgrade-cart-email.spec.mjs (commerce-abandoned-cart-email-20261122,
// store-emails-plugin-20261122). "old": Commerce 0.8.0 keeps a shopper's cart key, that cart's unpaid checkout, a
// paid order and a saved catalog setting, in 0.8.0's own shapes. "bridge" and "new": this build on 0.8.0's EmDash,
// then on this checkout's EmDash, leaves every row as it was, still answers the old cart key, lets that key stop
// nothing, shows no cart email setting (it lives in Store emails) beside the kept catalog choice, and its 5-minute
// check sends no email and notes no old cart as left, so no old order or cart becomes courier news.
const phase = process.env.COMMERCE_UPGRADE_PHASE;
const CART = "/_emdash/api/plugins/dinkus-commerce/checkout/guest/cart";
const COLLECTIONS = ["checkout_carts", "checkout_guest_capabilities", "orders", "storefront_out_of_stock_listing"];
const snapshotFile = () => resolve(process.env.COMMERCE_PROOF_ARTIFACTS, "cart-email-before-upgrade.json");
const traceFile = () => resolve(process.env.COMMERCE_PROOF_ARTIFACTS, "cart-email-upgrade-" + phase + ".json");
const origin = () => "http://127.0.0.1:" + (process.env.COMMERCE_PROOF_PORT ?? 64561);
const SECRET = "c".repeat(64);
const KEY = "cap-upgrade." + SECRET;
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

// 0.8.0's rows: a cart key, its cart's one checkout (expired unpaid, as 0.8.0's release leaves it, with no cart
// lines, cart expiry or reminder fields), and the catalog setting saved with Hide out-of-stock on.
const legacyRows = () => ({
  checkout_guest_capabilities: { "cap-upgrade": { recordKind: "guest-checkout-capability", capabilityId: "cap-upgrade",
    cartId: "cart-upgrade", verifier: sha256(SECRET), siteBinding: origin(), createdAt: "2026-11-01T15:00:00.000Z" } },
  checkout_carts: { "cart-upgrade": { attempts: [{ attemptId: "attempt-upgrade", cart: [{ catalogItemId: "item-hat", quantity: 1 }],
    contactSnapshot: { schema: "dinkuskit.commerce.checkout-contact/v1", requirePhoneNumber: false, revision: null,
      contact: { email: "pat@example.test", delivery: { name: "Pat Shopper", line1: "1 Upgrade Way", city: "Springfield", region: "IL", postalCode: "62701", country: "US" } } },
    payment: { attemptId: "attempt-upgrade", bindingRef: "stripe-upgrade-binding",
      lines: [{ catalogItemId: "item-hat", quantity: 1, name: "Red hat", unitPrice: { currency: "USD", minor: "1200" } }],
      total: { currency: "USD", minor: "1200" }, paymentWindow: { minSeconds: 1800, maxSeconds: 1860 }, paymentMethods: ["card"] },
    phase: "released", session: { sessionId: "cs_upgrade", redirectUrl: "https://checkout.stripe.com/c/pay/cs_upgrade", createdAt: 1_793_000_000, expiresAt: 1_793_001_800 },
    paymentReleaseReason: "expired-unpaid" }] } },
  orders: { "order-upgrade": { paidOrder: { schema: "dinkuskit.commerce.paid-order/v1", orderId: "order-upgrade", receiptId: "receipt-upgrade",
    attemptId: "attempt-paid", paymentId: "pi_upgrade", paidAt: "2026-11-01T14:00:00.000Z", mode: "test",
    lines: [{ catalogItemId: "item-hat", quantity: 1, name: "Red hat", unitPrice: { currency: "USD", minor: "1200" } }], total: { currency: "USD", minor: "1200" },
    contactSnapshot: { schema: "dinkuskit.commerce.checkout-contact/v1", requirePhoneNumber: false, revision: null,
      contact: { email: "kim@example.test", delivery: { name: "Kim Buyer", line1: "2 Upgrade Way", city: "Springfield", region: "IL", postalCode: "62701", country: "US" } } } },
    emailKey: "kim@example.test", number: 1001, revision: 1 } },
  storefront_out_of_stock_listing: { active: { recordKind: "storefront-out-of-stock-listing", recordId: "active", hideOutOfStock: true, updatedAt: "2026-11-01T15:00:00.000Z" } },
});

const open = () => new Database(process.env.COMMERCE_PROOF_DB.slice(5));
const rawRows = (database, collections) => database.prepare(
  "SELECT collection, id, data FROM _plugin_storage WHERE plugin_id = ? AND collection IN (" + collections.map(() => "?").join(",") + ") ORDER BY collection, id",
).all("dinkus-commerce", ...collections);
const stops = (database) => database.prepare("SELECT count(*) AS n FROM _plugin_storage WHERE plugin_id = ? AND collection = 'cart_email_stops'").get("dinkus-commerce").n;

async function start(request) {
  expect((await request.get("/_emdash/api/setup/dev-bypass")).status()).toBe(200);
  // Any public read makes the host load Commerce, which creates its storage indexes.
  expect((await request.get("/_emdash/api/plugins/dinkus-commerce/catalog/public")).ok()).toBe(true);
}
async function cart(request, data, key = KEY) {
  const response = await request.post(CART, { data, headers: { origin: origin(), "sec-fetch-site": "same-origin", "x-commerce-guest-capability": key } });
  return { status: response.status(), ...(await response.json()).data };
}
const summary = (answer) => answer.ok
  ? { ok: true, state: answer.checkout.state, lines: answer.cart.lines }
  : { ok: false, code: answer.error.code };

test("Commerce 0.8.0 keeps a cart key, its unpaid checkout and a catalog setting", async ({ request }) => {
  test.skip(phase !== "old");
  await start(request);
  const database = open();
  const columns = database.prepare("PRAGMA table_info(_plugin_storage)").all().map((column) => column.name);
  const now = new Date().toISOString();
  for (const [collection, rows] of Object.entries(legacyRows())) {
    for (const [id, record] of Object.entries(rows)) {
      const row = { plugin_id: "dinkus-commerce", collection, id, data: JSON.stringify(record), created_at: now, updated_at: now,
        ...(columns.includes("revision") ? { revision: crypto.randomUUID() } : {}) };
      const keys = Object.keys(row).filter((key) => columns.includes(key));
      database.prepare("INSERT INTO _plugin_storage (" + keys.join(",") + ") VALUES (" + keys.map(() => "?").join(",") + ")").run(...keys.map((key) => row[key]));
    }
  }
  const snapshot = { from: process.env.COMMERCE_UPGRADE_FROM, rows: rawRows(database, COLLECTIONS) };
  expect(snapshot.rows).toHaveLength(4);
  writeFileSync(snapshotFile(), JSON.stringify(snapshot, null, 2));
  database.close();
});

for (const step of ["bridge", "new"]) {
  test("this build on " + (step === "bridge" ? "0.8.0's" : "this checkout's") + " EmDash keeps the 0.8.0 cart and setting as they were", async ({ page, request }) => {
    test.skip(phase !== step);
    const before = JSON.parse(readFileSync(snapshotFile(), "utf8"));
    await start(request);
    const database = open();
    const trace = [];
    const ask = async (label, data, key) => {
      const answer = summary(await cart(request, data, key));
      trace.push({ label, ...answer });
      return answer;
    };
    // 1. Loading this build rewrites nothing 0.8.0 kept.
    expect(rawRows(database, COLLECTIONS)).toEqual(before.rows);
    // 2. The 0.8.0 cart key still opens its cart: the released checkout can be tried again, and the cart has no
    //    saved lines because 0.8.0 kept none.
    expect(await ask("0.8.0 key reads its cart", {})).toEqual({ ok: true, state: "released-retry", lines: [] });
    // 3. That key was never in a cart email, so it stops nothing; a made-up key is refused.
    expect(await ask("0.8.0 key asks to stop emails", { stop: true })).toEqual({ ok: false, code: "CHECKOUT_NOT_FOUND" });
    expect(await ask("made-up key", {}, "cap-upgrade." + "0".repeat(64))).toEqual({ ok: false, code: "CAPABILITY_DENIED" });
    expect(stops(database)).toBe(0);
    expect(rawRows(database, COLLECTIONS)).toEqual(before.rows);
    if (step === "new") {
      // 4. The kept Hide out-of-stock choice shows, and there is no cart email setting: it lives in Store emails.
      await page.goto("/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/plugins/dinkus-commerce/settings");
      const welcome = page.getByRole("button", { name: "Get Started" });
      await welcome.or(page.getByRole("heading", { name: "Commerce settings" })).first().waitFor({ state: "visible", timeout: 90000 });
      if (await welcome.isVisible()) await welcome.click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("switch", { name: "Hide out-of-stock products" })).toBeChecked();
      await expect(page.getByRole("radio", { name: "Shoppers who ticked the box" })).toHaveCount(0);
      await expect(page.getByText("Abandoned cart email")).toHaveCount(0);
      await page.waitForTimeout(500);
      await page.screenshot({ path: resolve(process.env.COMMERCE_PROOF_ARTIFACTS, "new-cart-email-settings.png"), fullPage: true });
      // 5. The 5-minute check runs on the upgraded store, sends no email, and notes no 0.8.0 cart as left (it has no
      //    reminder time); no row changes, so the 0.8.0 order gets no paid-news key and is never order.paid news.
      const force = () => database.prepare("UPDATE _emdash_cron_tasks SET next_run_at = '2000-01-01T00:00:00.000Z' WHERE plugin_id = ? AND task_name = 'commerce-checkout-wakes' AND status = 'idle'").run("dinkus-commerce");
      const ran = () => database.prepare("SELECT last_run_at FROM _emdash_cron_tasks WHERE plugin_id = ? AND task_name = 'commerce-checkout-wakes'").get("dinkus-commerce")?.last_run_at ?? null;
      const forcedAt = new Date().toISOString();
      force();
      await expect.poll(() => { const last = ran(); if (!(last > forcedAt)) force(); return last > forcedAt; }, { timeout: 180000, intervals: [5000] }).toBe(true);
      const mail = (await (await page.request.get("/_emdash/api/dev/emails")).json()).data.items;
      trace.push({ label: "5-minute check ran", lastRunAt: ran(), emails: mail.length });
      expect(mail).toHaveLength(0);
      expect(rawRows(database, COLLECTIONS)).toEqual(before.rows);
      const indexes = ["checkout_carts%remindAt", "checkout_carts%leftKey", "orders%paidKey"].map((like) =>
        database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE ?").get("%" + like + "%")?.name ?? null);
      trace.push({ label: "courier news indexes", indexes });
      expect(indexes.every(Boolean)).toBe(true);
    }
    writeFileSync(traceFile(), JSON.stringify({ phase, trace }, null, 2));
    database.close();
  });
}
