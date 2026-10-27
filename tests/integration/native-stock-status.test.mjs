import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PluginStorageRepository } from "emdash";
import { COMMERCE_PLUGIN_ID, MANAGED_SKU_REGISTRATION_CLAIMS_COLLECTION,
  createCatalogItem, listCatalogProducts, saveCatalogProductPrices, addCatalogVariantOption, bulkSaveCatalogProductPrices } from "../../dist/index.js";
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
    const persisted = (await listCatalogProducts(connection.storage)).products[0];
    assert.equal(persisted.stockStatus, "out-of-stock");
    assert.equal(persisted.regular, "42.00");
  } finally { await connection.close(); }
});


test("native SQLite reopens migrated choices with usable revisions and atomically saves sibling prices", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "commerce-native-bulk-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, "commerce.db");
  initializeCatalogDatabase(filename);
  const open = () => {
    const repositories = [openCatalogRepository(filename), openCatalogPriceRepository(filename), openCatalogManualAvailabilityRepository(filename)];
    return { storage: { catalog: repositories[0].storage, prices: repositories[1].storage, availability: repositories[2].storage },
      close: () => Promise.all(repositories.map(repository => repository.db.destroy())) };
  };
  let connection = open();
  try {
    await createCatalogItem(connection.storage.catalog, { commandId: "create-shirt", name: "Shirt", sku: "SHIRT-S", fulfillment: "physical" }, { createId: () => "shirt" });
    await addCatalogVariantOption(connection.storage, { productId: "shirt", optionId: "size", optionLabel: "Size", values: [
      { valueId: "s", label: "Small", member: { catalogItemId: "shirt", fulfillment: "physical" } },
      { valueId: "l", label: "Large", member: { commandId: "create-large", name: "Shirt", sku: "SHIRT-L", fulfillment: "physical" } },
    ] }, { createId: () => "shirt-large" });
    await connection.storage.prices.put("shirt", { recordKind: "catalog-price", recordId: "shirt", catalogItemId: "shirt", regular: { currency: "USD", minor: "2000" } });
    const legacy = await connection.storage.prices.getVersioned("shirt");
    assert.equal((await saveCatalogProductPrices(connection.storage, { catalogItemId: "shirt", regular: "21", sale: "", expectedRevision: legacy.revision })).saved, true);
  } finally { await connection.close(); }
  connection = open();
  try {
    let product = (await listCatalogProducts(connection.storage)).products[0];
    const listed = product.variantProduct.members[0];
    assert.match(listed.priceRevision, /^catalog:/);
    assert.equal((await saveCatalogProductPrices(connection.storage, { catalogItemId: listed.catalogItemId, regular: "22", sale: "", expectedRevision: listed.priceRevision })).saved, true);
    product = (await listCatalogProducts(connection.storage)).products[0];
    const inputs = product.variantProduct.members.map((member, index) => ({ catalogItemId: member.catalogItemId, regular: String(25 + index), sale: "", expectedRevision: member.priceRevision }));
    assert.deepEqual((await bulkSaveCatalogProductPrices(connection.storage, inputs)).outcomes.map(row => row.applied), [true, true]);
    assert.deepEqual((await bulkSaveCatalogProductPrices(connection.storage, inputs)).outcomes.map(row => row.code), ["CONFLICT", "CONFLICT"]);
  } finally { await connection.close(); }
  connection = open();
  const other = open();
  try {
    const product = (await listCatalogProducts(connection.storage)).products[0];
    assert.deepEqual(product.variantProduct.members.map(member => member.regular), ["25.00", "26.00"]);
    const commit = connection.storage.catalog.compareAndSet.bind(connection.storage.catalog);
    connection.storage.catalog.compareAndSet = async (...args) => {
      const external = await other.storage.catalog.get("shirt");
      await other.storage.catalog.put("shirt", { ...external, brand: "Concurrent editor" });
      return commit(...args);
    };
    const outcome = await bulkSaveCatalogProductPrices(connection.storage, product.variantProduct.members.map(member => ({ catalogItemId: member.catalogItemId, regular: "99", sale: "", expectedRevision: member.priceRevision })));
    assert.deepEqual(outcome.outcomes.map(row => row.code), ["CONFLICT", "CONFLICT"]);
    const after = (await listCatalogProducts(other.storage)).products[0];
    assert.deepEqual(after.variantProduct.members.map(member => member.regular), ["25.00", "26.00"]);
    assert.equal(after.brand, "Concurrent editor");
  } finally { await Promise.all([connection.close(), other.close()]); }
});
