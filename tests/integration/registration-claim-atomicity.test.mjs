import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ManagedSkuRegistrationError,
  createManagedSkuRegistrationClaimPort,
} from "../../dist/index.js";
import {
  initializeClaimDatabase,
  openClaimRepository,
  readClaimRecords,
} from "./sqlite-fixture.mjs";

const workerPath = new URL("./registration-claim-process-worker.mjs", import.meta.url);
const emdashPackage = JSON.parse(
  await readFile(new URL("../../node_modules/emdash/package.json", import.meta.url), "utf8"),
);

assert.equal(emdashPackage.version, "0.35.0");

async function runContenders(databasePath, contenders) {
  const children = contenders.map(({ operationId, poolId }) =>
    fork(workerPath, [databasePath, operationId, poolId], {
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

test("two EmDash 0.35 repository processes converge on one registration operation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "commerce-registration-claim-race-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "commerce.db");
  initializeClaimDatabase(databasePath);

  const results = await runContenders(databasePath, [
    { operationId: "operation-left", poolId: "pool-smoky" },
    { operationId: "operation-right", poolId: "pool-beans" },
  ]);

  assert.equal(results.every(({ ok }) => ok), true, JSON.stringify(results));
  assert.equal(results.filter(({ result }) => result.outcome === "claimed").length, 1);
  assert.equal(results.filter(({ result }) => result.outcome === "existing").length, 1);
  assert.equal(new Set(results.map(({ result }) => result.claim.operationId)).size, 1);
  assert.equal(new Set(results.map(({ result }) => result.claim.request.poolId)).size, 1);

  const claims = readClaimRecords(databasePath);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].operationId, results[0].result.claim.operationId);

  console.log(
    "LIVE_PROOF " +
      JSON.stringify({
        case: "atomic-managed-sku-registration-claim",
        emdash: emdashPackage.version,
        processes: results.length,
        claimed: results.filter(({ result }) => result.outcome === "claimed").length,
        joined: results.filter(({ result }) => result.outcome === "existing").length,
        persistedClaims: claims.length,
        oneOperation: new Set(results.map(({ result }) => result.claim.operationId)).size === 1,
        onePool: new Set(results.map(({ result }) => result.claim.request.poolId)).size === 1,
        dataClassification: "synthetic",
      }),
  );
});

test("EmDash 0.35 claim storage fails closed when either unique index is absent", async (t) => {
  for (const activeUniqueField of ["claimKey", "operationId"]) {
    await t.test(`only ${activeUniqueField} is active`, async (t) => {
      const directory = await mkdtemp(join(tmpdir(), "commerce-registration-claim-missing-"));
      t.after(() => rm(directory, { force: true, recursive: true }));
      const databasePath = join(directory, "commerce.db");
      initializeClaimDatabase(databasePath, [activeUniqueField]);
      const { db, storage } = openClaimRepository(databasePath);
      t.after(() => db.destroy());
      const port = createManagedSkuRegistrationClaimPort(storage, {
        createRecordId: () => "claim-record",
        now: () => new Date("2026-08-29T00:00:00.000Z"),
      });

      await assert.rejects(
        port.claim({
          claimKey: "claim:product-1:initial",
          catalogItemId: "product-1",
          registration: {
            operationId: "operation-1",
            request: {
              poolId: "pool-smoky",
              sku: "GRILL-1",
              displayNameIfNew: "Grill One",
            },
          },
        }),
        (error) =>
          error instanceof ManagedSkuRegistrationError &&
          error.code === "REGISTRATION_CLAIM_UNAVAILABLE",
      );
      assert.deepEqual(readClaimRecords(databasePath), []);
    });
  }
});
