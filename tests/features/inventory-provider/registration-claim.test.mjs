import assert from "node:assert/strict";
import test from "node:test";

import {
  ManagedSkuRegistrationError,
  createConcurrentManagedSkuRegistrationFeedback,
  createManagedSkuRegistrationUnavailableFeedback,
  createManagedSkuRegistrationClaimKey,
  startManagedSkuRegistration,
} from "../../../dist/features/inventory-provider/index.js";

const smokyBinding = {
  providerRef: "inventory",
  poolId: "pool-smoky",
  defaultFulfillmentLocationId: "murphy-nc",
};

const setupRequired = { mode: "managed", status: "setup-required" };

function makeClaimPort() {
  const claims = new Map();
  return {
    claims,
    async claim(input) {
      const existing = claims.get(input.claimKey);
      if (existing) return { outcome: "existing", claim: structuredClone(existing) };

      const claim = {
        recordKind: "managed-sku-registration-claim",
        recordId: `record:${input.registration.operationId}`,
        claimKey: input.claimKey,
        catalogItemId: input.catalogItemId,
        operationId: input.registration.operationId,
        request: structuredClone(input.registration.request),
        createdAt: "2026-08-29T00:00:00.000Z",
      };
      claims.set(input.claimKey, claim);
      return { outcome: "claimed", claim: structuredClone(claim) };
    },
  };
}

function execution({ claimPort, operationId, poolProvider, persisted }) {
  return {
    catalogItemId: "product-1",
    claimKey: createManagedSkuRegistrationClaimKey({ catalogItemId: "product-1" }),
    claim: claimPort.claim.bind(claimPort),
    createOperationId: () => operationId,
    persist: async (state) => persisted.push(structuredClone(state)),
    provider: poolProvider,
  };
}

test("simultaneous first registrations converge on one operation and one provider call", async () => {
  const claimPort = makeClaimPort();
  const persisted = [];
  const providerOperations = [];
  const provider = {
    async registerManagedSku(registration) {
      providerOperations.push(registration.operationId);
      return {
        outcome: "registered",
        inventorySku: {
          inventorySkuId: "inventory-sku-1",
          sku: registration.request.sku,
          displayName: registration.request.displayNameIfNew,
        },
      };
    },
  };

  const results = await Promise.all([
    startManagedSkuRegistration(
      setupRequired,
      smokyBinding,
      { sku: "GRILL-1", productTitle: "Grill One" },
      execution({ claimPort, operationId: "operation-left", poolProvider: provider, persisted }),
    ),
    startManagedSkuRegistration(
      setupRequired,
      smokyBinding,
      { sku: "GRILL-1", productTitle: "Grill One" },
      execution({ claimPort, operationId: "operation-right", poolProvider: provider, persisted }),
    ),
  ]);

  assert.equal(claimPort.claims.size, 1);
  assert.deepEqual(providerOperations, ["operation-left"]);
  assert.equal(results.filter(({ outcome }) => outcome === "started").length, 1);
  const joined = results.find(({ outcome }) => outcome === "already-claimed");
  assert.equal(joined.sameRequest, true);
  assert.equal(joined.state.status, "setup-pending");
  assert.equal(joined.state.registration.operationId, "operation-left");
});

test("a different-pool contender keeps the winning pool and makes no second provider call", async () => {
  const claimPort = makeClaimPort();
  const persisted = [];
  let providerCalls = 0;
  const provider = {
    async registerManagedSku(registration) {
      providerCalls += 1;
      return {
        outcome: "registered",
        inventorySku: {
          inventorySkuId: "inventory-sku-1",
          sku: registration.request.sku,
          displayName: registration.request.displayNameIfNew,
        },
      };
    },
  };
  const beansBinding = { ...smokyBinding, poolId: "pool-beans" };

  const [, joined] = await Promise.all([
    startManagedSkuRegistration(
      setupRequired,
      smokyBinding,
      { sku: "GRILL-1", productTitle: "Grill One" },
      execution({ claimPort, operationId: "operation-smoky", poolProvider: provider, persisted }),
    ),
    startManagedSkuRegistration(
      setupRequired,
      beansBinding,
      { sku: "GRILL-1", productTitle: "Grill One" },
      execution({ claimPort, operationId: "operation-beans", poolProvider: provider, persisted }),
    ),
  ]);

  assert.equal(providerCalls, 1);
  assert.equal(joined.outcome, "already-claimed");
  assert.equal(joined.sameRequest, false);
  assert.equal(joined.state.registration.operationId, "operation-smoky");
  assert.equal(joined.state.registration.request.poolId, "pool-smoky");
});

test("unavailable atomic authority leaves state untouched and never contacts Inventory", async () => {
  let persistCalls = 0;
  let providerCalls = 0;

  await assert.rejects(
    startManagedSkuRegistration(
      setupRequired,
      smokyBinding,
      { sku: "GRILL-1", productTitle: "Grill One" },
      {
        catalogItemId: "product-1",
        claimKey: createManagedSkuRegistrationClaimKey({ catalogItemId: "product-1" }),
        claim: async () => {
          throw new ManagedSkuRegistrationError(
            "REGISTRATION_CLAIM_UNAVAILABLE",
            "registration claim authority unavailable",
          );
        },
        createOperationId: () => "operation-unavailable",
        persist: async () => {
          persistCalls += 1;
        },
        provider: {
          async registerManagedSku() {
            providerCalls += 1;
            throw new Error("must not run");
          },
        },
      },
    ),
    (error) =>
      error instanceof ManagedSkuRegistrationError &&
      error.code === "REGISTRATION_CLAIM_UNAVAILABLE",
  );

  assert.equal(persistCalls, 0);
  assert.equal(providerCalls, 0);
  assert.deepEqual(setupRequired, { mode: "managed", status: "setup-required" });
});

test("a malformed claimed winner fails closed before Commerce persistence or Inventory contact", async () => {
  let persistCalls = 0;
  let providerCalls = 0;

  await assert.rejects(
    startManagedSkuRegistration(
      setupRequired,
      smokyBinding,
      { sku: "GRILL-1", productTitle: "Grill One" },
      {
        catalogItemId: "product-1",
        claimKey: createManagedSkuRegistrationClaimKey({ catalogItemId: "product-1" }),
        claim: async (input) => ({
          outcome: "claimed",
          claim: {
            recordKind: "managed-sku-registration-claim",
            recordId: "claim-record",
            claimKey: input.claimKey,
            catalogItemId: input.catalogItemId,
            operationId: "different-operation",
            request: input.registration.request,
            createdAt: "2026-08-29T00:00:00.000Z",
          },
        }),
        createOperationId: () => "proposed-operation",
        persist: async () => {
          persistCalls += 1;
        },
        provider: {
          async registerManagedSku() {
            providerCalls += 1;
            throw new Error("must not run");
          },
        },
      },
    ),
    (error) =>
      error instanceof ManagedSkuRegistrationError &&
      error.code === "REGISTRATION_CLAIM_UNAVAILABLE",
  );

  assert.equal(persistCalls, 0);
  assert.equal(providerCalls, 0);
});

test("a corrected rejection receives a distinct append-only claim generation", () => {
  const initial = createManagedSkuRegistrationClaimKey({ catalogItemId: "product-1" });
  const corrected = createManagedSkuRegistrationClaimKey({
    catalogItemId: "product-1",
    rejectedOperationId: "operation-rejected",
  });

  assert.notEqual(initial, corrected);
  assert.equal(
    corrected,
    JSON.stringify(["managed-sku-registration", "product-1", "after-rejection", "operation-rejected"]),
  );
});

test("concurrent registration feedback names the pool and exposes Refresh status", () => {
  assert.deepEqual(
    createConcurrentManagedSkuRegistrationFeedback("pending", "Smoky Pool"),
    {
      message:
        "This product is already being connected to Smoky Pool in another session. Refresh to check its status.",
      actionLabel: "Refresh status",
    },
  );
  assert.deepEqual(
    createConcurrentManagedSkuRegistrationFeedback("complete", "Smoky Pool"),
    {
      message:
        "This product was connected to Smoky Pool in another session. Refresh to review its inventory settings.",
      actionLabel: "Refresh status",
    },
  );
});

test("unavailable feedback preserves the locked copy and invalid feedback is not a storage outage", () => {
  assert.deepEqual(createManagedSkuRegistrationUnavailableFeedback(), {
    message: "Inventory setup is temporarily unavailable. Please try again.",
  });
  assert.throws(
    () => createConcurrentManagedSkuRegistrationFeedback("pending", " "),
    (error) =>
      error instanceof ManagedSkuRegistrationError &&
      error.code === "INVALID_REGISTRATION",
  );
});
