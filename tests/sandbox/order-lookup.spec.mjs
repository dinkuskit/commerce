import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import { writeFile } from "node:fs/promises";

// The order lookup route on a real EmDash 1.5 store running the built Registry (sandboxed) Commerce.
const ID = "dinkus-commerce";
const ROUTE = `/_emdash/api/plugins/${ID}/orders/lookup`;
const delivery = { name: "Fixture Shopper", line1: "1 Example Way", city: "Testville", postalCode: "00000", country: "US" };
const order = (id, number, email) => ({
  paidOrder: {
    schema: "dinkuskit.commerce.paid-order/v1", orderId: id, receiptId: `r-${id}`, attemptId: `a-${id}`, paidAt: "2026-11-20T10:00:00Z", mode: "test", paymentId: "pi_fixture_secret",
    lines: [{ catalogItemId: "hat", quantity: 1, name: "Hat", unitPrice: { currency: "USD", minor: "2500" } }], total: { currency: "USD", minor: "2500" },
    contactSnapshot: { schema: "dinkuskit.commerce.checkout-contact/v1", requirePhoneNumber: false, revision: null, contact: { email, delivery } },
  },
  emailKey: email.toLowerCase(), number, revision: 1,
});

test("order number plus checkout email shows one order; wrong guesses are limited", async ({ request, baseURL }) => {
  expect((await request.get("/_emdash/api/setup/dev-bypass")).status()).toBe(200);
  const sqlite = new Database(process.env.COMMERCE_PROOF_DB.replace(/^file:/, ""));
  const now = new Date().toISOString();
  const put = sqlite.prepare("INSERT OR REPLACE INTO _plugin_storage (plugin_id, collection, id, data, revision, created_at, updated_at) VALUES (?, 'orders', ?, ?, '1', ?, ?)");
  put.run(ID, "lookup-pat", JSON.stringify(order("lookup-pat", 4001, "Pat.Lookup@example.test")), now, now);
  put.run(ID, "lookup-sam", JSON.stringify(order("lookup-sam", 4002, "sam.lookup@example.test")), now, now);
  const guesses = () => sqlite.prepare("SELECT id, data FROM _plugin_storage WHERE plugin_id=? AND collection='order_lookup_guesses' ORDER BY id").all(ID);
  const trace = [];
  const ask = async (data, headers = { origin: baseURL }) => {
    const response = await request.post(ROUTE, { headers: { ...headers, "content-type": "application/json" }, data });
    const body = await response.json();
    trace.push({ request: data, origin: headers.origin ?? null, status: response.status(), cache: response.headers()["cache-control"], answer: body.data ?? body });
    return { status: response.status(), cache: response.headers()["cache-control"], answer: body.data ?? body };
  };
  try {
    await test.step("the right number and email show that order, without payment details", async () => {
      const found = await ask({ orderNumber: "#4001", email: "pat.lookup@EXAMPLE.test" });
      expect(found.status).toBe(200);
      expect(found.cache).toContain("no-store");
      expect(found.answer).toMatchObject({ ok: true, order: { number: 4001, status: "processing", delivery } });
      expect(JSON.stringify(found.answer)).not.toContain("pi_fixture_secret");
    });
    await test.step("another shopper's order and a wrong number get the same answer", async () => {
      for (const data of [{ orderNumber: "4002", email: "pat.lookup@example.test" }, { orderNumber: "4999", email: "pat.lookup@example.test" }]) {
        expect((await ask(data)).answer).toEqual({ ok: false, error: { code: "ORDER_NOT_FOUND", message: "No order matches that order number and email. Check both and try again." } });
      }
    });
    await test.step("a request from another site is refused by EmDash's own CSRF check and counts nothing", async () => {
      const before = guesses();
      const refused = await ask({ orderNumber: "4001", email: "pat.lookup@example.test" }, { origin: "https://evil.example.test" });
      expect(refused.status).toBe(403);
      expect(refused.answer).toMatchObject({ error: { code: "CSRF_REJECTED" } });
      expect(JSON.stringify(refused.answer)).not.toContain("Fixture Shopper");
      expect(guesses()).toEqual(before);
    });
    await test.step("after 5 wrong tries for an email, even the right number waits an hour", async () => {
      for (const n of [4990, 4991, 4992]) await ask({ orderNumber: String(n), email: "pat.lookup@example.test" });
      expect((await ask({ orderNumber: "4001", email: "pat.lookup@example.test" })).answer)
        .toEqual({ ok: false, error: { code: "LOOKUP_LIMITED", message: "Too many tries. Try again in an hour." } });
      expect((await ask({ orderNumber: "4002", email: "sam.lookup@example.test" })).answer).toMatchObject({ ok: true, order: { number: 4002 } });
      const rows = guesses();
      expect(rows.some(row => row.id.includes("pat.lookup") || row.data.includes("pat.lookup"))).toBe(false);
      expect(rows.find(row => row.id.startsWith("email:"))).toBeTruthy();
    });
  } finally {
    await writeFile(`${process.env.COMMERCE_PROOF_ARTIFACTS}/order-lookup-trace.json`, JSON.stringify(trace, null, 2));
    sqlite.close();
  }
});
