import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";

function dbPath() {
  const native = test.info().project.name === "native";
  const url = native ? process.env.COMMERCE_NATIVE_DB : process.env.COMMERCE_PROOF_DB;
  if (!url) throw new Error("missing commerce proof database");
  return { native, filename: url.replace(/^file:/, "") };
}

function seedProduct(filename, native) {
  const database = new Database(filename);
  const now = "2026-09-30T00:00:00.000Z";
  const catalog = native ? "catalogItems" : "catalog_items";
  const prices = native ? "catalogPrices" : "catalog_prices";
  const availability = native ? "catalogManualAvailability" : "catalog_manual_availability";
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

test("public guest checkout routes admit same-origin JSON and fail closed without a Payments adapter", async ({
  request,
  page,
}) => {
  const setup = await request.get("/_emdash/api/setup/dev-bypass");
  expect(setup.status()).toBe(200);
  const { native, filename } = dbPath();
  const { database, catalog, prices, availability } = seedProduct(filename, native);
  const start = "/_emdash/api/plugins/dinkus-commerce/checkout/guest/start";
  const status = "/_emdash/api/plugins/dinkus-commerce/checkout/guest/status";
  const capture = process.env.COMMERCE_PROOF_ARTIFACTS
    ? `${process.env.COMMERCE_PROOF_ARTIFACTS}/guest-checkout-${native ? "native" : "sandbox"}-unavailability.png`
    : undefined;
  try {
    const missing = await request.post(start, {
      data: { lines: [{ catalogItemId: "guest-hat", quantity: 1 }] },
    });
    const missingBody = await missing.json();
    if (native) {
      expect(missing.status()).toBe(503);
      expect(missingBody.error?.code).toBe("PAYMENTS_UNAVAILABLE");
    } else {
      expect(missing.ok()).toBeTruthy();
      expect(missingBody.data?.ok).toBe(false);
      expect(missingBody.data?.error?.code).toBe("PAYMENTS_UNAVAILABLE");
    }
    expect(missing.headers()["set-cookie"]).toBeUndefined();
    expect(missing.headers()["cache-control"]).toMatch(/no-store/);

    const tampered = await request.post(start, {
      data: { lines: [{ catalogItemId: "guest-hat", quantity: 1, price: "1" }], total: "1", paid: true },
    });
    if (native) {
      expect(tampered.status()).toBe(400);
    } else {
      const body = await tampered.json();
      expect(body.data?.error?.code || body.error?.code).toBe("INVALID_CART");
    }

    const guessed = await request.post(status, {
      data: { cartId: "guessed", attemptId: "guessed", paid: true },
      headers: { "x-commerce-guest-capability": "guessed.token" },
    });
    if (native) {
      expect(guessed.status()).toBe(403);
    } else {
      const body = await guessed.json();
      expect(body.data?.error?.code || body.error?.code).toBe("CAPABILITY_DENIED");
    }

    const configurations = native ? "storeInventoryConfigurations" : "store_inventory_configurations";
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
