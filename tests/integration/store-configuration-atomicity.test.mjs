import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  InventorySetupError,
  configureCatalogItemInventory,
  createCatalogItem,
  createStoreInventoryConfiguration,
  resolveManagedStorefrontAvailability,
  setCatalogItemBackorders,
  setStorefrontAvailabilityPolicy,
} from "../../dist/index.js";
import {
  initializeCatalogDatabase,
  initializeClaimDatabase,
  initializeStoreInventoryConfigurationDatabase,
  openCatalogBackorderPolicyRepository,
  openCatalogRepository,
  openClaimRepository,
  openStoreInventoryConfigurationRepository,
  openStorefrontAvailabilitySettingsRepository,
  readCatalogBackorderPolicies,
  readCatalogItems,
  readClaimRecords,
  readStoreInventoryConfigurations,
  readStorefrontAvailabilitySettings,
} from "./sqlite-fixture.mjs";

const workerPath = new URL("./store-configuration-process-worker.mjs", import.meta.url);
const emdashPackage = JSON.parse(
  await readFile(new URL("../../node_modules/emdash/package.json", import.meta.url), "utf8"),
);

assert.equal(emdashPackage.version, "0.35.0");

async function runContenders(databasePath) {
  const children = ["left", "right"].map((contender) =>
    fork(workerPath, [databasePath, contender], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    }),
  );
  const stderr = new Map(children.map((child) => [child, ""]));
  for (const child of children) {
    child.stderr.on("data", (chunk) => stderr.set(child, stderr.get(child) + chunk));
  }
  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve, reject) => {
          child.on("error", reject);
          child.on("message", (message) => {
            if (message?.type === "ready") resolve();
          });
        }),
    ),
  );
  for (const child of children) child.send("go");
  return Promise.all(
    children.map(
      (child) =>
        new Promise((resolve, reject) => {
          child.on("error", reject);
          child.on("message", (message) => {
            if (message?.type === "result") resolve(message);
          });
          child.on("exit", (code) => {
            if (code && code !== 0) reject(new Error(stderr.get(child)));
          });
        }),
    ),
  );
}

test("two EmDash 0.35 repository processes converge on one permanent site identity", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "commerce-store-configuration-race-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "commerce.db");
  initializeStoreInventoryConfigurationDatabase(databasePath);

  const results = await runContenders(databasePath);
  assert.equal(results.every(({ ok }) => ok), true, JSON.stringify(results));
  assert.equal(results.filter(({ result }) => result.outcome === "created").length, 1);
  assert.equal(results.filter(({ result }) => result.outcome === "existing").length, 1);
  assert.equal(new Set(results.map(({ result }) => result.configuration.siteId)).size, 1);

  const configurations = readStoreInventoryConfigurations(databasePath);
  assert.equal(configurations.length, 1);
  assert.equal(configurations[0].siteId, results[0].result.configuration.siteId);

  console.log(
    "LIVE_PROOF " +
      JSON.stringify({
        case: "atomic-store-inventory-configuration",
        emdash: emdashPackage.version,
        processes: results.length,
        created: results.filter(({ result }) => result.outcome === "created").length,
        joined: results.filter(({ result }) => result.outcome === "existing").length,
        persistedConfigurations: configurations.length,
        onePermanentSiteId:
          new Set(results.map(({ result }) => result.configuration.siteId)).size === 1,
        dataClassification: "synthetic",
      }),
  );
});

test("EmDash 0.35 configuration storage fails closed without its unique index", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "commerce-store-configuration-missing-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "commerce.db");
  initializeStoreInventoryConfigurationDatabase(databasePath, false);
  const { db, storage } = openStoreInventoryConfigurationRepository(databasePath);
  t.after(() => db.destroy());

  await assert.rejects(
    createStoreInventoryConfiguration(
      storage,
      {
        providerRef: "dinkuskit.inventory",
        poolId: "pool-smoky",
        defaultFulfillmentLocationId: "murphy-nc",
      },
      {
        createRecordId: () => "configuration-record",
        createSiteId: () => "site-permanent",
      },
    ),
    (error) =>
      error instanceof InventorySetupError &&
      error.code === "STORAGE_CONSTRAINTS_UNAVAILABLE",
  );
  assert.deepEqual(readStoreInventoryConfigurations(databasePath), []);
});

test("Configure Inventory persists one active SKU through exact EmDash 0.35 storage", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "commerce-configure-inventory-live-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "commerce.db");
  initializeCatalogDatabase(databasePath);
  initializeClaimDatabase(databasePath);
  initializeStoreInventoryConfigurationDatabase(databasePath);
  const catalog = openCatalogRepository(databasePath);
  const claims = openClaimRepository(databasePath);
  const configurations = openStoreInventoryConfigurationRepository(databasePath);
  t.after(() =>
    Promise.all([catalog.db.destroy(), claims.db.destroy(), configurations.db.destroy()]),
  );

  const created = await createCatalogItem(
    catalog.storage,
    {
      commandId: "cmd:configure-inventory-live",
      name: "Live Storage Grill",
      sku: "LIVE-STORAGE-GRILL",
      manageStock: true,
    },
    {
      createId: () => "catalog-live-storage-grill",
      now: () => new Date("2026-08-30T00:00:00.000Z"),
    },
  );
  const configured = await createStoreInventoryConfiguration(
    configurations.storage,
    {
      providerRef: "dinkuskit.inventory",
      poolId: "pool-smoky",
      defaultFulfillmentLocationId: "murphy-nc",
    },
    {
      createRecordId: () => "configuration-live-storage",
      createSiteId: () => "site-live-storage-permanent",
      now: () => new Date("2026-08-30T00:01:00.000Z"),
    },
  );
  const result = await configureCatalogItemInventory(
    {
      catalog: catalog.storage,
      configurations: configurations.storage,
      claims: claims.storage,
    },
    { catalogItemId: created.item.itemId },
    {
      createClaimRecordId: () => "claim-live-storage",
      createOperationId: () => "operation-live-storage",
      now: () => new Date("2026-08-30T00:02:00.000Z"),
      resolveProvider: async (configuration) => {
        assert.equal(configuration.siteId, configured.configuration.siteId);
        return {
          async registerManagedSku(registration) {
            return {
              outcome: "registered",
              inventorySku: {
                inventorySkuId: "inventory-live-storage-grill",
                sku: registration.request.sku,
                displayName: registration.request.displayNameIfNew,
              },
            };
          },
        };
      },
    },
  );

  const [persistedItem] = readCatalogItems(databasePath);
  assert.equal(result.outcome, "inventory-active");
  assert.deepEqual(persistedItem.stockManagement, {
    mode: "managed",
    status: "active",
    inventorySkuId: "inventory-live-storage-grill",
  });
  assert.equal(readStoreInventoryConfigurations(databasePath).length, 1);
  assert.equal(readClaimRecords(databasePath).length, 1);

  console.log(
    "LIVE_PROOF " +
      JSON.stringify({
        case: "configure-inventory-action-persistence",
        emdash: emdashPackage.version,
        outcome: result.outcome,
        siteIdentityPersisted: configured.configuration.siteId.length > 0,
        catalogState: persistedItem.stockManagement.status,
        persistedConfigurations: readStoreInventoryConfigurations(databasePath).length,
        persistedClaims: readClaimRecords(databasePath).length,
        providerContract: "InventoryProviderPort",
        dataClassification: "synthetic",
      }),
  );
});

test("storefront policy and backorders survive EmDash storage reopen", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "commerce-storefront-policy-live-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "commerce.db");
  initializeCatalogDatabase(databasePath);
  initializeClaimDatabase(databasePath);
  initializeStoreInventoryConfigurationDatabase(databasePath);

  const firstCatalog = openCatalogRepository(databasePath);
  const firstBackorderPolicies = openCatalogBackorderPolicyRepository(databasePath);
  const firstClaims = openClaimRepository(databasePath);
  const firstConfigurations = openStoreInventoryConfigurationRepository(databasePath);
  const firstSettings = openStorefrontAvailabilitySettingsRepository(databasePath);
  const created = await createCatalogItem(
    firstCatalog.storage,
    {
      commandId: "cmd:storefront-policy-live",
      name: "Storefront Policy Grill",
      sku: "STOREFRONT-POLICY-GRILL",
      manageStock: true,
    },
    { createId: () => "catalog-storefront-policy" },
  );
  await createStoreInventoryConfiguration(
    firstConfigurations.storage,
    {
      providerRef: "dinkuskit.inventory",
      poolId: "pool-smoky",
      defaultFulfillmentLocationId: "murphy-nc",
    },
    {
      createRecordId: () => "configuration-storefront-policy",
      createSiteId: () => "site-storefront-policy",
    },
  );
  await configureCatalogItemInventory(
    {
      catalog: firstCatalog.storage,
      configurations: firstConfigurations.storage,
      claims: firstClaims.storage,
    },
    { catalogItemId: created.item.itemId },
    {
      createClaimRecordId: () => "claim-storefront-policy",
      createOperationId: () => "operation-storefront-policy",
      resolveProvider: async () => ({
        async registerManagedSku(registration) {
          return {
            outcome: "registered",
            inventorySku: {
              inventorySkuId: "inventory-storefront-policy",
              sku: registration.request.sku,
              displayName: registration.request.displayNameIfNew,
            },
          };
        },
      }),
    },
  );
  await setStorefrontAvailabilityPolicy(firstSettings.storage, {
    mode: "threshold",
    threshold: 5,
  });
  await setCatalogItemBackorders(
    {
      catalog: firstCatalog.storage,
      policies: firstBackorderPolicies.storage,
    },
    { catalogItemId: created.item.itemId, allowBackorders: true },
  );
  await Promise.all([
    firstBackorderPolicies.db.destroy(),
    firstCatalog.db.destroy(),
    firstClaims.db.destroy(),
    firstConfigurations.db.destroy(),
    firstSettings.db.destroy(),
  ]);

  const catalog = openCatalogRepository(databasePath);
  const backorderPolicies = openCatalogBackorderPolicyRepository(databasePath);
  const configurations = openStoreInventoryConfigurationRepository(databasePath);
  const settings = openStorefrontAvailabilitySettingsRepository(databasePath);
  t.after(() =>
    Promise.all([
      backorderPolicies.db.destroy(),
      catalog.db.destroy(),
      configurations.db.destroy(),
      settings.db.destroy(),
    ]),
  );
  const providerInputs = [];
  const result = await resolveManagedStorefrontAvailability(
    {
      backorderPolicies: backorderPolicies.storage,
      catalog: catalog.storage,
      configurations: configurations.storage,
      settings: settings.storage,
    },
    { catalogItemId: created.item.itemId },
    {
      resolveProvider: async () => ({
        async readSkuStock(input) {
          providerInputs.push(input);
          const zero = { value: "0", unit: "each" };
          const available = { value: "5", unit: "each" };
          const stock = {
            onHand: available,
            reserved: zero,
            outgoingTransferCommitted: zero,
            available,
            expected: zero,
            inTransit: zero,
          };
          return {
            schema: "dinkuskit.inventory.sku-stock-read-result/v1",
            outcome: "found",
            poolId: input.poolId,
            skuId: input.skuId,
            scope: input.scope,
            stock,
            locations: [
              {
                locationId: input.scope.locationId,
                name: "Murphy, NC",
                stock,
              },
            ],
          };
        },
      }),
    },
  );

  const [persistedBackorderPolicy] = readCatalogBackorderPolicies(databasePath);
  const [persistedSettings] = readStorefrontAvailabilitySettings(databasePath);
  assert.equal(persistedBackorderPolicy.allowBackorders, true);
  assert.deepEqual(persistedSettings.policy, {
    mode: "threshold",
    threshold: 5,
  });
  assert.deepEqual(providerInputs, [
    {
      poolId: "pool-smoky",
      skuId: "inventory-storefront-policy",
      scope: { kind: "location", locationId: "murphy-nc" },
    },
  ]);
  assert.equal(result.status, "low-stock");
  assert.deepEqual(result.displayQuantity, { value: "5", unit: "each" });

  console.log(
    "LIVE_PROOF " +
      JSON.stringify({
        case: "storefront-availability-policy-persistence",
        emdash: emdashPackage.version,
        storageReopened: true,
        displayMode: persistedSettings.policy.mode,
        threshold: persistedSettings.policy.threshold,
        allowBackorders: persistedBackorderPolicy.allowBackorders,
        inventoryScope: providerInputs[0].scope.kind,
        inventoryLocation: providerInputs[0].scope.locationId,
        resolvedStatus: result.status,
        dataClassification: "synthetic",
      }),
  );
});
