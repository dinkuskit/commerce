import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";

import * as root from "@dinkuskit/commerce";
import * as catalog from "@dinkuskit/commerce/features/catalog";
import * as inventoryProvider from "@dinkuskit/commerce/features/inventory-provider";

import { sha256Prefix, uniqueIndexNames, uniqueIndexNamesAsync } from "../dist/shared/unique-index.js";

// EmDash 1.5's name for a plugin unique index (migration 095).
const digestName = (plugin, collection, field) =>
  "uidx_plugin_" + createHash("sha256").update(JSON.stringify([plugin, collection, [field]])).digest("hex").slice(0, 32);

test("the published unique-violation classifiers still answer synchronously", () => {
  for (const entry of [root, catalog]) {
    const busy = entry.isConfirmedUniqueViolation(new Error("SQLITE_BUSY"), "skuKey");
    assert.equal(busy, false, "a plain value, not a Promise");
    if (busy) assert.fail("a store error must not read as a duplicate");
    assert.equal(entry.identifyConfirmedUniqueViolation(new Error("SQLITE_BUSY")), null);

    for (const name of [`uidx_plugin_dinkus-commerce_catalog_items_skuKey`, digestName("dinkus-commerce", "catalog_items", "skuKey")]) {
      const duplicate = new Error(`UNIQUE constraint failed: index '${name}'`);
      assert.equal(entry.isConfirmedUniqueViolation(duplicate, "skuKey", "catalog_items"), true);
      assert.equal(entry.identifyConfirmedUniqueViolation(duplicate, "catalog_items"), "skuKey");
    }
  }

  for (const entry of [root, inventoryProvider]) {
    assert.equal(entry.identifyManagedSkuRegistrationClaimUniqueViolation(new Error("SQLITE_BUSY")), null);
    const duplicate = new Error(`UNIQUE constraint failed: index '${digestName("dinkus-commerce", "managedSkuClaims", "claimKey")}'`);
    assert.equal(entry.identifyManagedSkuRegistrationClaimUniqueViolation(duplicate), "claimKey");
  }
});

test("the script SHA-256 matches Node's and the Web Crypto names", async () => {
  const characters = "abcXYZ_-[]\",é漢🙂";
  for (let length = 0; length < 200; length++) {
    let text = "";
    for (let index = 0; index < length; index++) text += characters[randomBytes(1)[0] % characters.length];
    assert.equal(sha256Prefix(text), createHash("sha256").update(text).digest("hex").slice(0, 32), `length ${length}`);
  }
  for (const [plugin, collection, field] of [["dinkus-commerce", "catalog_items", "skuKey"], ["r_gshdrqaldna3r7sn", "catalogItems", "commandId"]]) {
    assert.deepEqual(uniqueIndexNames(plugin, collection, field), [`uidx_plugin_${plugin}_${collection}_${field}`, digestName(plugin, collection, field)]);
    assert.deepEqual(await uniqueIndexNamesAsync(plugin, collection, field), uniqueIndexNames(plugin, collection, field));
  }
});
