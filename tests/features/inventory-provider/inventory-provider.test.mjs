import assert from "node:assert/strict";
import test from "node:test";

import {
  InventoryProviderBindingError,
  ManagedSkuRegistrationError,
  applyManagedSkuRegistrationResult,
  confirmExistingManagedSku,
  createInitialStockManagement,
  createManagedSkuRegistrationRequest,
  normalizeInventoryProviderBinding,
  normalizeManagedSkuRegistrationResult,
  setManageStock,
} from "../../../dist/features/inventory-provider/index.js";

function pendingRegistration(sku = "GRILL-1") {
  return {
    mode: "managed",
    status: "setup-pending",
    registration: {
      operationId: "register-grill-1",
      request: {
        poolId: "pool-1",
        sku,
        displayNameIfNew: "Smoky Grill",
      },
    },
  };
}

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
  const active = {
    mode: "managed",
    status: "active",
    inventorySkuId: "inventory-sku-1",
  };
  const disabled = setManageStock(active, false);
  assert.deepEqual(disabled, { mode: "unmanaged" });
  assert.deepEqual(active, {
    mode: "managed",
    status: "active",
    inventorySkuId: "inventory-sku-1",
  });

  const reenabled = setManageStock(disabled, true);
  assert.deepEqual(reenabled, { mode: "managed", status: "setup-required" });
  assert.equal(setManageStock(active, true), active);
});

test("registration request uses the Commerce title once and carries no stock or location", () => {
  const binding = normalizeInventoryProviderBinding({
    providerRef: "dinkuskit-inventory",
    poolId: " pool-1 ",
    defaultFulfillmentLocationId: "murphy-nc",
  });

  const request = createManagedSkuRegistrationRequest(binding, {
    sku: " GRILL-1 ",
    productTitle: "  Smoky Grill  ",
  });

  assert.deepEqual(request, {
    poolId: "pool-1",
    sku: "GRILL-1",
    displayNameIfNew: "Smoky Grill",
  });
  assert.equal("defaultFulfillmentLocationId" in request, false);
  assert.equal("locationId" in request, false);
  assert.equal("quantity" in request, false);
  assert.equal("unit" in request, false);

  for (const productTitle of [undefined, null, "   "]) {
    assert.deepEqual(
      createManagedSkuRegistrationRequest(binding, {
        sku: "GRILL-1",
        productTitle,
      }),
      {
        poolId: "pool-1",
        sku: "GRILL-1",
        displayNameIfNew: "GRILL-1",
      },
    );
  }
});

test("registration requests fail closed on malformed identities or titles", () => {
  const binding = {
    providerRef: "dinkuskit-inventory",
    poolId: "pool-1",
    defaultFulfillmentLocationId: "murphy-nc",
  };

  for (const input of [
    null,
    {},
    { sku: "" },
    { sku: 7 },
    { sku: "GRILL-1", productTitle: 7 },
  ]) {
    assert.throws(
      () => createManagedSkuRegistrationRequest(binding, input),
      (error) =>
        error instanceof ManagedSkuRegistrationError &&
        error.code === "INVALID_REGISTRATION",
    );
  }
});

test("registration results retain only the provider-neutral Inventory SKU identity", () => {
  assert.deepEqual(
    normalizeManagedSkuRegistrationResult({
      outcome: "registered",
      commandId: "register-grill-1",
      inventorySku: {
        inventorySkuId: " inventory-sku-1 ",
        sku: " GRILL-1 ",
        displayName: " Smoky Grill ",
        quantity: 99,
      },
      accessToken: "must-not-survive",
    }),
    {
      outcome: "registered",
      inventorySku: {
        inventorySkuId: "inventory-sku-1",
        sku: "GRILL-1",
        displayName: "Smoky Grill",
      },
    },
  );

  assert.deepEqual(
    normalizeManagedSkuRegistrationResult({
      outcome: "rejected",
      commandId: "register-grill-1",
      code: " command_id_conflict ",
      message: " The command ID is already bound to different contents. ",
      providerTrace: "must-not-survive",
    }),
    {
      outcome: "rejected",
      code: "command_id_conflict",
      message: "The command ID is already bound to different contents.",
    },
  );

  for (const result of [
    null,
    {},
    { outcome: "unknown", inventorySku: {} },
    {
      outcome: "existing",
      inventorySku: { inventorySkuId: "", sku: "GRILL-1", displayName: "Grill" },
    },
    {
      outcome: "existing",
      inventorySku: {
        inventorySkuId: "inventory-sku-1",
        sku: "",
        displayName: "Grill",
      },
    },
    {
      outcome: "existing",
      inventorySku: {
        inventorySkuId: "inventory-sku-1",
        sku: "GRILL-1",
        displayName: "",
      },
    },
  ]) {
    assert.throws(
      () => normalizeManagedSkuRegistrationResult(result),
      (error) =>
        error instanceof ManagedSkuRegistrationError &&
        error.code === "INVALID_REGISTRATION",
    );
  }
});

test("a newly registered SKU activates only its permanent Inventory identity", () => {
  assert.deepEqual(
    applyManagedSkuRegistrationResult(
      pendingRegistration(),
      {
        outcome: "registered",
        inventorySku: {
          inventorySkuId: "inventory-sku-1",
          sku: "GRILL-1",
          displayName: "Smoky Grill",
        },
      },
    ),
    {
      mode: "managed",
      status: "active",
      inventorySkuId: "inventory-sku-1",
    },
  );
});

test("an existing pooled SKU requires review before its permanent identity activates", () => {
  const needsReview = applyManagedSkuRegistrationResult(
    pendingRegistration(),
    {
      outcome: "existing",
      inventorySku: {
        inventorySkuId: "inventory-sku-1",
        sku: "GRILL-1",
        displayName: "Inventory Grill",
      },
    },
  );

  assert.deepEqual(needsReview, {
    mode: "managed",
    status: "needs-review",
    candidate: {
      inventorySkuId: "inventory-sku-1",
      sku: "GRILL-1",
      displayName: "Inventory Grill",
    },
  });
  assert.deepEqual(confirmExistingManagedSku(needsReview), {
    mode: "managed",
    status: "active",
    inventorySkuId: "inventory-sku-1",
  });
});

test("existing SKU confirmation rejects malformed persisted candidates", () => {
  for (const candidate of [
    undefined,
    {},
    { inventorySkuId: "", sku: "GRILL-1", displayName: "Inventory Grill" },
    { inventorySkuId: "inventory-sku-1", sku: "", displayName: "Inventory Grill" },
    { inventorySkuId: "inventory-sku-1", sku: "GRILL-1", displayName: "" },
  ]) {
    assert.throws(
      () =>
        confirmExistingManagedSku({
          mode: "managed",
          status: "needs-review",
          candidate,
        }),
      (error) =>
        error instanceof ManagedSkuRegistrationError &&
        error.code === "INVALID_REGISTRATION",
    );
  }
});

test("registration rejects wrong-SKU and out-of-order state transitions", () => {
  const result = {
    outcome: "registered",
    inventorySku: {
      inventorySkuId: "inventory-sku-1",
      sku: "OTHER-SKU",
      displayName: "Other Grill",
    },
  };

  for (const operation of [
    () =>
      applyManagedSkuRegistrationResult(
        pendingRegistration(),
        result,
      ),
    () => applyManagedSkuRegistrationResult({ mode: "unmanaged" }, result),
    () =>
      applyManagedSkuRegistrationResult(
        {
          mode: "managed",
          status: "active",
          inventorySkuId: "inventory-sku-1",
        },
        result,
      ),
    () => confirmExistingManagedSku({ mode: "managed", status: "setup-required" }),
  ]) {
    assert.throws(
      operation,
      (error) =>
        error instanceof ManagedSkuRegistrationError &&
        error.code === "INVALID_TRANSITION",
    );
  }
});
