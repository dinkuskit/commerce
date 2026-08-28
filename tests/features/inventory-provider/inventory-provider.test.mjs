import assert from "node:assert/strict";
import test from "node:test";

import {
  InventoryProviderBindingError,
  createInitialStockManagement,
  normalizeInventoryProviderBinding,
  setManageStock,
} from "../../../dist/features/inventory-provider/index.js";

test("the provider binding retains only opaque provider, pool, and default-location identities", () => {
  assert.deepEqual(
    normalizeInventoryProviderBinding({
      providerRef: " dinkuskit-inventory ",
      poolId: " pool-1 ",
      defaultFulfillmentLocationId: " location-1 ",
      accessToken: "must-not-survive",
      quantity: 42,
    }),
    {
      providerRef: "dinkuskit-inventory",
      poolId: "pool-1",
      defaultFulfillmentLocationId: "location-1",
    },
  );
});

test("the provider binding rejects missing, blank, and non-string identities", () => {
  for (const input of [
    null,
    {},
    { providerRef: "", poolId: "pool-1", defaultFulfillmentLocationId: "location-1" },
    { providerRef: "inventory", poolId: 1, defaultFulfillmentLocationId: "location-1" },
    { providerRef: "inventory", poolId: "pool-1", defaultFulfillmentLocationId: "   " },
  ]) {
    assert.throws(
      () => normalizeInventoryProviderBinding(input),
      (error) =>
        error instanceof InventoryProviderBindingError && error.code === "INVALID_BINDING",
    );
  }
});

test("managed intent starts fail-closed and contains no local quantity", () => {
  const policy = createInitialStockManagement(true);
  assert.deepEqual(policy, { mode: "managed", status: "setup-required" });
  assert.equal("quantity" in policy, false);
  assert.deepEqual(createInitialStockManagement(false), { mode: "unmanaged" });
});

test("disabling management is Commerce-only and re-enabling requires fresh setup", () => {
  const active = { mode: "managed", status: "active" };
  const disabled = setManageStock(active, false);
  assert.deepEqual(disabled, { mode: "unmanaged" });
  assert.deepEqual(active, { mode: "managed", status: "active" });

  const reenabled = setManageStock(disabled, true);
  assert.deepEqual(reenabled, { mode: "managed", status: "setup-required" });
  assert.equal(setManageStock(active, true), active);
});
