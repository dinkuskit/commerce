import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Run by scripts/registry-upgrade-proof.mjs with COMMERCE_UPGRADE_SPEC=registry-upgrade-order-lookup.spec.mjs.
// "old": an earlier release (0.8.0 or later) keeps paid orders, one of them from before the emailKey index, plus
// its shopper accounts. "bridge": this build on that release's EmDash finds the orders and locks one order number
// after 5 wrong tries. "new": this build on this checkout's EmDash keeps every row as it was, still finds both
// orders, and the lock made before the EmDash upgrade still holds (commerce-order-lookup-20261122).
const phase = process.env.COMMERCE_UPGRADE_PHASE;
const LOOKUP = "/_emdash/api/plugins/dinkus-commerce/orders/lookup";
const snapshotFile = () => resolve(process.env.COMMERCE_PROOF_ARTIFACTS, "order-lookup-before-upgrade.json");
const traceFile = () => resolve(process.env.COMMERCE_PROOF_ARTIFACTS, "order-lookup-upgrade-" + phase + ".json");
const ORDER_COLLECTIONS = ["orders", "order_numbers"];
// The removed shopper accounts' storage: Commerce no longer declares it and must leave it exactly as it was.
const ACCOUNT_COLLECTIONS = ["customers", "customer_login_codes", "customer_sessions"];

const usd = (minor) => ({ currency: "USD", minor });
const delivery = (name) => ({ name, line1: "1 Upgrade Way", city: "Springfield", region: "IL", postalCode: "62701", country: "US" });
const paidOrder = (orderId, email, name) => ({
  schema: "dinkuskit.commerce.paid-order/v1", orderId, receiptId: "rcpt-" + orderId, attemptId: "attempt-" + orderId,
  paymentId: "pi_" + orderId, paidAt: "2026-11-01T15:00:00.000Z", mode: "test",
  lines: [{ catalogItemId: "item-hat", quantity: 1, name: "Red hat", unitPrice: usd("1200") }], total: usd("1200"),
  contactSnapshot: { schema: "dinkuskit.commerce.checkout-contact/v1", requirePhoneNumber: false, revision: null,
    contact: { email, phone: "555-0100", delivery: delivery(name) } },
});
// Rows as 0.8.0's paid-order receiver stores them ({ paidOrder, emailKey, number, revision }), and one order kept
// before the emailKey index existed, which has no emailKey at all.
const orderRows = () => ({
  orders: {
    "ord-pat": { paidOrder: paidOrder("ord-pat", "Pat@Example.test", "Pat Shopper"), emailKey: "pat@example.test", number: 1001, revision: 1 },
    "ord-sam": { paidOrder: paidOrder("ord-sam", "sam@example.test", "Sam Shopper"), emailKey: "sam@example.test", number: 1002, revision: 1 },
    "ord-legacy": { paidOrder: paidOrder("ord-legacy", "lee@example.test", "Lee Shopper"), number: 1003, revision: 1 },
  },
  order_numbers: { next: { next: 1004 } },
});
const accountRows = () => ({
  customers: { "pat@example.test": { recordKind: "commerce-customer", emailKey: "pat@example.test", email: "Pat@Example.test",
    phone: "555-0100", delivery: delivery("Pat Shopper"), createdAt: "2026-11-01T15:00:00.000Z", updatedAt: "2026-11-01T15:00:00.000Z" } },
  customer_login_codes: { "pat@example.test": { recordKind: "commerce-customer-login-code", emailKey: "pat@example.test",
    verifier: "a".repeat(64), attempts: 1, issuedAt: 1_793_000_000, expiresAt: 1_793_000_600, consumed: true } },
  customer_sessions: { "csess_upgrade": { recordKind: "commerce-customer-session", sessionId: "csess_upgrade", emailKey: "pat@example.test",
    verifier: "b".repeat(64), siteBinding: "http://127.0.0.1", createdAt: 1_793_000_000, expiresAt: 1_795_592_000 } },
});

const open = () => new Database(process.env.COMMERCE_PROOF_DB.slice(5));
const rawRows = (database, collections) => database.prepare(
  "SELECT collection, id, data FROM _plugin_storage WHERE plugin_id = ? AND collection IN (" + collections.map(() => "?").join(",") + ") ORDER BY collection, id",
).all("dinkus-commerce", ...collections);
const guessRows = (database) => database.prepare(
  "SELECT id, data FROM _plugin_storage WHERE plugin_id = ? AND collection = 'order_lookup_guesses' ORDER BY id",
).all("dinkus-commerce").map((row) => ({ id: row.id, ...JSON.parse(row.data) }));

async function start(request) {
  expect((await request.get("/_emdash/api/setup/dev-bypass")).status()).toBe(200);
  // Any public read makes the host load Commerce, which creates its storage indexes.
  expect((await request.get("/_emdash/api/plugins/dinkus-commerce/catalog/public")).ok()).toBe(true);
}

async function lookUp(request, baseURL, orderNumber, email) {
  const response = await request.post(LOOKUP, { data: { orderNumber, email }, headers: { origin: new URL(baseURL).origin } });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const body = await response.json();
  return body.data;
}
const summary = (answer) => answer.ok
  ? { ok: true, number: answer.order.number, status: answer.order.status, recipient: answer.order.delivery?.name ?? null }
  : { ok: false, code: answer.error.code };

test("the earlier release keeps paid orders and shopper accounts", async ({ request }) => {
  test.skip(phase !== "old");
  await start(request);
  const database = open();
  const columns = database.prepare("PRAGMA table_info(_plugin_storage)").all().map((column) => column.name);
  const now = new Date().toISOString();
  for (const [collection, rows] of Object.entries({ ...orderRows(), ...accountRows() })) {
    for (const [id, record] of Object.entries(rows)) {
      const row = { plugin_id: "dinkus-commerce", collection, id, data: JSON.stringify(record), created_at: now, updated_at: now,
        ...(columns.includes("revision") ? { revision: crypto.randomUUID() } : {}) };
      const keys = Object.keys(row).filter((key) => columns.includes(key));
      database.prepare("INSERT INTO _plugin_storage (" + keys.join(",") + ") VALUES (" + keys.map(() => "?").join(",") + ")").run(...keys.map((key) => row[key]));
    }
  }
  const snapshot = { from: process.env.COMMERCE_UPGRADE_FROM, orders: rawRows(database, ORDER_COLLECTIONS), accounts: rawRows(database, ACCOUNT_COLLECTIONS) };
  expect(snapshot.orders).toHaveLength(4);
  expect(snapshot.accounts).toHaveLength(3);
  writeFileSync(snapshotFile(), JSON.stringify(snapshot, null, 2));
  // The earlier release has no lookup route.
  const before = await request.post(LOOKUP, { data: { orderNumber: "1001", email: "pat@example.test" }, headers: { origin: "http://127.0.0.1:" + (process.env.COMMERCE_PROOF_PORT ?? 64561) } });
  expect(before.ok()).toBe(false);
  database.close();
});

test("this build finds the earlier orders on the earlier EmDash and locks a guessed order number", async ({ request, baseURL }) => {
  test.skip(phase !== "bridge");
  const before = JSON.parse(readFileSync(snapshotFile(), "utf8"));
  await start(request);
  const database = open();
  const trace = [];
  const ask = async (orderNumber, email) => {
    const answer = await lookUp(request, baseURL, orderNumber, email);
    trace.push({ orderNumber, email, ...summary(answer) });
    expect(JSON.stringify(answer)).not.toContain("pi_");
    return answer;
  };
  expect(summary(await ask("#1001", "PAT@example.test"))).toEqual({ ok: true, number: 1001, status: "processing", recipient: "Pat Shopper" });
  expect(summary(await ask("1003", "lee@example.test"))).toEqual({ ok: true, number: 1003, status: "processing", recipient: "Lee Shopper" });
  expect(summary(await ask("1003", "pat@example.test"))).toEqual({ ok: false, code: "ORDER_NOT_FOUND" });
  // Five wrong emails for Sam's order number lock that number.
  for (const guess of ["a", "b", "c", "d", "e"]) expect(summary(await ask("1002", guess + "@example.test"))).toEqual({ ok: false, code: "ORDER_NOT_FOUND" });
  expect(summary(await ask("1002", "sam@example.test"))).toEqual({ ok: false, code: "LOOKUP_LIMITED" });
  expect(guessRows(database).find((row) => row.id === "number:1002")).toMatchObject({ tries: 5 });
  // Nothing the earlier release kept was rewritten.
  expect(rawRows(database, ORDER_COLLECTIONS)).toEqual(before.orders);
  expect(rawRows(database, ACCOUNT_COLLECTIONS)).toEqual(before.accounts);
  writeFileSync(traceFile(), JSON.stringify({ phase, guessRows: guessRows(database), trace }, null, 2));
  database.close();
});

test("after the EmDash upgrade the orders are unchanged, still found, and the lock still holds", async ({ request, baseURL }) => {
  test.skip(phase !== "new");
  const before = JSON.parse(readFileSync(snapshotFile(), "utf8"));
  await start(request);
  const database = open();
  const trace = [];
  const ask = async (orderNumber, email) => {
    const answer = await lookUp(request, baseURL, orderNumber, email);
    trace.push({ orderNumber, email, ...summary(answer) });
    expect(JSON.stringify(answer)).not.toContain("pi_");
    return answer;
  };
  // 1. The orders and the removed shopper accounts' rows are exactly as the earlier release left them.
  expect(rawRows(database, ORDER_COLLECTIONS)).toEqual(before.orders);
  expect(rawRows(database, ACCOUNT_COLLECTIONS)).toEqual(before.accounts);
  // 2. The lock made on the earlier EmDash still refuses even the right email.
  expect(summary(await ask("1002", "sam@example.test"))).toEqual({ ok: false, code: "LOOKUP_LIMITED" });
  // 3. The indexed order and the order from before the index are both found; a wrong pair is not.
  expect(summary(await ask("1001", "pat@example.test"))).toEqual({ ok: true, number: 1001, status: "processing", recipient: "Pat Shopper" });
  expect(summary(await ask("1003", "LEE@example.test"))).toEqual({ ok: true, number: 1003, status: "processing", recipient: "Lee Shopper" });
  expect(summary(await ask("1001", "lee@example.test"))).toEqual({ ok: false, code: "ORDER_NOT_FOUND" });
  // 4. The removed account routes answer nothing.
  const oldRoute = await request.get("/_emdash/api/plugins/dinkus-commerce/account/orders");
  expect(oldRoute.ok()).toBe(false);
  expect(rawRows(database, ORDER_COLLECTIONS)).toEqual(before.orders);
  writeFileSync(traceFile(), JSON.stringify({ phase, guessRows: guessRows(database), trace }, null, 2));
  database.close();
});
