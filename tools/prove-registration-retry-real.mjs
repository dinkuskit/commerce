import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import {
  createCatalogItem,
  retryManagedSkuRegistration,
  startManagedSkuRegistration,
} from "../dist/index.js";
import {
  initializeCatalogDatabase,
  openCatalogRepository,
  readCatalogItems,
} from "../tests/integration/sqlite-fixture.mjs";

const EXPECTED_INVENTORY_HEAD = "670c539303ba77db916f50012070bdd83ead4e4e";
const SITE_ID = "site_registration_retry_proof";
const POOL_ID = "pool_registration_retry_proof";
const ITEM_ID = "catalog_registration_retry_proof";
const INVENTORY_SKU_ID = "inventory_registration_retry_proof";
const OPERATION_ID = "cmd_registration_retry_proof";
const SKU = "RETRY-PROOF-SKU";

function usage() {
  return "Usage: npm run proof:registration-retry:real -- <exact-inventory-pr12-worktree>";
}

function exactInventoryRoot(rawPath) {
  if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
    throw new Error(usage());
  }
  const root = resolve(rawPath);
  if (!isAbsolute(root)) throw new Error("Inventory worktree path must resolve absolutely");

  const result = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error("Inventory worktree identity could not be read");
  assert.equal(
    result.stdout.trim(),
    EXPECTED_INVENTORY_HEAD,
    "Inventory worktree must be the exact reviewed PR #12 head",
  );
  return root;
}

async function importInventory(root) {
  const featureUrl = pathToFileURL(join(root, "src/index.ts")).href;
  const storageUrl = pathToFileURL(join(root, "src/storage/local-sqlite-test-store.ts")).href;
  const [{ createRegisterManagedSku }, { createLocalSqliteTestStore }] = await Promise.all([
    import(featureUrl),
    import(storageUrl),
  ]);
  return { createRegisterManagedSku, createLocalSqliteTestStore };
}

function inventoryCommand(registration) {
  return {
    schema: "dinkuskit.inventory.command/v1",
    commandId: registration.operationId,
    type: "sku.register",
    context: { siteId: SITE_ID, poolId: registration.request.poolId },
    payload: {
      sku: registration.request.sku,
      displayNameIfNew: registration.request.displayNameIfNew,
      unit: "each",
    },
    references: [],
  };
}

function commerceResult(result) {
  if (result.outcome === "rejected") {
    return { outcome: "rejected", code: result.code, message: result.message };
  }
  return { outcome: result.outcome, inventorySku: result.inventorySku };
}

function createProvider(register, counters, injectUnknownOutcome = false) {
  return {
    async registerManagedSku(registration) {
      counters.providerCalls += 1;
      const result = await register(inventoryCommand(registration), {
        principal: {
          kind: "system",
          id: "principal_registration_retry_proof",
          surface: "local-proof",
        },
      });
      if (injectUnknownOutcome) {
        throw new Error("proof transport lost the response after the provider commit");
      }
      return commerceResult(result);
    },
  };
}

function persistedItem(storage, itemId) {
  return storage.get(itemId);
}

function persistStockManagement(storage, itemId) {
  return async (stockManagement) => {
    const current = await persistedItem(storage, itemId);
    assert.notEqual(current, null, "catalog item must exist before stock state persistence");
    await storage.put(itemId, { ...current, stockManagement });
  };
}

function readInventoryCounts(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const count = (table) =>
      Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
    return {
      inventorySkuRows: count("inventory_skus"),
      commandResultRows: count("inventory_command_results"),
      balanceRows: count("inventory_balances"),
      receiptRows: count("inventory_receipts"),
    };
  } finally {
    database.close();
  }
}

const inventoryRoot = exactInventoryRoot(process.argv[2]);
const { createRegisterManagedSku, createLocalSqliteTestStore } =
  await importInventory(inventoryRoot);
const emdashPackage = JSON.parse(
  readFileSync(new URL("../node_modules/emdash/package.json", import.meta.url), "utf8"),
);
assert.equal(emdashPackage.version, "0.35.0");

const directory = await mkdtemp(join(tmpdir(), "commerce-registration-retry-real-"));
const commerceDatabasePath = join(directory, "commerce.db");
const inventoryDatabasePath = join(directory, "inventory.db");

try {
  initializeCatalogDatabase(commerceDatabasePath);

  let commerce = openCatalogRepository(commerceDatabasePath);
  const created = await createCatalogItem(
    commerce.storage,
    {
      commandId: "cmd_create_registration_retry_proof",
      manageStock: true,
      name: "Registration Retry Proof Product",
      sku: SKU,
    },
    {
      createId: () => ITEM_ID,
      now: () => new Date("2026-08-29T00:00:00.000Z"),
    },
  );

  let inventory = createLocalSqliteTestStore({ filePath: inventoryDatabasePath });
  const firstRegister = createRegisterManagedSku({
    store: inventory,
    now: () => new Date("2026-08-29T00:01:00.000Z"),
    createInventorySkuId: () => INVENTORY_SKU_ID,
  });
  const firstCounters = { providerCalls: 0 };

  await assert.rejects(
    startManagedSkuRegistration(
      created.item.stockManagement,
      {
        providerRef: "dinkuskit.inventory",
        poolId: POOL_ID,
        defaultFulfillmentLocationId: "location_registration_retry_proof",
      },
      { sku: created.item.sku, productTitle: created.item.name },
      {
        createOperationId: () => OPERATION_ID,
        persist: persistStockManagement(commerce.storage, ITEM_ID),
        provider: createProvider(firstRegister, firstCounters, true),
      },
    ),
    /lost the response after the provider commit/,
  );
  assert.equal(firstCounters.providerCalls, 1);

  await commerce.db.destroy();
  await inventory.close();

  commerce = openCatalogRepository(commerceDatabasePath);
  inventory = createLocalSqliteTestStore({ filePath: inventoryDatabasePath });
  const pendingAfterReopen = await persistedItem(commerce.storage, ITEM_ID);
  assert.deepEqual(pendingAfterReopen.stockManagement, {
    mode: "managed",
    status: "setup-pending",
    registration: {
      operationId: OPERATION_ID,
      request: {
        poolId: POOL_ID,
        sku: SKU,
        displayNameIfNew: "Registration Retry Proof Product",
      },
    },
  });
  const providerCallsAtReload = firstCounters.providerCalls;

  let mintedOnRetry = 0;
  const retryRegister = createRegisterManagedSku({
    store: inventory,
    now: () => new Date("2026-08-29T00:02:00.000Z"),
    createInventorySkuId: () => {
      mintedOnRetry += 1;
      return "must_not_be_minted";
    },
  });
  const retryCounters = { providerCalls: 0 };
  const active = await retryManagedSkuRegistration(pendingAfterReopen.stockManagement, {
    persist: persistStockManagement(commerce.storage, ITEM_ID),
    provider: createProvider(retryRegister, retryCounters),
  });
  assert.deepEqual(active, {
    mode: "managed",
    status: "active",
    inventorySkuId: INVENTORY_SKU_ID,
  });
  assert.equal(retryCounters.providerCalls, 1);
  assert.equal(mintedOnRetry, 0);

  const storedCommand = await inventory.readCommand(OPERATION_ID);
  const storedInventorySku = await inventory.readManagedSku({
    poolId: POOL_ID,
    skuId: INVENTORY_SKU_ID,
  });
  assert.equal(storedCommand.result.outcome, "registered");
  assert.equal(storedCommand.result.commandId, OPERATION_ID);
  assert.equal(storedInventorySku.inventorySkuId, INVENTORY_SKU_ID);

  await commerce.db.destroy();
  await inventory.close();

  commerce = openCatalogRepository(commerceDatabasePath);
  inventory = createLocalSqliteTestStore({ filePath: inventoryDatabasePath });
  const activeAfterSecondReopen = await persistedItem(commerce.storage, ITEM_ID);
  assert.deepEqual(activeAfterSecondReopen.stockManagement, active);
  assert.equal(readCatalogItems(commerceDatabasePath).length, 1);

  const inventoryAfterSecondReopen = await inventory.readManagedSku({
    poolId: POOL_ID,
    skuId: INVENTORY_SKU_ID,
  });
  assert.deepEqual(inventoryAfterSecondReopen, storedInventorySku);
  const inventoryCounts = readInventoryCounts(inventoryDatabasePath);
  assert.deepEqual(inventoryCounts, {
    inventorySkuRows: 1,
    commandResultRows: 1,
    balanceRows: 0,
    receiptRows: 0,
  });

  console.log(
    "LIVE_PROOF " +
      JSON.stringify({
        case: "emdash-inventory-registration-retry",
        emdash: emdashPackage.version,
        inventoryHead: EXPECTED_INVENTORY_HEAD,
        firstProviderCalls: firstCounters.providerCalls,
        automaticProviderCallsOnReload: firstCounters.providerCalls - providerCallsAtReload,
        pendingPersistedAcrossReopen: pendingAfterReopen.stockManagement.status === "setup-pending",
        retryOperationIdReused:
          storedCommand.result.commandId ===
          pendingAfterReopen.stockManagement.registration.operationId,
        retryProviderCalls: retryCounters.providerCalls,
        inventoryIdsMintedOnRetry: mintedOnRetry,
        terminalInventoryOutcome: storedCommand.result.outcome,
        finalStockManagement: activeAfterSecondReopen.stockManagement,
        commerceCatalogItems: readCatalogItems(commerceDatabasePath).length,
        ...inventoryCounts,
        commerceStoreReopens: 2,
        inventoryStoreReopens: 2,
        dataClassification: "synthetic-local",
      }),
  );

  await commerce.db.destroy();
  await inventory.close();
} finally {
  await rm(directory, { force: true, recursive: true });
}
