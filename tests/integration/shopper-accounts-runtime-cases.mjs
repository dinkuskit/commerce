import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { PluginStorageRepository } from "emdash";
import { WorkerdSandboxRunner } from "@emdash-cms/sandbox-workerd/sandbox";
import {
  COMMERCE_REGISTRY_RUNTIME_ID,
  CUSTOMER_SESSION_HEADER,
  INSTALLED_COMMERCE_PLUGIN_ID,
  PAID_ORDER_SCHEMA,
  SHOPPER_ACCOUNT_ORDERS_ROUTE,
  SHOPPER_ACCOUNT_PROFILE_ROUTE,
  SHOPPER_SIGN_IN_START_ROUTE,
  SHOPPER_SIGN_IN_VERIFY_ROUTE,
  SHOPPER_SIGN_OUT_ROUTE,
  createPaidOrderReceiver,
} from "../../dist/index.js";

const SITE = "https://shop.example.test";
const artifactManifest = JSON.parse(
  await readFile(new URL("../../dist/sandbox/manifest.json", import.meta.url), "utf8"),
);
const backendSource = await readFile(
  new URL("../../dist/sandbox/plugin.mjs", import.meta.url),
  "utf8",
);

function createSqliteHarness() {
  const sqlite = new BetterSqlite3(":memory:");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS options (
      name TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      revision TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS _plugin_storage (
      plugin_id TEXT NOT NULL,
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      revision TEXT NOT NULL DEFAULT '0',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(plugin_id, collection, id)
    );
    CREATE TABLE IF NOT EXISTS _emdash_cron_tasks (
      id TEXT PRIMARY KEY,
      plugin_id TEXT NOT NULL,
      task_name TEXT NOT NULL,
      schedule TEXT NOT NULL,
      is_oneshot INTEGER NOT NULL DEFAULT 0,
      data TEXT,
      next_run_at TEXT NOT NULL,
      last_run_at TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      locked_at TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT,
      UNIQUE(plugin_id, task_name)
    );
  `);
  const collectionQueries = [];
  const db = new Kysely({
    dialect: new SqliteDialect({ database: sqlite }),
    log(event) {
      if (event.level !== "query") return;
      if (event.query.sql.includes("_plugin_storage")) {
        collectionQueries.push({
          sql: event.query.sql,
          parameters: [...event.query.parameters],
        });
      }
    },
  });
  return { sqlite, db, collectionQueries };
}

function mountCollections(sqlite, db, owner, storageManifest) {
  const collections = {};
  for (const [name, spec] of Object.entries(storageManifest)) {
    collections[name] = new PluginStorageRepository(db, owner, name, [
      ...spec.indexes,
      ...(spec.uniqueIndexes ?? []),
    ]);
    for (const fields of spec.uniqueIndexes ?? []) {
      const fieldList = Array.isArray(fields) ? fields : [fields];
      const expressions = fieldList.map((field) => `json_extract(data, '$.${field}')`).join(",");
      sqlite.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS "uidx_plugin_${owner}_${name}_${fieldList.join("_")}" ON _plugin_storage(plugin_id,collection,${expressions})`,
      );
    }
  }
  return collections;
}

function makePaidOrder({
  orderId,
  email,
  paidAt,
  phone = "+16175550100",
  delivery = {
    name: "Ada Lovelace",
    line1: "100 Charles River Rd",
    city: "Cambridge",
    region: "MA",
    postalCode: "02139",
    country: "US",
  },
}) {
  return {
    schema: PAID_ORDER_SCHEMA,
    orderId,
    receiptId: `rcpt_${orderId}`,
    attemptId: `att_${orderId}`,
    paidAt,
    mode: "test",
    lines: [
      {
        catalogItemId: "hat",
        name: "Field Hat",
        quantity: 1,
        unitPrice: { currency: "USD", minor: "2500" },
      },
    ],
    total: { currency: "USD", minor: "2500" },
    contactSnapshot: {
      schema: "dinkuskit.commerce.checkout-contact/v1",
      requirePhoneNumber: false,
      revision: "rev_1",
      contact: {
        email,
        ...(phone ? { phone } : {}),
        ...(delivery ? { delivery } : {}),
      },
    },
  };
}

function extractSixDigitCode(subject) {
  const match = /(\d{6})/.exec(subject);
  assert.ok(match, `expected 6-digit code in email subject: ${subject}`);
  return match[1];
}

test("WorkerdSandboxRunner + SQLite proves existing-install upgrade compatibility, authority chain, OTP CAS & cooldown, paidAt ordering, profile null preservation, and signed-out storage isolation", async () => {
  const owner = COMMERCE_REGISTRY_RUNTIME_ID;
  const { sqlite, db, collectionQueries } = createSqliteHarness();

  // 1. Simulate a pre-upgrade EmDash 1.2.0 installation before shopper-account collections or email:send existed.
  const preUpgradeStorage = structuredClone(artifactManifest.storage);
  delete preUpgradeStorage.customers;
  delete preUpgradeStorage.customer_login_codes;
  delete preUpgradeStorage.customer_sessions;
  const preCollections = mountCollections(sqlite, db, owner, preUpgradeStorage);

  await preCollections.catalog_items.put("hat", {
    recordKind: "catalog-item",
    itemId: "hat",
    commandId: "cmd-hat",
    sku: "HAT-01",
    skuKey: "HAT-01",
    fulfillment: "physical",
    creationIntent: { manageStock: false },
    kind: "simple-product",
    name: "Field Hat",
    state: "draft",
    stockManagement: { mode: "unmanaged" },
    createdAt: "2026-10-15T00:00:00.000Z",
  });
  await preCollections.catalog_prices.put("hat", {
    recordKind: "catalog-price",
    recordId: "hat",
    catalogItemId: "hat",
    regular: { currency: "USD", minor: "2500" },
  });
  await preCollections.catalog_manual_availability.put("hat", {
    recordKind: "catalog-manual-availability",
    recordId: "hat",
    catalogItemId: "hat",
    status: "in-stock",
  });

  // Receive two orders for Ada where the newer payment (Oct 20) arrived first (#1001)
  // and the older payment (Oct 18) arrived later on retry (#1002), plus another buyer's order (#1003).
  const receiver = createPaidOrderReceiver(preCollections.orders, preCollections.order_numbers);
  await receiver.receive(
    makePaidOrder({
      orderId: "ord_newer_paid",
      email: "Ada.Lovelace@Example.test",
      paidAt: "2026-10-20T15:30:00.000Z",
      phone: "+16175550199",
      delivery: {
        name: "Ada Lovelace",
        line1: "99 New Beacon St",
        city: "Boston",
        region: "MA",
        postalCode: "02110",
        country: "US",
      },
    }),
  );
  await receiver.receive(
    makePaidOrder({
      orderId: "ord_older_retried",
      email: "ada.lovelace@example.test",
      paidAt: "2026-10-18T08:15:00.000Z",
      phone: "+16175550101",
      delivery: {
        name: "Ada Lovelace",
        line1: "10 Old Archive Ln",
        city: "Cambridge",
        region: "MA",
        postalCode: "02139",
        country: "US",
      },
    }),
  );
  await receiver.receive(
    makePaidOrder({
      orderId: "ord_other_shopper",
      email: "babbage@example.test",
      paidAt: "2026-10-20T16:00:00.000Z",
    }),
  );

  // 2. Upgrade the installation in place to the current manifest + compiled workerd bundle.
  const upgradedManifest = structuredClone(artifactManifest);
  upgradedManifest.id = owner;
  const collections = mountCollections(sqlite, db, owner, upgradedManifest.storage);
  const deliveredEmails = [];

  const runner = new WorkerdSandboxRunner({
    db,
    siteInfo: { name: "Dinkus Outpost", url: SITE, locale: "en" },
    emailSend: async (message, pluginId) => {
      deliveredEmails.push({ message, pluginId });
    },
    limits: { wallTimeMs: 15000 },
  });
  assert.equal(runner.isAvailable(), true, "pinned workerd binary must be available");
  const plugin = await runner.load(upgradedManifest, backendSource);

  const invokeRoute = (route, { method = "POST", input, headers = {}, url } = {}) =>
    plugin.invokeRoute(route, input, {
      url: url ?? `${SITE}/_emdash/api/plugins/${owner}/${route}`,
      method,
      headers,
    });

  try {
    // Existing catalog and order rows survive upgrade intact.
    const publicCatalog = await invokeRoute("catalog/public", {
      method: "GET",
      headers: { origin: SITE },
    });
    assert.equal(Array.isArray(publicCatalog.products), true);
    assert.equal(publicCatalog.products.length, 1);
    assert.equal(publicCatalog.products[0].sku, "HAT-01");

    // 3. Cross-origin write requests are denied before email:send or SQLite mutation.
    const crossOriginStart = await invokeRoute(SHOPPER_SIGN_IN_START_ROUTE, {
      input: { email: "ada.lovelace@example.test" },
      headers: { origin: "https://evil.example.test" },
    });
    assert.deepEqual(crossOriginStart, {
      ok: false,
      error: { code: "ORIGIN_DENIED", message: "Account request origin is missing or invalid" },
    });
    assert.equal(deliveredEmails.length, 0);

    // 4. Exhaustion & cooldown proof on a separate email in real SQLite via workerd.
    const exhaustStart = await invokeRoute(SHOPPER_SIGN_IN_START_ROUTE, {
      input: { email: "exhaust@example.test" },
      headers: { origin: SITE, "sec-fetch-site": "same-origin" },
    });
    assert.equal(exhaustStart.ok, true);
    assert.equal(deliveredEmails.length, 1);
    const exhaustCode = extractSixDigitCode(deliveredEmails[0].message.subject);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const wrong = await invokeRoute(SHOPPER_SIGN_IN_VERIFY_ROUTE, {
        input: { email: "exhaust@example.test", code: "000000" },
        headers: { origin: SITE, "sec-fetch-site": "same-origin" },
      });
      assert.equal(wrong.ok, false);
      assert.equal(wrong.error.code, "CODE_INVALID");
    }

    // Even presenting the real code on the 6th attempt fails closed, and no session row exists.
    const sixthAttempt = await invokeRoute(SHOPPER_SIGN_IN_VERIFY_ROUTE, {
      input: { email: "exhaust@example.test", code: exhaustCode },
      headers: { origin: SITE, "sec-fetch-site": "same-origin" },
    });
    assert.equal(sixthAttempt.ok, false);
    assert.equal(sixthAttempt.error.code, "CODE_INVALID");
    assert.equal((await collections.customer_sessions.query()).items.length, 0);

    // Resend cooldown stays enforced in SQLite even after 5 wrong guesses exhausted the code.
    const cooldownAfterExhaust = await invokeRoute(SHOPPER_SIGN_IN_START_ROUTE, {
      input: { email: "exhaust@example.test" },
      headers: { origin: SITE, "sec-fetch-site": "same-origin" },
    });
    assert.equal(cooldownAfterExhaust.ok, false);
    assert.equal(cooldownAfterExhaust.error.code, "RATE_LIMITED");

    // 5. Real shopper OTP sign-in for Ada via workerd email:send bridge.
    const adaStart = await invokeRoute(SHOPPER_SIGN_IN_START_ROUTE, {
      input: { email: "  ADA.LOVELACE@example.test " },
      headers: { origin: SITE, "sec-fetch-site": "same-origin" },
    });
    assert.equal(adaStart.ok, true);
    assert.equal(deliveredEmails.length, 2);
    assert.equal(deliveredEmails[1].pluginId, owner);
    assert.equal(deliveredEmails[1].message.to, "ADA.LOVELACE@example.test");
    const adaCode = extractSixDigitCode(deliveredEmails[1].message.subject);

    const adaVerified = await invokeRoute(SHOPPER_SIGN_IN_VERIFY_ROUTE, {
      input: { email: "ada.lovelace@example.test", code: adaCode },
      headers: { origin: SITE, "sec-fetch-site": "same-origin" },
    });
    assert.equal(adaVerified.ok, true);
    assert.equal(adaVerified.capability.header, CUSTOMER_SESSION_HEADER);
    assert.equal(adaVerified.capability.retention, "json-body");
    // Seeded from ord_newer_paid (Oct 20, #1001), NOT ord_older_retried (Oct 18, #1002)!
    assert.equal(adaVerified.profile.phone, "+16175550199");
    assert.equal(adaVerified.profile.delivery.line1, "99 New Beacon St");

    // Stored login code row in SQLite is marked consumed: true and cannot be replayed.
    const storedCodeRow = await collections.customer_login_codes.get("ada.lovelace@example.test");
    assert.equal(storedCodeRow.consumed, true);
    const replayAda = await invokeRoute(SHOPPER_SIGN_IN_VERIFY_ROUTE, {
      input: { email: "ada.lovelace@example.test", code: adaCode },
      headers: { origin: SITE, "sec-fetch-site": "same-origin" },
    });
    assert.equal(replayAda.ok, false);
    assert.equal(replayAda.error.code, "CODE_INVALID");
    assert.equal((await collections.customer_sessions.query()).items.length, 1);

    const adaSession = adaVerified.capability.session;

    // 6. Allowed shopper access returns only Ada's orders sorted by paidAt descending (#1001 then #1002).
    const adaOrders = await invokeRoute(SHOPPER_ACCOUNT_ORDERS_ROUTE, {
      method: "GET",
      headers: { [CUSTOMER_SESSION_HEADER]: adaSession },
    });
    assert.equal(adaOrders.ok, true);
    assert.deepEqual(
      adaOrders.orders.map((o) => ({ orderId: o.orderId, number: o.number, paidAt: o.paidAt })),
      [
        { orderId: "ord_newer_paid", number: 1001, paidAt: "2026-10-20T15:30:00.000Z" },
        { orderId: "ord_older_retried", number: 1002, paidAt: "2026-10-18T08:15:00.000Z" },
      ],
    );

    // 7. Explicitly clearing delivery and phone persists null in SQLite across subsequent reads.
    const cleared = await invokeRoute(SHOPPER_ACCOUNT_PROFILE_ROUTE, {
      method: "POST",
      input: { phone: null, delivery: null },
      headers: {
        origin: SITE,
        "sec-fetch-site": "same-origin",
        [CUSTOMER_SESSION_HEADER]: adaSession,
      },
    });
    assert.equal(cleared.ok, true);
    assert.equal(cleared.profile.phone, null);
    assert.equal(cleared.profile.delivery, null);

    const profileAfterClear = await invokeRoute(SHOPPER_ACCOUNT_PROFILE_ROUTE, {
      method: "GET",
      headers: { [CUSTOMER_SESSION_HEADER]: adaSession },
    });
    assert.equal(profileAfterClear.ok, true);
    assert.equal(profileAfterClear.profile.phone, null);
    assert.equal(profileAfterClear.profile.delivery, null);

    const ordersAfterClear = await invokeRoute(SHOPPER_ACCOUNT_ORDERS_ROUTE, {
      method: "GET",
      headers: { [CUSTOMER_SESSION_HEADER]: adaSession },
    });
    assert.equal(ordersAfterClear.ok, true);
    assert.equal(ordersAfterClear.profile.phone, null);
    assert.equal(ordersAfterClear.profile.delivery, null);

    // 8. Sign-out deletes the session from SQLite, and subsequent calls reject before touching orders/customers.
    const signedOut = await invokeRoute(SHOPPER_SIGN_OUT_ROUTE, {
      method: "POST",
      input: {},
      headers: {
        origin: SITE,
        "sec-fetch-site": "same-origin",
        [CUSTOMER_SESSION_HEADER]: adaSession,
      },
    });
    assert.deepEqual(signedOut, { ok: true, signedOut: true });
    assert.equal((await collections.customer_sessions.query()).items.length, 0);

    collectionQueries.length = 0;
    const deniedOrders = await invokeRoute(SHOPPER_ACCOUNT_ORDERS_ROUTE, {
      method: "GET",
      headers: { [CUSTOMER_SESSION_HEADER]: adaSession },
    });
    assert.deepEqual(deniedOrders, {
      ok: false,
      error: { code: "SESSION_DENIED", message: "Customer session is missing or invalid" },
    });
    const touchedCollectionsAfterSignOut = collectionQueries.map((q) => q.parameters[1]);
    assert.deepEqual(touchedCollectionsAfterSignOut, ["customer_sessions"]);
  } finally {
    await runner.terminateAll();
    await db.destroy();
  }
});

test("WorkerdSandboxRunner fresh install under dinkus-commerce rejects replaced OTP codes before session persistence", async () => {
  const owner = INSTALLED_COMMERCE_PLUGIN_ID;
  const { sqlite, db } = createSqliteHarness();
  const manifest = structuredClone(artifactManifest);
  manifest.id = owner;
  const collections = mountCollections(sqlite, db, owner, manifest.storage);
  const deliveredEmails = [];

  const runner = new WorkerdSandboxRunner({
    db,
    siteInfo: { name: "Registry Store", url: SITE, locale: "en" },
    emailSend: async (message, pluginId) => {
      deliveredEmails.push({ message, pluginId });
    },
    limits: { wallTimeMs: 15000 },
  });
  const plugin = await runner.load(manifest, backendSource);
  const invokeRoute = (route, { method = "POST", input, headers = {} } = {}) =>
    plugin.invokeRoute(route, input, {
      url: `${SITE}/_emdash/api/plugins/${owner}/${route}`,
      method,
      headers,
    });

  try {
    const start1 = await invokeRoute(SHOPPER_SIGN_IN_START_ROUTE, {
      input: { email: "hopper@example.test" },
      headers: { origin: SITE, "sec-fetch-site": "same-origin" },
    });
    assert.equal(start1.ok, true);
    const firstCode = extractSixDigitCode(deliveredEmails[0].message.subject);

    // Backdate issuedAt in SQLite by 31s so a replacement code can be issued without waiting 30s wall-clock.
    const currentChallenge = await collections.customer_login_codes.getVersioned("hopper@example.test");
    await collections.customer_login_codes.compareAndSet(
      "hopper@example.test",
      currentChallenge.revision,
      {
        ...currentChallenge.value,
        issuedAt: currentChallenge.value.issuedAt - 31,
      },
    );

    const start2 = await invokeRoute(SHOPPER_SIGN_IN_START_ROUTE, {
      input: { email: "hopper@example.test" },
      headers: { origin: SITE, "sec-fetch-site": "same-origin" },
    });
    assert.equal(start2.ok, true);
    const secondCode = extractSixDigitCode(deliveredEmails[1].message.subject);

    // If firstCode differs from secondCode, presenting the replaced firstCode must fail closed with 0 sessions.
    if (firstCode !== secondCode) {
      const staleVerify = await invokeRoute(SHOPPER_SIGN_IN_VERIFY_ROUTE, {
        input: { email: "hopper@example.test", code: firstCode },
        headers: { origin: SITE, "sec-fetch-site": "same-origin" },
      });
      assert.equal(staleVerify.ok, false);
      assert.equal(staleVerify.error.code, "CODE_INVALID");
      assert.equal((await collections.customer_sessions.query()).items.length, 0);
    }

    // Presenting the current secondCode succeeds and mints exactly 1 session.
    const validVerify = await invokeRoute(SHOPPER_SIGN_IN_VERIFY_ROUTE, {
      input: { email: "hopper@example.test", code: secondCode },
      headers: { origin: SITE, "sec-fetch-site": "same-origin" },
    });
    assert.equal(validVerify.ok, true);
    assert.equal((await collections.customer_sessions.query()).items.length, 1);

    // Deterministic concurrent single-use verification through the Registry storage boundary (#154):
    // two simultaneous valid-code submissions both complete getVersioned before either runs compareAndSet.
    const concurrentStart = await invokeRoute(SHOPPER_SIGN_IN_START_ROUTE, {
      input: { email: "concurrent@example.test" },
      headers: { origin: SITE, "sec-fetch-site": "same-origin" },
    });
    assert.equal(concurrentStart.ok, true);
    const concurrentCode = extractSixDigitCode(deliveredEmails[2].message.subject);

    const origGetVersioned = PluginStorageRepository.prototype.getVersioned;
    let barrierCount = 0;
    let openBarrier;
    const bothRead = new Promise((resolve) => {
      openBarrier = resolve;
    });
    PluginStorageRepository.prototype.getVersioned = async function (id, ...rest) {
      const res = await origGetVersioned.call(this, id, ...rest);
      if (id === "concurrent@example.test" && barrierCount < 2) {
        barrierCount += 1;
        if (barrierCount === 2) openBarrier();
        await bothRead;
      }
      return res;
    };

    try {
      const [verifyA, verifyB] = await Promise.all([
        invokeRoute(SHOPPER_SIGN_IN_VERIFY_ROUTE, {
          input: { email: "concurrent@example.test", code: concurrentCode },
          headers: { origin: SITE, "sec-fetch-site": "same-origin" },
        }),
        invokeRoute(SHOPPER_SIGN_IN_VERIFY_ROUTE, {
          input: { email: "concurrent@example.test", code: concurrentCode },
          headers: { origin: SITE, "sec-fetch-site": "same-origin" },
        }),
      ]);
      const concurrentVerifications = [verifyA.ok, verifyB.ok];
      assert.equal(
        concurrentVerifications.filter(Boolean).length,
        1,
        "two concurrent valid-code submissions through WorkerdSandboxRunner + SQLite must produce exactly 1 success",
      );
      const loser = verifyA.ok ? verifyB : verifyA;
      assert.equal(loser.ok, false);
      assert.equal(loser.error.code, "CONTENTION");
    } finally {
      PluginStorageRepository.prototype.getVersioned = origGetVersioned;
    }

    const allSessions = (await collections.customer_sessions.query()).items;
    const concurrentSessions = allSessions.filter((s) => s.data.emailKey === "concurrent@example.test");
    assert.equal(concurrentSessions.length, 1, "only 1 session row may be persisted for concurrent@example.test");
  } finally {
    await runner.terminateAll();
    await db.destroy();
  }
});
