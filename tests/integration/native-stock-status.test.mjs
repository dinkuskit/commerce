import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PluginStorageRepository } from "emdash";
import { COMMERCE_PLUGIN_ID, MANAGED_SKU_REGISTRATION_CLAIMS_COLLECTION,
  createCatalogItem, listCatalogProducts, saveCatalogProductPrices } from "../../dist/index.js";
import {
  initializeCatalogDatabase, initializeClaimDatabase,
  openCatalogRepository, openCatalogPriceRepository,
  openCatalogManualAvailabilityRepository, openClaimRepository,
  readCatalogManualAvailability, readCatalogPrices,
} from "./sqlite-fixture.mjs";

test("native SQLite saves an explicit stock status and restores it when the next toggle omits status", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "commerce-native-stock-status-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, "commerce.db");
  initializeCatalogDatabase(filename);
  initializeClaimDatabase(filename);
  const open = () => {
    const repositories = [openCatalogRepository(filename), openCatalogPriceRepository(filename),
      openCatalogManualAvailabilityRepository(filename), openClaimRepository(filename)];
    return { storage: { catalog: repositories[0].storage, prices: repositories[1].storage,
      availability: repositories[2].storage, claims: new PluginStorageRepository(repositories[3].db,
        COMMERCE_PLUGIN_ID, MANAGED_SKU_REGISTRATION_CLAIMS_COLLECTION, ["catalogItemId", "claimKey", "operationId"]) },
    close: () => Promise.all(repositories.map(repository => repository.db.destroy())) };
  };
  let connection = open();
  try {
    await createCatalogItem(connection.storage.catalog,
      { commandId: "native-status-create", name: "Native blanket", sku: "NATIVE-BLANKET", manageStock: true },
      { createId: () => "native-blanket" });
    await connection.storage.availability.put("native-blanket", {
      recordKind: "catalog-manual-availability", recordId: "native-blanket",
      catalogItemId: "native-blanket", status: "in-stock",
    });
    const saved = await saveCatalogProductPrices(connection.storage, {
      catalogItemId: "native-blanket", regular: "42", sale: "35", manageStock: false, stockStatus: "out-of-stock",
    });
    assert.equal(saved.saved, true);
    assert.equal(saved.stockStatus, "out-of-stock");
  } finally { await connection.close(); }

  connection = open();
  try {
    const listed = await listCatalogProducts(connection.storage);
    assert.equal(listed.products[0].stockStatus, "out-of-stock");
    assert.equal(listed.products[0].regular, "42.00");
    assert.equal(listed.products[0].sale, "35.00");
    assert.equal((await saveCatalogProductPrices(connection.storage, {
      catalogItemId: "native-blanket", regular: "42", sale: "35", manageStock: true,
    })).saved, true);
  } finally { await connection.close(); }

  connection = open();
  try {
    const restored = await saveCatalogProductPrices(connection.storage, {
      catalogItemId: "native-blanket", regular: "42", sale: "35", manageStock: false,
    });
    assert.equal(restored.saved, true);
    assert.equal(restored.stockStatus, "out-of-stock");
    assert.equal(readCatalogManualAvailability(filename)[0].status, "out-of-stock");
    assert.deepEqual(readCatalogPrices(filename)[0].regular, { currency: "USD", minor: "4200" });
  } finally { await connection.close(); }
});
