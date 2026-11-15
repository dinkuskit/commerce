import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";

function dbPath() {
  const url = process.env.COMMERCE_PROOF_DB;
  if (!url) throw new Error("missing commerce proof database");
  return url.replace(/^file:/, "");
}

function seedProduct(filename) {
  const database = new Database(filename);
  const now = "2026-09-30T00:00:00.000Z";
  const catalog = "catalog_items";
  const prices = "catalog_prices";
  const availability = "catalog_manual_availability";
  const insert = database.prepare(
    "INSERT OR REPLACE INTO _plugin_storage (plugin_id, collection, id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  insert.run(
    "dinkus-commerce",
    catalog,
    "guest-hat",
    JSON.stringify({
      recordKind: "catalog-item",
      itemId: "guest-hat",
      commandId: "catalog:create:guest-hat",
      creationIntent: { manageStock: false },
      kind: "simple-product",
      name: "Guest hat",
      sku: "GUEST-HAT",
      skuKey: "GUEST-HAT",
      stockManagement: { mode: "unmanaged" },
      state: "draft",
      createdAt: now,
    }),
    now,
    now,
  );
  insert.run(
    "dinkus-commerce",
    prices,
    "guest-hat",
    JSON.stringify({
      recordKind: "catalog-price",
      recordId: "guest-hat",
      catalogItemId: "guest-hat",
      regular: { currency: "USD", minor: "250" },
    }),
    now,
    now,
  );
  insert.run(
    "dinkus-commerce",
    availability,
    "guest-hat",
    JSON.stringify({
      recordKind: "catalog-manual-availability",
      recordId: "guest-hat",
      catalogItemId: "guest-hat",
      status: "in-stock",
    }),
    now,
    now,
  );
  return { database, catalog, prices, availability };
}

function capabilityCount(database) {
  const collection = "checkout_guest_capabilities";
  return database
    .prepare("SELECT COUNT(*) AS n FROM _plugin_storage WHERE plugin_id = ? AND collection = ?")
    .get("dinkus-commerce", collection).n;
}

function cartCount(database) {
  const collection = "checkout_carts";
  return database
    .prepare("SELECT COUNT(*) AS n FROM _plugin_storage WHERE plugin_id = ? AND collection = ?")
    .get("dinkus-commerce", collection).n;
}

function writeHeaders(origin) {
  return {
    origin,
    "sec-fetch-site": "same-origin",
  };
}

test("public guest checkout routes admit same-origin JSON and fail closed without a Payments adapter", async ({
  request,
  page,
  baseURL,
}) => {
  const setup = await request.get("/_emdash/api/setup/dev-bypass");
  expect(setup.status()).toBe(200);
  const { database, catalog, prices, availability } = seedProduct(dbPath());
  const origin = new URL(baseURL).origin;
  const prepare = "/_emdash/api/plugins/dinkus-commerce/checkout/guest/prepare";
  const start = "/_emdash/api/plugins/dinkus-commerce/checkout/guest/start";
  // The Registry build has no status route: a cart read is the status check.
  const cart = "/_emdash/api/plugins/dinkus-commerce/checkout/guest/cart";
  const capture = process.env.COMMERCE_PROOF_ARTIFACTS
    ? `${process.env.COMMERCE_PROOF_ARTIFACTS}/guest-checkout-sandbox-unavailability.png`
    : undefined;
  try {
    const cross = await request.post(prepare, {
      data: {},
      headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    });
    const crossText = await cross.text();
    expect(cross.ok()).toBeFalsy();
    if (/json/i.test(cross.headers()["content-type"] ?? "")) {
      const body = JSON.parse(crossText);
      expect(body.error?.code || body.data?.error?.code).toBe("ORIGIN_DENIED");
    } else {
      expect(crossText).toMatch(/cross-orig/i);
    }
    expect(capabilityCount(database)).toBe(0);
    expect(cartCount(database)).toBe(0);

    const prepared = await request.post(prepare, {
      data: {},
      headers: writeHeaders(origin),
    });
    const preparedBody = await prepared.json();
    const payload = preparedBody.data ?? preparedBody;
    // EmDash 1.4 supplies the configured site URL to the Registry build.
    // Prepare only mints a capability; no configured Payments means start fails.
    expect(payload.ok, JSON.stringify(preparedBody)).toBeTruthy();
    expect(payload.capability?.capability, JSON.stringify(preparedBody)).toMatch(
      /^[0-9a-f-]+\.[0-9a-f]+$/i,
    );
    expect(capabilityCount(database)).toBe(1);
    expect(cartCount(database)).toBe(0);
    const missing = await request.post(start, {
      data: { contact: { email: 'guest@example.test', billing: { name: 'Bill Payer', line1: '9 Billing Way', city: 'Billtown', postalCode: '00009', country: 'US' } } },
      headers: {
        ...writeHeaders(origin),
        "x-commerce-guest-capability": payload.capability.capability,
      },
    });
    const missingBody = await missing.json();
    const missingPayload = missingBody.data ?? missingBody;
    expect(missingPayload.error?.code, JSON.stringify(missingBody)).toBe("PAYMENTS_UNAVAILABLE");
    expect(missing.headers()["set-cookie"]).toBeUndefined();
    expect(missing.headers()["cache-control"]).toMatch(/no-store/);
    expect(cartCount(database)).toBe(0);

    const tampered = await request.post(start, {
      data: { lines: [{ catalogItemId: "guest-hat", quantity: 1, price: "1" }], total: "1", paid: true },
      headers: writeHeaders(origin),
    });
    const tamperedBody = await tampered.json();
    expect(tamperedBody.data?.error?.code || tamperedBody.error?.code).toBe("INVALID_CART");

    const guessed = await request.post(cart, {
      data: {},
      headers: { ...writeHeaders(origin), "x-commerce-guest-capability": "guessed.token" },
    });
    const guessedBody = await guessed.json();
    expect(guessedBody.data?.error?.code || guessedBody.error?.code).toBe("CAPABILITY_DENIED");

    const configurations = "store_inventory_configurations";
    const inventoryRows = database
      .prepare("SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = ?")
      .all("dinkus-commerce", configurations);
    expect(inventoryRows).toHaveLength(0);

    await page.goto("/");
    if (capture) await page.screenshot({ path: capture, animations: "disabled", fullPage: true });
  } finally {
    const remove = database.prepare(
      "DELETE FROM _plugin_storage WHERE plugin_id = ? AND collection = ? AND id = ?",
    );
    remove.run("dinkus-commerce", catalog, "guest-hat");
    remove.run("dinkus-commerce", prices, "guest-hat");
    remove.run("dinkus-commerce", availability, "guest-hat");
    database.close();
  }
});
