import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  COMMERCE_PLUGIN_ID,
  MANAGED_SKU_REGISTRATION_CLAIMS_COLLECTION,
  catalogUniqueIndexName,
  identifyConfirmedUniqueViolation,
  managedSkuRegistrationClaimUniqueIndexName,
} from "../../dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const wrangler = join(root, "node_modules/.bin/wrangler");
const config = join(root, "tests/fixtures/d1/wrangler.jsonc");

function runD1(persistTo, command) {
  const child = spawn(
    wrangler,
    [
      "d1",
      "execute",
      "DB",
      "--config",
      config,
      "--local",
      "--persist-to",
      persistTo,
      "--command",
      command,
      "--json",
    ],
    {
      cwd: root,
      env: { ...process.env, CI: "1", NO_COLOR: "1" },
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`wrangler stopped by ${signal}`));
      else resolve({ code: code ?? 1, output: `${stdout}\n${stderr}` });
    });
  });
}

async function runD1Contender(persistTo, command) {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runD1(persistTo, command);
    const retryableBusy = result.code !== 0 && /SQLITE_BUSY/.test(result.output);
    if (!retryableBusy || attempt === maxAttempts) return result;
    await new Promise((resolve) => setTimeout(resolve, attempt * 100));
  }
  throw new Error("unreachable D1 contender retry state");
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function emdashPut(id, commandId, skuKey) {
  const data = JSON.stringify({ recordKind: "catalog-item", commandId, skuKey });
  const now = "2026-08-28T00:00:00.000Z";
  return `
    INSERT INTO _plugin_storage(plugin_id, collection, id, data, created_at, updated_at)
    VALUES (
      ${sqlLiteral(COMMERCE_PLUGIN_ID)},
      'catalogItems',
      ${sqlLiteral(id)},
      ${sqlLiteral(data)},
      '${now}',
      '${now}'
    )
    ON CONFLICT(plugin_id, collection, id) DO UPDATE SET
      data = excluded.data,
      updated_at = excluded.updated_at
  `;
}

function emdashClaimPut(id, claimKey, operationId, poolId) {
  const data = JSON.stringify({
    recordKind: "managed-sku-registration-claim",
    recordId: id,
    claimKey,
    catalogItemId: "product-d1-claim",
    operationId,
    request: {
      poolId,
      sku: "D1-CLAIM-SKU",
      displayNameIfNew: "D1 Claim Product",
    },
    createdAt: "2026-08-29T00:00:00.000Z",
  });
  const now = "2026-08-29T00:00:00.000Z";
  return `
    INSERT INTO _plugin_storage(plugin_id, collection, id, data, created_at, updated_at)
    VALUES (
      ${sqlLiteral(COMMERCE_PLUGIN_ID)},
      ${sqlLiteral(MANAGED_SKU_REGISTRATION_CLAIMS_COLLECTION)},
      ${sqlLiteral(id)},
      ${sqlLiteral(data)},
      '${now}',
      '${now}'
    )
    ON CONFLICT(plugin_id, collection, id) DO UPDATE SET
      data = excluded.data,
      updated_at = excluded.updated_at
  `;
}

test("two local Wrangler/D1 processes enforce the EmDash JSON-expression SKU index", async (t) => {
  const persistTo = await mkdtemp(join(tmpdir(), "commerce-d1-race-"));
  t.after(() => rm(persistTo, { force: true, recursive: true }));
  const commandIndex = catalogUniqueIndexName("commandId");
  const skuIndex = catalogUniqueIndexName("skuKey");
  const schema = `
    CREATE TABLE _plugin_storage (
      plugin_id TEXT NOT NULL,
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (plugin_id, collection, id)
    );
    CREATE UNIQUE INDEX "${commandIndex}"
      ON _plugin_storage(plugin_id, collection, json_extract(data, '$.commandId'));
    CREATE UNIQUE INDEX "${skuIndex}"
      ON _plugin_storage(plugin_id, collection, json_extract(data, '$.skuKey'));
  `;
  const initialized = await runD1(persistTo, schema);
  assert.equal(initialized.code, 0, initialized.output);

  const results = await Promise.all([
    runD1Contender(persistTo, emdashPut("left", "cmd:d1-left", "D1-RACE-SKU")),
    runD1Contender(persistTo, emdashPut("right", "cmd:d1-right", "D1-RACE-SKU")),
  ]);
  assert.equal(results.filter((result) => result.code === 0).length, 1, JSON.stringify(results));
  const rejected = results.find((result) => result.code !== 0);
  assert.match(rejected.output, new RegExp(skuIndex.replaceAll("/", "\\/")));
  assert.match(rejected.output, /SQLITE_CONSTRAINT_UNIQUE/);
  assert.equal(identifyConfirmedUniqueViolation(new Error(rejected.output)), "skuKey");

  const count = await runD1(
    persistTo,
    `SELECT COUNT(*) AS item_count FROM _plugin_storage WHERE plugin_id = ${sqlLiteral(COMMERCE_PLUGIN_ID)} AND collection = 'catalogItems'`,
  );
  assert.equal(count.code, 0, count.output);
  assert.match(count.output, /"item_count":\s*1/);
});

test("two local Wrangler/D1 processes enforce one managed-SKU registration claim", async (t) => {
  const persistTo = await mkdtemp(join(tmpdir(), "commerce-d1-registration-claim-race-"));
  t.after(() => rm(persistTo, { force: true, recursive: true }));
  const claimKeyIndex = managedSkuRegistrationClaimUniqueIndexName("claimKey");
  const operationIndex = managedSkuRegistrationClaimUniqueIndexName("operationId");
  const schema = `
    CREATE TABLE _plugin_storage (
      plugin_id TEXT NOT NULL,
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (plugin_id, collection, id)
    );
    CREATE UNIQUE INDEX "${claimKeyIndex}"
      ON _plugin_storage(plugin_id, collection, json_extract(data, '$.claimKey'));
    CREATE UNIQUE INDEX "${operationIndex}"
      ON _plugin_storage(plugin_id, collection, json_extract(data, '$.operationId'));
  `;
  const initialized = await runD1(persistTo, schema);
  assert.equal(initialized.code, 0, initialized.output);

  const claimKey = "claim:product-d1-claim:initial";
  const results = await Promise.all([
    runD1Contender(
      persistTo,
      emdashClaimPut("claim-left", claimKey, "operation-left", "pool-smoky"),
    ),
    runD1Contender(
      persistTo,
      emdashClaimPut("claim-right", claimKey, "operation-right", "pool-beans"),
    ),
  ]);

  assert.equal(results.filter((result) => result.code === 0).length, 1, JSON.stringify(results));
  const rejected = results.find((result) => result.code !== 0);
  assert.match(rejected.output, new RegExp(claimKeyIndex.replaceAll("/", "\\/")));
  assert.match(rejected.output, /SQLITE_CONSTRAINT_UNIQUE/);

  const count = await runD1(
    persistTo,
    `SELECT COUNT(*) AS claim_count FROM _plugin_storage WHERE plugin_id = ${sqlLiteral(COMMERCE_PLUGIN_ID)} AND collection = ${sqlLiteral(MANAGED_SKU_REGISTRATION_CLAIMS_COLLECTION)}`,
  );
  assert.equal(count.code, 0, count.output);
  assert.match(count.output, /"claim_count":\s*1/);

  console.log(
    "LIVE_PROOF " +
      JSON.stringify({
        case: "wrangler-d1-atomic-managed-sku-registration-claim",
        emdash: "0.35.0",
        processes: results.length,
        writesSucceeded: results.filter((result) => result.code === 0).length,
        writesRejected: results.filter((result) => result.code !== 0).length,
        persistedClaims: 1,
        rejectedConstraint: claimKeyIndex,
        dataClassification: "synthetic-local",
      }),
  );
});
