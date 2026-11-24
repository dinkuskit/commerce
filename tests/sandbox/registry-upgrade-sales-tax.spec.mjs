import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Run by scripts/registry-upgrade-proof.mjs with COMMERCE_UPGRADE_FROM=v0.8.0 and
// COMMERCE_UPGRADE_SPEC=registry-upgrade-sales-tax.spec.mjs (dinkuskit/tax ledger tax-picks-rate-commerce-does-math).
// "old": Commerce 0.8.0 keeps a shopper's cart key, that cart's checkout with its frozen pricing, a paid order with
// its pricing, and a saved setting, all in 0.8.0's own untaxed shapes. "bridge" and "new": this build, on 0.8.0's
// EmDash and then on this checkout's, rewrites none of them; the old checkout still opens and reads as $0.00 tax;
// the order lookup answers the old order with no tax at all; and Orders shows the old order with no Sales tax row.
// A taxed checkout on this build is proved through the add-ons door in workerd (registry-checkout-services).
const phase = process.env.COMMERCE_UPGRADE_PHASE;
const CART = "/_emdash/api/plugins/dinkus-commerce/checkout/guest/cart";
const LOOKUP = "/_emdash/api/plugins/dinkus-commerce/orders/lookup";
const COLLECTIONS = ["checkout_carts", "checkout_guest_capabilities", "orders", "order_numbers", "storefront_out_of_stock_listing"];
const snapshotFile = () => resolve(process.env.COMMERCE_PROOF_ARTIFACTS, "sales-tax-before-upgrade.json");
const traceFile = () => resolve(process.env.COMMERCE_PROOF_ARTIFACTS, "sales-tax-upgrade-" + phase + ".json");
const origin = () => "http://127.0.0.1:" + (process.env.COMMERCE_PROOF_PORT ?? 64561);
const SECRET = "d".repeat(64);
const KEY = "cap-tax-upgrade." + SECRET;
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const usd = (minor) => ({ currency: "USD", minor });

// 0.8.0's checkout-pricing/v1 snapshot: $12.00 hat, $2.00 off, $5.00 flat shipping, $15.00 total, and no tax key.
const pricing = () => ({ schema: "dinkuskit.commerce.checkout-pricing/v1", merchandiseSubtotal: usd("1200"), couponDiscount: usd("200"),
  netMerchandise: usd("1000"), shipping: { configurationId: "ship-upgrade", revision: 1, mode: "flat", charge: usd("500") }, finalTotal: usd("1500"),
  lines: [{ catalogItemId: "item-hat", quantity: 1, unitPrice: usd("1200"), lineSubtotal: usd("1200"), discount: usd("200"), netAmount: usd("1000") }] });
const contact = (email, name) => ({ schema: "dinkuskit.commerce.checkout-contact/v1", requirePhoneNumber: false, revision: null,
  contact: { email, delivery: { name, line1: "1 Upgrade Way", city: "Nashville", region: "TN", postalCode: "37201", country: "US" } } });
const hat = [{ catalogItemId: "item-hat", quantity: 1, name: "Red hat", unitPrice: usd("1200") }];
const legacyRows = () => ({
  checkout_guest_capabilities: { "cap-tax-upgrade": { recordKind: "guest-checkout-capability", capabilityId: "cap-tax-upgrade",
    cartId: "cart-tax-upgrade", verifier: sha256(SECRET), siteBinding: origin(), createdAt: "2026-11-01T15:00:00.000Z" } },
  checkout_carts: { "cart-tax-upgrade": { attempts: [{ attemptId: "attempt-tax-upgrade", cart: [{ catalogItemId: "item-hat", quantity: 1 }],
    contactSnapshot: contact("pat@example.test", "Pat Shopper"),
    payment: { attemptId: "attempt-tax-upgrade", bindingRef: "stripe-upgrade-binding", lines: hat, total: usd("1500"), pricing: pricing(),
      paymentWindow: { minSeconds: 1800, maxSeconds: 1860 }, paymentMethods: ["card"] },
    phase: "released", session: { sessionId: "cs_tax_upgrade", redirectUrl: "https://checkout.stripe.com/c/pay/cs_tax_upgrade", createdAt: 1_793_000_000, expiresAt: 1_793_001_800 },
    paymentReleaseReason: "expired-unpaid" }] } },
  orders: { "order-tax-upgrade": { paidOrder: { schema: "dinkuskit.commerce.paid-order/v1", orderId: "order-tax-upgrade", receiptId: "receipt-tax-upgrade",
    attemptId: "attempt-tax-paid", paymentId: "pi_tax_upgrade", paidAt: "2026-11-01T14:00:00.000Z", mode: "test", lines: hat, total: usd("1500"),
    pricing: pricing(), contactSnapshot: contact("kim@example.test", "Kim Buyer") }, emailKey: "kim@example.test", number: 1001, revision: 1 } },
  order_numbers: { next: { next: 1002 } },
  storefront_out_of_stock_listing: { active: { recordKind: "storefront-out-of-stock-listing", recordId: "active", hideOutOfStock: true, updatedAt: "2026-11-01T15:00:00.000Z" } },
});

const open = () => new Database(process.env.COMMERCE_PROOF_DB.slice(5));
const rawRows = (database) => database.prepare(
  "SELECT collection, id, data FROM _plugin_storage WHERE plugin_id = ? AND collection IN (" + COLLECTIONS.map(() => "?").join(",") + ") ORDER BY collection, id",
).all("dinkus-commerce", ...COLLECTIONS);

async function start(request) {
  expect((await request.get("/_emdash/api/setup/dev-bypass")).status()).toBe(200);
  // Any public read makes the host load Commerce, which creates its storage indexes.
  expect((await request.get("/_emdash/api/plugins/dinkus-commerce/catalog/public")).ok()).toBe(true);
}
const headers = (key) => ({ origin: origin(), "sec-fetch-site": "same-origin", ...(key ? { "x-commerce-guest-capability": key } : {}) });

test("Commerce 0.8.0 keeps an untaxed checkout, an untaxed paid order and a setting", async ({ request }) => {
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
  const snapshot = { from: process.env.COMMERCE_UPGRADE_FROM, rows: rawRows(database) };
  expect(snapshot.rows).toHaveLength(5);
  writeFileSync(snapshotFile(), JSON.stringify(snapshot, null, 2));
  database.close();
});

for (const step of ["bridge", "new"]) {
  test("this build on " + (step === "bridge" ? "0.8.0's" : "this checkout's") + " EmDash reads the untaxed 0.8.0 checkout and order unchanged", async ({ page, request }) => {
    test.skip(phase !== step);
    const before = JSON.parse(readFileSync(snapshotFile(), "utf8"));
    await start(request);
    const database = open();
    const trace = [];
    // 1. Loading this build rewrites nothing 0.8.0 kept.
    expect(rawRows(database)).toEqual(before.rows);
    // 2. The 0.8.0 checkout still opens with its frozen prices, and its tax reads as $0.00.
    const cart = await (await request.post(CART, { data: {}, headers: headers(KEY) })).json();
    expect(cart.data.ok).toBe(true);
    trace.push({ label: "0.8.0 checkout", state: cart.data.checkout.state, pricing: cart.data.checkout.pricing ?? null });
    expect(cart.data.checkout.state).toBe("released-retry");
    if (cart.data.checkout.pricing) {
      expect(cart.data.checkout.pricing).toMatchObject({ couponDiscount: usd("200"), tax: usd("0"), finalTotal: usd("1500") });
    }
    // 3. The order lookup answers the 0.8.0 order with its pricing and no tax at all.
    const lookup = await (await request.post(LOOKUP, { data: { orderNumber: "1001", email: "kim@example.test" }, headers: headers() })).json();
    expect(lookup.data.ok).toBe(true);
    trace.push({ label: "0.8.0 order lookup", pricing: lookup.data.order.pricing });
    expect(lookup.data.order.pricing).toEqual({ merchandiseSubtotal: usd("1200"), couponDiscount: usd("200"), netMerchandise: usd("1000"),
      shipping: { mode: "flat", charge: usd("500") }, finalTotal: usd("1500") });
    expect(rawRows(database)).toEqual(before.rows);
    if (step === "new") {
      // 4. Orders shows the 0.8.0 order's discount, shipping and total, and no Sales tax row.
      const path = "/_emdash/admin/plugins/dinkus-commerce/orders";
      await page.goto("/_emdash/api/auth/dev-bypass?redirect=" + path);
      const welcome = page.getByRole("button", { name: "Get Started", exact: true });
      const inspect = page.getByRole("button", { name: "Inspect #1001 (TEST)", exact: true });
      await expect(welcome.or(inspect)).toBeVisible({ timeout: 90000 });
      if (await welcome.isVisible()) { await welcome.click(); await page.goto(path); }
      await expect(inspect).toBeVisible({ timeout: 60000 });
      await inspect.focus(); await page.keyboard.press("Enter");
      const total = page.getByRole("cell", { name: "Order total", exact: true });
      await expect(total).toBeVisible();
      const rows = await total.evaluate(cell => [...cell.closest("tbody").children].map(row => [...row.children].map(c => c.innerText)));
      trace.push({ label: "0.8.0 order in Orders", rows });
      expect(rows.some(([label]) => label === "Sales tax")).toBe(false);
      expect(rows.at(-1)).toEqual(["Order total", "$15.00"]);
      await page.screenshot({ path: resolve(process.env.COMMERCE_PROOF_ARTIFACTS, "new-untaxed-order.png"), fullPage: true });
      expect(rawRows(database)).toEqual(before.rows);
    }
    writeFileSync(traceFile(), JSON.stringify({ phase, trace }, null, 2));
    database.close();
  });
}
