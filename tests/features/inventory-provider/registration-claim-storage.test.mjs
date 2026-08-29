import assert from "node:assert/strict";
import test from "node:test";

import {
  ManagedSkuRegistrationError,
  createManagedSkuRegistrationClaimPort,
  createPlugin,
  identifyManagedSkuRegistrationClaimUniqueViolation,
  managedSkuRegistrationClaimUniqueIndexName,
} from "../../../dist/index.js";

function uniqueViolation(field) {
  const error = new Error(
    `UNIQUE constraint failed: index '${managedSkuRegistrationClaimUniqueIndexName(field)}'`,
  );
  error.code = "SQLITE_CONSTRAINT_UNIQUE";
  return error;
}

class MemoryClaimStorage {
  constructor(activeUniqueFields = ["claimKey", "operationId"]) {
    this.activeUniqueFields = new Set(activeUniqueFields);
    this.records = new Map();
  }

  async put(id, data) {
    for (const field of this.activeUniqueFields) {
      const collision = [...this.records.entries()].find(
        ([otherId, record]) => otherId !== id && record[field] === data[field],
      );
      if (collision) throw uniqueViolation(field);
    }
    this.records.set(id, structuredClone(data));
  }

  async delete(id) {
    return this.records.delete(id);
  }

  async query(options = {}) {
    const entries = [...this.records.entries()].filter(([, record]) =>
      Object.entries(options.where ?? {}).every(([field, value]) => record[field] === value),
    );
    return {
      items: entries.slice(0, options.limit ?? 50).map(([id, data]) => ({ id, data })),
      hasMore: entries.length > (options.limit ?? 50),
    };
  }
}

function input(operationId, overrides = {}) {
  return {
    claimKey: "claim:product-1:initial",
    catalogItemId: "product-1",
    registration: {
      operationId,
      request: {
        poolId: "pool-smoky",
        sku: "GRILL-1",
        displayNameIfNew: "Grill One",
      },
    },
    ...overrides,
  };
}

function claimRows(storage) {
  return [...storage.records.values()].filter(
    ({ recordKind }) => recordKind === "managed-sku-registration-claim",
  );
}

test("the plugin declares isolated atomic claim storage", () => {
  assert.deepEqual(createPlugin().storage.managedSkuClaims, {
    indexes: [],
    uniqueIndexes: ["claimKey", "operationId"],
  });
});

test("the claim adapter atomically returns one winner", async () => {
  const storage = new MemoryClaimStorage();
  let recordSequence = 0;
  const port = createManagedSkuRegistrationClaimPort(storage, {
    createRecordId: () => `claim-record-${++recordSequence}`,
    now: () => new Date("2026-08-29T00:00:00.000Z"),
  });

  const first = await port.claim(input("operation-left"));
  const second = await port.claim(input("operation-right"));

  assert.equal(first.outcome, "claimed");
  assert.equal(second.outcome, "existing");
  assert.equal(second.claim.operationId, "operation-left");
  assert.equal(claimRows(storage).length, 1);
  assert.equal(claimRows(storage)[0].recordId, "claim-record-1");
});

test("missing claim uniqueness fails closed before a claim row", async () => {
  for (const active of [["claimKey"], ["operationId"], []]) {
    const storage = new MemoryClaimStorage(active);
    const port = createManagedSkuRegistrationClaimPort(storage, {
      createRecordId: () => "claim-record",
      now: () => new Date("2026-08-29T00:00:00.000Z"),
    });

    await assert.rejects(
      port.claim(input("operation-left")),
      (error) =>
        error instanceof ManagedSkuRegistrationError &&
        error.code === "REGISTRATION_CLAIM_UNAVAILABLE",
    );
    assert.equal(claimRows(storage).length, 0);
  }
});

test("one operation ID cannot silently move to another claim generation", async () => {
  const storage = new MemoryClaimStorage();
  let recordSequence = 0;
  const port = createManagedSkuRegistrationClaimPort(storage, {
    createRecordId: () => `claim-record-${++recordSequence}`,
    now: () => new Date("2026-08-29T00:00:00.000Z"),
  });
  await port.claim(input("operation-shared"));

  await assert.rejects(
    port.claim(input("operation-shared", { claimKey: "claim:product-1:corrected" })),
    (error) =>
      error instanceof ManagedSkuRegistrationError &&
      error.code === "REGISTRATION_CLAIM_UNAVAILABLE",
  );
  assert.equal(claimRows(storage).length, 1);
});

test("ambiguous winner recovery fails closed", async () => {
  const storage = new MemoryClaimStorage();
  let recordSequence = 0;
  const port = createManagedSkuRegistrationClaimPort(storage, {
    createRecordId: () => `claim-record-${++recordSequence}`,
    now: () => new Date("2026-08-29T00:00:00.000Z"),
  });
  await port.claim(input("operation-left"));

  const query = storage.query.bind(storage);
  storage.query = async (options) => {
    const result = await query(options);
    if (options.where?.claimKey !== "claim:product-1:initial") return result;
    return {
      items: [result.items[0], structuredClone(result.items[0])],
      hasMore: false,
    };
  };

  await assert.rejects(
    port.claim(input("operation-right")),
    (error) =>
      error instanceof ManagedSkuRegistrationError &&
      error.code === "REGISTRATION_CLAIM_UNAVAILABLE",
  );
  assert.equal(claimRows(storage).length, 1);
});

test("only exact named claim constraints are accepted as atomic proof", () => {
  const named = Object.assign(
    new Error(
      `duplicate key value violates unique constraint "${managedSkuRegistrationClaimUniqueIndexName("claimKey")}"`,
    ),
    {
      code: "23505",
      constraint: managedSkuRegistrationClaimUniqueIndexName("claimKey"),
    },
  );
  assert.equal(identifyManagedSkuRegistrationClaimUniqueViolation(named), "claimKey");
  assert.equal(
    identifyManagedSkuRegistrationClaimUniqueViolation(new Error("UNIQUE constraint failed")),
    null,
  );
  assert.equal(
    identifyManagedSkuRegistrationClaimUniqueViolation(new Error("SQLITE_BUSY")),
    null,
  );
});
