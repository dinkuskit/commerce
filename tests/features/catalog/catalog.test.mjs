import assert from "node:assert/strict";
import test from "node:test";
import { PluginRouteError } from "emdash";

import {
  CatalogError,
  catalogUniqueIndexName,
  createPlugin,
  createCatalogItem,
  dinkusCommerce,
  identifyConfirmedUniqueViolation,
  normalizeSku,
} from "../../../dist/index.js";

const commercePlugin = createPlugin();

function uniqueViolation(field) {
  const error = new Error(
    `UNIQUE constraint failed: index '${catalogUniqueIndexName(field)}'`,
  );
  error.code = "SQLITE_CONSTRAINT_UNIQUE";
  return error;
}

class MemoryCatalogStorage {
  constructor(activeUniqueFields = ["commandId", "skuKey"]) {
    this.activeUniqueFields = new Set(activeUniqueFields);
    this.records = new Map();
    this.puts = [];
  }

  async put(id, data) {
    for (const field of this.activeUniqueFields) {
      const collision = [...this.records.entries()].find(
        ([otherId, record]) => otherId !== id && record[field] === data[field],
      );
      if (collision) throw uniqueViolation(field);
    }
    this.records.set(id, structuredClone(data));
    this.puts.push({ id, data: structuredClone(data) });
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

async function rejectsWithCode(promise, code) {
  await assert.rejects(promise, (error) => error instanceof CatalogError && error.code === code);
}

test("SKU canonicalization is site-wide, ASCII-only, and hyphen-segmented", () => {
  assert.equal(normalizeSku("  grill-42  "), "GRILL-42");
  for (const invalid of ["", "GRILL_42", "GRILL.42", "GRILL 42", "-GRILL", "GRILL-", "A--B", "gríll"]) {
    assert.throws(() => normalizeSku(invalid), (error) => error.code === "INVALID_INPUT");
  }
});

test("one command writes one complete draft row and a retry returns the original", async () => {
  const storage = new MemoryCatalogStorage();
  const input = { commandId: "cmd:grill-42", name: "  Grill 42  ", sku: " grill-42 " };
  const first = await createCatalogItem(storage, input, {
    createId: () => "item-1",
    now: () => new Date("2026-08-28T00:00:00.000Z"),
  });
  const retry = await createCatalogItem(storage, input, { createId: () => "must-not-be-used" });

  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.deepEqual(retry.item, first.item);
  assert.deepEqual(first.item, {
    recordKind: "catalog-item",
    itemId: "item-1",
    commandId: "cmd:grill-42",
    creationIntent: { manageStock: false },
    kind: "simple-product",
    name: "Grill 42",
    sku: "GRILL-42",
    skuKey: "GRILL-42",
    stockManagement: { mode: "unmanaged" },
    state: "draft",
    createdAt: "2026-08-28T00:00:00.000Z",
  });
  assert.equal(storage.puts.filter(({ data }) => data.recordKind === "catalog-item").length, 1);
  assert.equal(storage.records.size, 1);
  assert.deepEqual([...storage.records.values()], [first.item]);
});

test("an existing pre-policy row replays as explicitly unmanaged", async () => {
  const storage = new MemoryCatalogStorage();
  storage.records.set("legacy-item", {
    recordKind: "catalog-item",
    itemId: "legacy-item",
    commandId: "cmd:legacy",
    kind: "simple-product",
    name: "Legacy Grill",
    sku: "LEGACY-GRILL",
    skuKey: "LEGACY-GRILL",
    state: "draft",
    createdAt: "2026-08-27T00:00:00.000Z",
  });

  const replay = await createCatalogItem(storage, {
    commandId: "cmd:legacy",
    name: "Legacy Grill",
    sku: "LEGACY-GRILL",
  });

  assert.equal(replay.created, false);
  assert.deepEqual(replay.item.stockManagement, { mode: "unmanaged" });
  assert.equal(
    storage.puts.filter(({ data }) => data.recordKind === "catalog-item").length,
    0,
  );
});

test("managed catalog creation persists setup-required intent without a quantity", async () => {
  const storage = new MemoryCatalogStorage();
  const result = await createCatalogItem(
    storage,
    {
      commandId: "cmd:managed",
      name: "Managed Grill",
      sku: "MANAGED-GRILL",
      manageStock: true,
    },
    {
      createId: () => "item-managed",
      now: () => new Date("2026-08-28T00:00:00.000Z"),
    },
  );

  assert.deepEqual(result.item.stockManagement, {
    mode: "managed",
    status: "setup-required",
  });
  assert.deepEqual(result.item.creationIntent, { manageStock: true });
  assert.equal("quantity" in result.item, false);
  assert.equal("stockQuantity" in result.item, false);
});

test("manageStock must be a boolean when supplied", async () => {
  const storage = new MemoryCatalogStorage();
  await rejectsWithCode(
    createCatalogItem(storage, {
      commandId: "cmd:invalid-managed",
      name: "Invalid Managed Grill",
      sku: "INVALID-MANAGED-GRILL",
      manageStock: "yes",
    }),
    "INVALID_INPUT",
  );
  assert.equal(storage.records.size, 0);
});

test("a reused command with changed input is a command conflict", async () => {
  const storage = new MemoryCatalogStorage();
  await createCatalogItem(
    storage,
    { commandId: "cmd:one", name: "First", sku: "FIRST" },
    { createId: () => "item-1" },
  );
  await rejectsWithCode(
    createCatalogItem(storage, { commandId: "cmd:one", name: "Changed", sku: "SECOND" }),
    "COMMAND_CONFLICT",
  );
});

test("a reused command cannot change managed-stock intent", async () => {
  const storage = new MemoryCatalogStorage();
  await createCatalogItem(
    storage,
    { commandId: "cmd:stock-intent", name: "First", sku: "STOCK-INTENT" },
    { createId: () => "item-1" },
  );
  await rejectsWithCode(
    createCatalogItem(storage, {
      commandId: "cmd:stock-intent",
      name: "First",
      sku: "STOCK-INTENT",
      manageStock: true,
    }),
    "COMMAND_CONFLICT",
  );
});

test("a managed create retry remains idempotent after stock setup advances", async () => {
  const storage = new MemoryCatalogStorage();
  storage.records.set("managed-item", {
    recordKind: "catalog-item",
    itemId: "managed-item",
    commandId: "cmd:managed-active",
    creationIntent: { manageStock: true },
    kind: "simple-product",
    name: "Managed Active",
    sku: "MANAGED-ACTIVE",
    skuKey: "MANAGED-ACTIVE",
    stockManagement: { mode: "managed", status: "active" },
    state: "draft",
    createdAt: "2026-08-28T00:00:00.000Z",
  });

  const replay = await createCatalogItem(storage, {
    commandId: "cmd:managed-active",
    name: "Managed Active",
    sku: "MANAGED-ACTIVE",
    manageStock: true,
  });

  assert.equal(replay.created, false);
  assert.deepEqual(replay.item.stockManagement, { mode: "managed", status: "active" });
});

test("distinct commands cannot claim the same canonical SKU", async () => {
  const storage = new MemoryCatalogStorage();
  await createCatalogItem(
    storage,
    { commandId: "cmd:one", name: "First", sku: "shared-sku" },
    { createId: () => "item-1" },
  );
  await rejectsWithCode(
    createCatalogItem(storage, { commandId: "cmd:two", name: "Second", sku: "SHARED-SKU" }),
    "SKU_CONFLICT",
  );
});

test("creation fails closed before a product write when either unique index is absent", async () => {
  for (const active of [["commandId"], ["skuKey"], []]) {
    const storage = new MemoryCatalogStorage(active);
    await rejectsWithCode(
      createCatalogItem(storage, { commandId: "cmd:one", name: "First", sku: "FIRST" }),
      "STORAGE_CONSTRAINTS_UNAVAILABLE",
    );
    assert.deepEqual([...storage.records.values()], []);
  }
});

test("creation fails closed when an integrity probe cannot be cleaned up", async () => {
  const storage = new MemoryCatalogStorage();
  storage.delete = async () => {
    throw new Error("probe delete unavailable");
  };

  await rejectsWithCode(
    createCatalogItem(storage, { commandId: "cmd:one", name: "First", sku: "FIRST" }),
    "STORAGE_CONSTRAINTS_UNAVAILABLE",
  );
  assert.equal(
    [...storage.records.values()].filter((record) => record.recordKind === "catalog-item").length,
    0,
  );
});

test("only an exact named unique violation is classified as atomic proof", () => {
  const d1 = new Error(
    `D1_ERROR: UNIQUE constraint failed: index '${catalogUniqueIndexName("skuKey")}' at offset 7: SQLITE_CONSTRAINT`,
  );
  assert.equal(identifyConfirmedUniqueViolation(d1), "skuKey");

  const postgres = Object.assign(
    new Error(
      `duplicate key value violates unique constraint "${catalogUniqueIndexName("commandId")}"`,
    ),
    { code: "23505", constraint: catalogUniqueIndexName("commandId") },
  );
  assert.equal(identifyConfirmedUniqueViolation(postgres), "commandId");
  assert.equal(identifyConfirmedUniqueViolation(new Error("SQLITE_BUSY")), null);
  assert.equal(identifyConfirmedUniqueViolation(new Error("UNIQUE constraint failed")), null);
});

test("the EmDash plugin exposes one private, permissioned create route and both unique declarations", () => {
  assert.deepEqual(dinkusCommerce(), {
    id: "dinkus-commerce",
    version: "0.0.0",
    entrypoint: "@dinkuskit/commerce",
  });
  assert.equal(commercePlugin.id, "dinkus-commerce");
  assert.deepEqual(commercePlugin.storage.catalogItems, {
    indexes: [],
    uniqueIndexes: ["commandId", "skuKey"],
  });
  const route = commercePlugin.routes["catalog-items/create"];
  assert.equal(route.public, undefined);
  assert.equal(route.permission, "content:create");
});

test("the route rejects alternate methods and delegates POST to the catalog application", async () => {
  const storage = new MemoryCatalogStorage();
  const route = commercePlugin.routes["catalog-items/create"];
  const baseContext = {
    input: { commandId: "cmd:route", name: "Route Grill", sku: "ROUTE-GRILL" },
    storage: { catalogItems: storage },
  };

  await assert.rejects(
    route.handler({
      ...baseContext,
      request: new Request("https://example.test/catalog-items/create", { method: "GET" }),
    }),
    (error) =>
      error instanceof PluginRouteError &&
      error.code === "METHOD_NOT_ALLOWED" &&
      error.status === 405,
  );

  const result = await route.handler({
    ...baseContext,
    request: new Request("https://example.test/catalog-items/create", { method: "POST" }),
  });
  assert.equal(result.created, true);
  assert.equal(result.item.sku, "ROUTE-GRILL");
});
