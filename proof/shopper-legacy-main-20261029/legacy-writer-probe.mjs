// Same-repository historical source -> real EmDash SQLite repositories -> current
// account handlers. Synthetic compatibility diagnostic, not paid checkout proof.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { PluginStorageRepository } from "emdash";
import {
  CUSTOMERS_COLLECTION, CUSTOMER_LOGIN_CODES_COLLECTION, CUSTOMER_SESSIONS_COLLECTION,
  CUSTOMER_SESSION_HEADER, PAID_ORDER_SCHEMA, createInstalledShopperAccountHandlers,
  createPaidOrderReceiver, listOrdersForEmail,
} from "../../dist/index.js";

const expected = process.argv[2];
assert.ok(["before", "after"].includes(expected), "usage: node legacy-writer-probe.mjs before|after");
const root = fileURLToPath(new URL("../../", import.meta.url));
const historicalCommit = "8823272c92a619463effbb4d339a910f1810e921";
const historicalSource = path => execFileSync("git", ["show", `${historicalCommit}:${path}`], { cwd: root, encoding: "utf8" });
const bundle = await build({
  stdin: { contents: historicalSource("src/features/orders/store.ts"), loader: "ts", sourcefile: "legacy-store.ts", resolveDir: root },
  bundle: true, format: "esm", platform: "node", write: false,
  plugins: [{ name: "same-repository-pinned-schema", setup(b) {
    b.onResolve({ filter: /handoffs\/paid-order\.js$/ }, () => ({ path: "src/handoffs/paid-order.ts", namespace: "historical" }));
    b.onLoad({ filter: /.*/, namespace: "historical" }, args => ({ contents: historicalSource(args.path), loader: "ts" }));
  } }],
});
const historical = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const site = "https://shop.example.test";
const delivery = { name: "Fixture Shopper", line1: "12 Test Street", city: "Boston", region: "MA", postalCode: "02110", country: "US" };
const observations = [];
for (const scenario of [
  { name: "blank-phone", contact: { phone: "" } },
  { name: "incomplete-delivery", contact: { delivery: { country: "US" } } },
]) {
  const dir = mkdtempSync(join(tmpdir(), "commerce-legacy-writer-"));
  const sqlite = new BetterSqlite3(join(dir, "fixture.sqlite"));
  sqlite.exec(`CREATE TABLE _plugin_storage (
    plugin_id TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL,
    data TEXT NOT NULL, revision TEXT NOT NULL DEFAULT '0',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY(plugin_id,collection,id));`);
  const db = new Kysely({ dialect: new SqliteDialect({ database: sqlite }) });
  try {
    const names = ["orders", "order_numbers", CUSTOMERS_COLLECTION, CUSTOMER_LOGIN_CODES_COLLECTION, CUSTOMER_SESSIONS_COLLECTION];
    const storage = Object.fromEntries(names.map(name => [name, new PluginStorageRepository(db, "dinkus-commerce", name, [])]));
    const email = "legacy-fixture@example.test";
    const paid = {
      schema: PAID_ORDER_SCHEMA, orderId: "legacy-order", receiptId: "legacy-receipt", attemptId: "legacy-attempt", mode: "test",
      paidAt: "2026-10-10T12:00:00.000Z", lines: [{ catalogItemId: "fixture-item", name: "Fixture", quantity: 1, unitPrice: { currency: "USD", minor: "4500" } }],
      total: { currency: "USD", minor: "4500" },
      contactSnapshot: { schema: "dinkuskit.commerce.checkout-contact/v1", requirePhoneNumber: false, revision: "fixture-settings", contact: { email, phone: "+15550101", delivery, ...scenario.contact } },
    };
    await assert.rejects(createPaidOrderReceiver(storage.orders).receive(paid), /Invalid paid order/);
    const writer = historical.createPaidOrderReceiver(storage.orders);
    assert.equal(await writer.receive(paid), "stored");
    assert.equal(await writer.receive(paid), "duplicate");
    const kept = await storage.orders.get(paid.orderId);
    assert.deepEqual(kept, { paidOrder: paid });
    assert.equal((await listOrdersForEmail(storage.orders, email)).length, 1, "current compatibility reader admits the historical writer's row");
    const ctx = { plugin: { id: "dinkus-commerce", version: "synthetic-source" }, site: { url: site }, storage,
      settings: { async getVersioned() { return { revision: "s1", value: { recordKind: "merchant-store-settings", storeCountry: "US", shippingCountries: ["US"], requirePhoneNumber: false } }; } },
      email: { async send() {} },
    };
    const handlers = createInstalledShopperAccountHandlers((c, key) => listOrdersForEmail(c.storage.orders, key), { now: () => 1_790_000_000, createLoginCode: () => "482910" });
    const request = (route, session, method = "POST") => ({ url: `${site}/_emdash/api/plugins/dinkus-commerce/account/${route}`, method, headers: { origin: site, ...(session ? { [CUSTOMER_SESSION_HEADER]: session } : {}) } });
    assert.equal((await handlers.startSignIn({ input: { email }, request: request("sign-in/start") }, ctx)).ok, true);
    const signedIn = await handlers.verifySignIn({ input: { email, code: "482910" }, request: request("sign-in/verify") }, ctx);
    assert.equal(signedIn.ok, true);
    const result = await handlers.profile({ request: request("profile", signedIn.capability.session, "GET") }, ctx);
    if (expected === "before") { assert.equal(result.ok, false); assert.equal(result.error.code, "UNAVAILABLE"); }
    else {
      assert.equal(result.ok, true);
      assert.deepEqual(result.profile, { email, phone: scenario.name === "blank-phone" ? null : "+15550101", delivery: scenario.name === "incomplete-delivery" ? null : delivery });
    }
    assert.deepEqual(await storage.orders.get(paid.orderId), kept, "kept snapshot is not rewritten");
    observations.push({ case: scenario.name, historicalCommit, historicalStored: true, currentReceiverRefused: true, currentKeptReaderAdmitted: true, signInSucceeded: true, nextProfileSucceeded: result.ok, ...(result.ok ? {} : { nextProfileError: result.error.code }), keptUnchanged: true });
  } finally {
    await db.destroy();
    rmSync(dir, { recursive: true });
  }
}
console.log(JSON.stringify({ scope: "historical-source compatibility; real native EmDash SQLite repositories; not installed-release/payment/checkout proof", expected, observations }, null, 2));
