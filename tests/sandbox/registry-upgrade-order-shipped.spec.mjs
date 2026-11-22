import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Run by scripts/registry-upgrade-proof.mjs with COMMERCE_UPGRADE_FROM=v0.8.0 and
// COMMERCE_UPGRADE_SPEC=registry-upgrade-order-shipped.spec.mjs (order-shipped-outbox-20261122). "old": Commerce
// 0.8.0's Registry build keeps two paid orders, one already Completed. "bridge": this build on that release's EmDash
// refuses an outsider's and the administrator's courier requests over HTTP, and the owner completes the other order.
// "new": this build on this checkout's EmDash keeps both orders as they were, has the shippedKey index, refuses the
// same requests, and gives the store's courier only the order Completed after the upgrade.
const phase = process.env.COMMERCE_UPGRADE_PHASE;
const OUTBOX = "/_emdash/api/plugins/dinkus-commerce/courier/outbox";
const ORDERS = "/_emdash/api/plugins/dinkus-commerce/orders";
const COURIER_ASK = { courier: 1, op: "since", topic: "order.shipped", after: null, limit: 50 };
const headers = { "X-EmDash-Request": "1" };
const artifact = (name) => resolve(process.env.COMMERCE_PROOF_ARTIFACTS, name);
const snapshotFile = () => artifact("order-shipped-before-upgrade.json");

const usd = (minor) => ({ currency: "USD", minor });
const paidOrder = (orderId, email, name, line) => ({
  schema: "dinkuskit.commerce.paid-order/v1", orderId, receiptId: "rcpt-" + orderId, attemptId: "attempt-" + orderId,
  paymentId: "pi_" + orderId, paidAt: "2026-11-01T15:00:00.000Z", mode: "test",
  lines: [{ catalogItemId: line[0], quantity: 1, name: line[1], unitPrice: usd("1200") }], total: usd("1200"),
  contactSnapshot: { schema: "dinkuskit.commerce.checkout-contact/v1", requirePhoneNumber: false, revision: null,
    contact: { email, delivery: { name, line1: "1 Upgrade Way", city: "Springfield", region: "IL", postalCode: "62701", country: "US" } } },
});
// Rows as 0.8.0 keeps them: Cy's order was marked Completed under 0.8.0, Ana's is still Processing.
const ORDER_ROWS = {
  "ord-cy": { paidOrder: paidOrder("ord-cy", "cy@buyer.test", "Cy Buyer", ["item-mug", "Mug"]), emailKey: "cy@buyer.test", number: 1001, revision: 2,
    completed: { at: "2026-11-10T12:00:00.000Z", carrier: "USPS", tracking: "9400100000000000000001" } },
  "ord-ana": { paidOrder: paidOrder("ord-ana", "ana@buyer.test", "Ana Buyer", ["item-hat", "Red hat"]), emailKey: "ana@buyer.test", number: 1002, revision: 1 },
};

const open = () => new Database(process.env.COMMERCE_PROOF_DB.slice(5));
const orderRows = (database) => database.prepare("SELECT id, data FROM _plugin_storage WHERE plugin_id = ? AND collection = 'orders' ORDER BY id")
  .all("dinkus-commerce").map((row) => ({ id: row.id, ...JSON.parse(row.data) }));

async function signIn(page, request) {
  expect((await request.get("/_emdash/api/setup/dev-bypass")).status()).toBe(200);
  // Any public read makes the host load Commerce, which creates its storage indexes.
  expect((await request.get("/_emdash/api/plugins/dinkus-commerce/catalog/public")).ok()).toBe(true);
  await page.goto("/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin");
}

/**
 * The courier's own request, sent from outside the store with nobody signed in and then by the signed-in
 * administrator. Both are refused before any buyer detail leaves the store.
 */
async function refusals(page, playwright, baseURL) {
  const outsider = await playwright.request.newContext({ baseURL });
  try {
    const anonymous = await outsider.post(OUTBOX, { data: COURIER_ASK, headers: { ...headers, origin: new URL(baseURL).origin } });
    const anonymousBody = await anonymous.text();
    const admin = await page.request.post(OUTBOX, { data: COURIER_ASK, headers });
    const adminBody = await admin.text();
    const trace = { anonymous: { status: anonymous.status(), body: anonymousBody }, admin: { status: admin.status(), body: adminBody } };
    expect(anonymous.ok(), anonymousBody).toBe(false);
    expect([401, 403]).toContain(anonymous.status());
    expect(admin.ok(), adminBody).toBe(false);
    expect(adminBody).toContain("COURIER_ONLY");
    for (const body of [anonymousBody, adminBody]) expect(body).not.toMatch(/@buyer\.test|Ana Buyer|Cy Buyer/);
    return trace;
  } finally {
    await outsider.dispose();
  }
}

test("Commerce 0.8.0 keeps a Completed order and a Processing one", async ({ request }) => {
  test.skip(phase !== "old");
  expect((await request.get("/_emdash/api/setup/dev-bypass")).status()).toBe(200);
  expect((await request.get("/_emdash/api/plugins/dinkus-commerce/catalog/public")).ok()).toBe(true);
  const database = open();
  const columns = database.prepare("PRAGMA table_info(_plugin_storage)").all().map((column) => column.name);
  const now = new Date().toISOString();
  for (const [id, record] of Object.entries(ORDER_ROWS)) {
    const row = { plugin_id: "dinkus-commerce", collection: "orders", id, data: JSON.stringify(record), created_at: now, updated_at: now,
      ...(columns.includes("revision") ? { revision: crypto.randomUUID() } : {}) };
    const keys = Object.keys(row).filter((key) => columns.includes(key));
    database.prepare("INSERT INTO _plugin_storage (" + keys.join(",") + ") VALUES (" + keys.map(() => "?").join(",") + ")").run(...keys.map((key) => row[key]));
  }
  const before = orderRows(database);
  expect(before.map((row) => [row.id, row.completed?.at ?? null, row.shippedKey ?? null])).toEqual([["ord-ana", null, null], ["ord-cy", "2026-11-10T12:00:00.000Z", null]]);
  // 0.8.0 has no courier door.
  const door = await request.post(OUTBOX, { data: COURIER_ASK, headers });
  expect(door.ok()).toBe(false);
  writeFileSync(snapshotFile(), JSON.stringify({ from: process.env.COMMERCE_UPGRADE_FROM, before }, null, 2));
  database.close();
});

test("this build on the earlier EmDash refuses outsiders and the administrator, and the owner completes Ana's order", async ({ page, request, playwright, baseURL }) => {
  test.skip(phase !== "bridge");
  const { before } = JSON.parse(readFileSync(snapshotFile(), "utf8"));
  await signIn(page, request);
  const database = open();
  const refused = await refusals(page, playwright, baseURL);
  // Nothing 0.8.0 kept was rewritten by loading this build.
  expect(orderRows(database)).toEqual(before);
  // The owner marks Ana's order Completed on the Orders page's own route.
  const shown = await page.request.post(ORDERS, { data: { action: "show", orderId: "ord-ana" }, headers });
  expect(shown.ok(), await shown.text()).toBe(true);
  const version = (await shown.json()).data.order.version;
  const saved = await page.request.post(ORDERS, { data: { action: "complete", orderId: "ord-ana", version }, headers });
  expect((await saved.json()).data.result).toBe("saved");
  const after = Object.fromEntries(orderRows(database).map((row) => [row.id, row]));
  expect(after["ord-ana"].shippedKey).toBe(after["ord-ana"].completed.at + " ord-ana");
  expect(after["ord-cy"]).toEqual(before.find((row) => row.id === "ord-cy"));
  writeFileSync(artifact("order-shipped-upgrade-bridge.json"), JSON.stringify({ phase, refused, ana: after["ord-ana"].shippedKey }, null, 2));
  database.close();
});

test("after the EmDash upgrade the courier gets only the order Completed after it, and outsiders still get nothing", async ({ page, request, playwright, baseURL }) => {
  test.skip(phase !== "new");
  const { before } = JSON.parse(readFileSync(snapshotFile(), "utf8"));
  await signIn(page, request);
  const database = open();
  // 1. Both orders load as they were: Cy's as 0.8.0 left it, Ana's with the completion the bridge saved.
  const rows = Object.fromEntries(orderRows(database).map((row) => [row.id, row]));
  expect(rows["ord-cy"]).toEqual(before.find((row) => row.id === "ord-cy"));
  expect(rows["ord-ana"].paidOrder).toEqual(before.find((row) => row.id === "ord-ana").paidOrder);
  for (const orderId of ["ord-cy", "ord-ana"]) {
    const shown = await page.request.post(ORDERS, { data: { action: "show", orderId }, headers });
    expect((await shown.json()).data.order.status).toBe("completed");
  }
  // 2. The upgrade made the shippedKey index.
  const indexes = database.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = '_plugin_storage'").all()
    .filter((index) => index.name.includes("dinkus-commerce") && index.name.includes("orders") && index.name.includes("shippedKey"));
  expect(indexes.length).toBeGreaterThan(0);
  // 3. Outsiders and the administrator are still refused over HTTP.
  const refused = await refusals(page, playwright, baseURL);
  // 4. The store's courier, through EmDash's route dispatch with nobody signed in, gets Ana's order once it is a
  //    minute old, and never Cy's, Completed under 0.8.0.
  const courier = async (after) => {
    const answer = await (await request.post("/__proof/courier-outbox", { data: { after } })).json();
    expect(answer.success, JSON.stringify(answer)).toBe(true);
    return answer.data;
  };
  let first;
  await expect.poll(async () => (first = await courier(null)).items.length, { timeout: 120000, intervals: [5000] }).toBe(1);
  expect(first.items[0]).toEqual({ id: "ord-ana:shipped", at: rows["ord-ana"].completed.at, data: {
    orderId: "ord-ana", shippedAt: rows["ord-ana"].completed.at, email: "ana@buyer.test", name: "Ana Buyer",
    lines: [{ productId: "item-hat", productName: "Red hat" }] } });
  expect(first.next).toBe(rows["ord-ana"].shippedKey);
  expect(first.more).toBe(false);
  const caughtUp = await courier(first.next);
  expect(caughtUp).toEqual({ courier: 1, items: [], next: first.next, more: false });
  writeFileSync(artifact("order-shipped-upgrade-new.json"), JSON.stringify({ phase, indexes, refused, courier: first, caughtUp }, null, 2));
  console.log("order.shipped upgrade proof", JSON.stringify({ from: process.env.COMMERCE_UPGRADE_FROM, indexes: indexes.map((index) => index.name), refused, courier: first }));
  database.close();
});
