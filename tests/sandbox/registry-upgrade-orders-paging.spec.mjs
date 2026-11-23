import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Run by scripts/registry-upgrade-proof.mjs with COMMERCE_UPGRADE_FROM=v0.8.0 and
// COMMERCE_UPGRADE_SPEC=registry-upgrade-orders-paging.spec.mjs (deepsec G1-02: Orders reads a page at a time).
// "old": orders as Commerce 0.8.0 keeps them, none with paidKey: 30 numbered, one of them Completed, and 26 kept
// before numbering existed. "bridge": this build on 0.8.0's EmDash lists them through the orders route and rewrites
// nothing. "new": this build on this checkout's EmDash opens the Orders page, which numbers the 26 oldest payment
// first across every page (not page by page), keeps every 0.8.0 number and checkout copy, and shows 25 orders.
const phase = process.env.COMMERCE_UPGRADE_PHASE;
const ID = "dinkus-commerce";
const ORDERS = `/_emdash/api/plugins/${ID}/orders`;
const headers = { "X-EmDash-Request": "1" };
const artifact = (name) => resolve(process.env.COMMERCE_PROOF_ARTIFACTS, name);
const snapshotFile = () => artifact("orders-paging-before-upgrade.json");
const usd = (minor) => ({ currency: "USD", minor });
const name = (prefix, i) => prefix + String(i).padStart(2, "0");
const paidOrder = (orderId, paidAt) => ({
  schema: "dinkuskit.commerce.paid-order/v1", orderId, receiptId: "rcpt-" + orderId, attemptId: "attempt-" + orderId,
  paymentId: "pi_" + orderId, paidAt, mode: "test",
  lines: [{ catalogItemId: "item-mug", quantity: 1, name: "Mug", unitPrice: usd("1200") }], total: usd("1200"),
  contactSnapshot: { schema: "dinkuskit.commerce.checkout-contact/v1", requirePhoneNumber: false, revision: null,
    contact: { email: "shopper@buyer.test", delivery: { name: "Upgrade Shopper", line1: "1 Upgrade Way", city: "Springfield", region: "IL", postalCode: "62701", country: "US" } } },
});
// Kept before numbering: ids and payment dates rise together (September). Numbered by 0.8.0: October.
const ROWS = {
  ...Object.fromEntries(Array.from({ length: 26 }, (_, k) => {
    const id = name("ord-early-", k + 1);
    return [id, { paidOrder: paidOrder(id, new Date(Date.UTC(2026, 8, k + 1)).toISOString()), revision: 1 }];
  })),
  ...Object.fromEntries(Array.from({ length: 30 }, (_, k) => {
    const id = name("ord-numbered-", k + 1);
    return [id, { paidOrder: paidOrder(id, new Date(Date.UTC(2026, 9, k + 1)).toISOString()), emailKey: "shopper@buyer.test", number: 1001 + k, revision: 1,
      ...(k === 6 ? { revision: 2, completed: { at: "2026-11-10T12:00:00.000Z", carrier: "USPS", tracking: "9400100000000000000001" } } : {}) }];
  })),
};

const open = () => new Database(process.env.COMMERCE_PROOF_DB.slice(5));
const rows = (database, collection) => Object.fromEntries(database.prepare("SELECT id, data FROM _plugin_storage WHERE plugin_id = ? AND collection = ? ORDER BY id")
  .all(ID, collection).map((row) => [row.id, JSON.parse(row.data)]));
const insert = (database, collection, id, record) => {
  const columns = database.prepare("PRAGMA table_info(_plugin_storage)").all().map((column) => column.name);
  const now = new Date().toISOString();
  const row = { plugin_id: ID, collection, id, data: JSON.stringify(record), created_at: now, updated_at: now,
    ...(columns.includes("revision") ? { revision: crypto.randomUUID() } : {}) };
  const keys = Object.keys(row).filter((key) => columns.includes(key));
  database.prepare("INSERT INTO _plugin_storage (" + keys.join(",") + ") VALUES (" + keys.map(() => "?").join(",") + ")").run(...keys.map((key) => row[key]));
};

async function signIn(page, request) {
  expect((await request.get("/_emdash/api/setup/dev-bypass")).status()).toBe(200);
  // Any public read makes the host load Commerce, which creates its storage indexes.
  expect((await request.get(`/_emdash/api/plugins/${ID}/catalog/public`)).ok()).toBe(true);
  await page.goto("/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin");
}
const list = async (page, data) => {
  const answer = await page.request.post(ORDERS, { data: { action: "list", ...data }, headers });
  expect(answer.ok(), await answer.text()).toBe(true);
  return (await answer.json()).data;
};

test("Commerce 0.8.0 keeps 56 orders, 26 of them from before numbering", async ({ request }) => {
  test.skip(phase !== "old");
  expect((await request.get("/_emdash/api/setup/dev-bypass")).status()).toBe(200);
  expect((await request.get(`/_emdash/api/plugins/${ID}/catalog/public`)).ok()).toBe(true);
  const database = open();
  for (const [id, record] of Object.entries(ROWS)) insert(database, "orders", id, record);
  insert(database, "order_numbers", "next", { next: 1031 });
  const before = rows(database, "orders");
  expect(Object.keys(before)).toHaveLength(56);
  expect(Object.values(before).filter((record) => record.paidKey !== undefined)).toHaveLength(0);
  writeFileSync(snapshotFile(), JSON.stringify({ from: process.env.COMMERCE_UPGRADE_FROM, before }, null, 2));
  database.close();
});

test("this build on 0.8.0's EmDash lists all 56 through the orders route and rewrites nothing", async ({ page, request }) => {
  test.skip(phase !== "bridge");
  const { before } = JSON.parse(readFileSync(snapshotFile(), "utf8"));
  await signIn(page, request);
  const database = open();
  const first = await list(page, {}), second = await list(page, { offset: 50 });
  expect(first.total).toBe(56);
  expect([...first.orders, ...second.orders].map((order) => order.orderId).sort()).toEqual(Object.keys(before).sort());
  expect((await list(page, { status: "processing" })).total).toBe(56);
  expect(rows(database, "orders")).toEqual(before);
  writeFileSync(artifact("orders-paging-upgrade-bridge.json"), JSON.stringify({ phase, total: first.total, first: first.orders.slice(0, 3).map((order) => order.orderId) }, null, 2));
  database.close();
});

test("after the EmDash upgrade the Orders page numbers the 26 oldest payment first across pages and keeps 0.8.0's orders", async ({ page, request }) => {
  test.skip(phase !== "new");
  const { before } = JSON.parse(readFileSync(snapshotFile(), "utf8"));
  await signIn(page, request);
  const database = open();
  // 1. The owner opens Orders.
  await page.goto(`/_emdash/admin/plugins/${ID}/orders`);
  const welcome = page.getByRole("button", { name: "Get Started", exact: true });
  const rowsShown = page.getByRole("button", { name: /^Inspect / });
  await expect(welcome.or(rowsShown.first())).toBeVisible({ timeout: 60000 });
  if (await welcome.isVisible()) { await welcome.click(); await page.goto(`/_emdash/admin/plugins/${ID}/orders`); }
  await expect(rowsShown.first()).toBeVisible({ timeout: 60000 });
  await expect(page.getByText("Orders unavailable")).toHaveCount(0);
  await expect(rowsShown).toHaveCount(25);
  // 2. The 26 orders from before numbering got 1031 to 1056 by payment date, ord-early-01 (on page 2) first;
  //    every 0.8.0 number, completion and checkout copy is as it was.
  const after = rows(database, "orders");
  expect(Array.from({ length: 26 }, (_, k) => after[name("ord-early-", k + 1)].number)).toEqual(Array.from({ length: 26 }, (_, k) => 1031 + k));
  for (const [id, record] of Object.entries(before)) {
    expect(after[id].paidOrder).toEqual(record.paidOrder);
    if (record.number !== undefined) expect(after[id]).toEqual(record);
  }
  expect(rows(database, "order_numbers").next).toEqual({ next: 1057 });
  const shown = await rowsShown.allTextContents();
  await page.screenshot({ path: artifact("orders-paging-upgrade-new.png"), fullPage: true, animations: "disabled" });
  // 3. Opening the order left for page 2 shows its new number; the route still lists all 56.
  const early = await page.request.post(ORDERS, { data: { action: "show", orderId: "ord-early-01" }, headers });
  expect((await early.json()).data.order.number).toBe(1031);
  expect((await list(page, {})).total).toBe(56);
  expect((await list(page, { status: "completed" })).total).toBe(0);
  // 4. Loading this build made the paidKey index the page reads through.
  const indexes = database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = '_plugin_storage'").all()
    .map((index) => index.name).filter((index) => index.includes(ID) && index.includes("orders") && index.includes("paidKey"));
  expect(indexes.length).toBeGreaterThan(0);
  const evidence = { phase, indexes, shown, numbered: Object.fromEntries(Array.from({ length: 26 }, (_, k) => [name("ord-early-", k + 1), after[name("ord-early-", k + 1)].number])) };
  writeFileSync(artifact("orders-paging-upgrade-new.json"), JSON.stringify(evidence, null, 2));
  console.log("orders paging upgrade proof", JSON.stringify({ from: process.env.COMMERCE_UPGRADE_FROM, indexes, firstShown: shown.slice(0, 3), numbered: [evidence.numbered["ord-early-01"], evidence.numbered["ord-early-26"]] }));
  database.close();
});
