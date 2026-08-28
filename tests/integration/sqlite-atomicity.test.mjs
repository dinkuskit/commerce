import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CatalogError, createCatalogItem } from "../../dist/index.js";
import {
  initializeCatalogDatabase,
  openCatalogRepository,
  readCatalogItems,
} from "./sqlite-fixture.mjs";

const workerPath = new URL("./catalog-process-worker.mjs", import.meta.url);

async function runContenders(databasePath, contenders) {
  const children = contenders.map((input) =>
    fork(workerPath, [databasePath, input.commandId, input.name, input.sku], {
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

test("exact EmDash 0.35 storage fails closed when either declared unique index is not live", async (t) => {
  for (const activeUniqueField of ["commandId", "skuKey"]) {
    await t.test(`only ${activeUniqueField} is active`, async (t) => {
      const directory = await mkdtemp(join(tmpdir(), "commerce-sqlite-missing-"));
      t.after(() => rm(directory, { force: true, recursive: true }));
      const databasePath = join(directory, "catalog.db");
      initializeCatalogDatabase(databasePath, [activeUniqueField]);
      const { db, storage } = openCatalogRepository(databasePath);
      t.after(() => db.destroy());

      await assert.rejects(
        createCatalogItem(storage, {
          commandId: `cmd:missing-${activeUniqueField}`,
          name: "Missing",
          sku: `MISSING-${activeUniqueField}`,
        }),
        (error) =>
          error instanceof CatalogError && error.code === "STORAGE_CONSTRAINTS_UNAVAILABLE",
      );
      assert.deepEqual(readCatalogItems(databasePath), []);
    });
  }
});

test("two server processes claiming one SKU produce one row and one SKU_CONFLICT", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "commerce-sqlite-race-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "catalog.db");
  initializeCatalogDatabase(databasePath);

  const results = await runContenders(databasePath, [
    { commandId: "cmd:left", name: "Left", sku: "RACE-SKU" },
    { commandId: "cmd:right", name: "Right", sku: "race-sku" },
  ]);

  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.deepEqual(
    results.filter((result) => !result.ok).map((result) => result.code),
    ["SKU_CONFLICT"],
  );
  assert.equal(readCatalogItems(databasePath).length, 1);
});

test("two server processes retrying one command converge on the original row", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "commerce-sqlite-retry-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "catalog.db");
  initializeCatalogDatabase(databasePath);

  const results = await runContenders(databasePath, [
    { commandId: "cmd:retry", name: "Retry", sku: "RETRY-SKU" },
    { commandId: "cmd:retry", name: "Retry", sku: "retry-sku" },
  ]);

  assert.equal(results.every((result) => result.ok), true);
  assert.equal(results.filter((result) => result.result.created).length, 1);
  assert.equal(new Set(results.map((result) => result.result.item.itemId)).size, 1);
  assert.equal(readCatalogItems(databasePath).length, 1);
});
