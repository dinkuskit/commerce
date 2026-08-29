import assert from "node:assert/strict";
import test from "node:test";

import {
  ManagedSkuRegistrationError,
  confirmExistingManagedSku,
  normalizeStoredStockManagement,
  retryManagedSkuRegistration,
  startManagedSkuRegistration,
} from "../../../dist/features/inventory-provider/index.js";

const binding = Object.freeze({
  providerRef: "dinkuskit-inventory",
  poolId: "pool-1",
  defaultFulfillmentLocationId: "murphy-nc",
});

const input = Object.freeze({
  sku: "GRILL-1",
  productTitle: "Smoky Grill",
});

const expectedRegistration = Object.freeze({
  operationId: "register-grill-1",
  request: {
    poolId: "pool-1",
    sku: "GRILL-1",
    displayNameIfNew: "Smoky Grill",
  },
});

function clone(value) {
  return structuredClone(value);
}

test("an ambiguous first call persists one retryable operation before contacting Inventory", async () => {
  const timeline = [];
  const unavailable = new Error("inventory unavailable");

  await assert.rejects(
    startManagedSkuRegistration(
      { mode: "managed", status: "setup-required" },
      binding,
      input,
      {
        createOperationId: () => "register-grill-1",
        persist: async (state) => timeline.push(["persist", clone(state)]),
        provider: {
          registerManagedSku: async (registration) => {
            timeline.push(["provider", clone(registration)]);
            throw unavailable;
          },
        },
      },
    ),
    unavailable,
  );

  assert.deepEqual(timeline, [
    [
      "persist",
      {
        mode: "managed",
        status: "setup-pending",
        registration: expectedRegistration,
      },
    ],
    ["provider", expectedRegistration],
  ]);
});

test("a pending operation survives reload and an explicit retry reuses its identity", async () => {
  const stored = normalizeStoredStockManagement({
    mode: "managed",
    status: "setup-pending",
    registration: expectedRegistration,
  });
  const timeline = [];

  const result = await retryManagedSkuRegistration(stored, {
    persist: async (state) => timeline.push(["persist", clone(state)]),
    provider: {
      registerManagedSku: async (registration) => {
        timeline.push(["provider", clone(registration)]);
        return {
          outcome: "registered",
          inventorySku: {
            inventorySkuId: "inventory-sku-1",
            sku: "GRILL-1",
            displayName: "Smoky Grill",
          },
        };
      },
    },
  });

  assert.deepEqual(result, {
    mode: "managed",
    status: "active",
    inventorySkuId: "inventory-sku-1",
  });
  assert.deepEqual(timeline, [
    ["persist", stored],
    ["provider", expectedRegistration],
    ["persist", result],
  ]);
});

test("a genuine existing SKU still waits for explicit confirmation", async () => {
  const persisted = [];
  const result = await startManagedSkuRegistration(
    { mode: "managed", status: "setup-required" },
    binding,
    input,
    {
      createOperationId: () => "register-grill-1",
      persist: async (state) => persisted.push(clone(state)),
      provider: {
        registerManagedSku: async () => ({
          outcome: "existing",
          inventorySku: {
            inventorySkuId: "inventory-sku-existing",
            sku: "GRILL-1",
            displayName: "Inventory Grill",
          },
        }),
      },
    },
  );

  assert.deepEqual(result, {
    mode: "managed",
    status: "needs-review",
    candidate: {
      inventorySkuId: "inventory-sku-existing",
      sku: "GRILL-1",
      displayName: "Inventory Grill",
    },
  });
  assert.deepEqual(confirmExistingManagedSku(result), {
    mode: "managed",
    status: "active",
    inventorySkuId: "inventory-sku-existing",
  });
  assert.equal(persisted.at(-1).status, "needs-review");
});

test("a definitive rejection needs attention and corrected resubmission uses a new operation", async () => {
  const persisted = [];
  const rejected = await startManagedSkuRegistration(
    { mode: "managed", status: "setup-required" },
    binding,
    input,
    {
      createOperationId: () => "register-grill-1",
      persist: async (state) => persisted.push(clone(state)),
      provider: {
        registerManagedSku: async () => ({
          outcome: "rejected",
          code: "command_id_conflict",
          message: "The command ID is already bound to different contents.",
        }),
      },
    },
  );

  assert.deepEqual(rejected, {
    mode: "managed",
    status: "setup-needs-attention",
    registration: expectedRegistration,
    rejection: {
      code: "command_id_conflict",
      message: "The command ID is already bound to different contents.",
    },
  });
  assert.deepEqual(normalizeStoredStockManagement(rejected), rejected);

  const registrations = [];
  const corrected = await startManagedSkuRegistration(rejected, binding, input, {
    createOperationId: () => "register-grill-1-corrected",
    persist: async (state) => persisted.push(clone(state)),
    provider: {
      registerManagedSku: async (registration) => {
        registrations.push(clone(registration));
        return {
          outcome: "registered",
          inventorySku: {
            inventorySkuId: "inventory-sku-corrected",
            sku: "GRILL-1",
            displayName: "Smoky Grill",
          },
        };
      },
    },
  });

  assert.equal(registrations[0].operationId, "register-grill-1-corrected");
  assert.deepEqual(corrected, {
    mode: "managed",
    status: "active",
    inventorySkuId: "inventory-sku-corrected",
  });

  let providerCalled = false;
  await assert.rejects(
    startManagedSkuRegistration(rejected, binding, input, {
      createOperationId: () => "register-grill-1",
      persist: async () => assert.fail("reused operation must not be persisted"),
      provider: {
        registerManagedSku: async () => {
          providerCalled = true;
        },
      },
    }),
    (error) =>
      error instanceof ManagedSkuRegistrationError && error.code === "INVALID_TRANSITION",
  );
  assert.equal(providerCalled, false);
});

test("malformed provider output leaves the persisted operation pending", async () => {
  const persisted = [];
  await assert.rejects(
    startManagedSkuRegistration(
      { mode: "managed", status: "setup-required" },
      binding,
      input,
      {
        createOperationId: () => "register-grill-1",
        persist: async (state) => persisted.push(clone(state)),
        provider: {
          registerManagedSku: async () => ({ outcome: "registered" }),
        },
      },
    ),
    (error) =>
      error instanceof ManagedSkuRegistrationError &&
      error.code === "INVALID_REGISTRATION",
  );

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].status, "setup-pending");
  assert.equal(persisted[0].registration.operationId, "register-grill-1");
});

test("malformed persisted attempts fail safe to setup-required", () => {
  for (const state of [
    { mode: "managed", status: "setup-pending" },
    {
      mode: "managed",
      status: "setup-pending",
      registration: { operationId: "", request: {} },
    },
    {
      mode: "managed",
      status: "setup-needs-attention",
      registration: expectedRegistration,
      rejection: { code: "", message: "bad" },
    },
  ]) {
    assert.deepEqual(normalizeStoredStockManagement(state), {
      mode: "managed",
      status: "setup-required",
    });
  }
});
