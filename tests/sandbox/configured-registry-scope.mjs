import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { Kysely } from "kysely";
import Database from "better-sqlite3";
import { createDialect } from "emdash/db/sqlite";
import { runMigrations } from "emdash/db";

const sandboxSite = new URL("../sandbox-site/", import.meta.url);
const astro = new URL("../../node_modules/.bin/astro", import.meta.url);

function portFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function migratedDatabase(file, siteUrl) {
  const db = new Kysely({ dialect: createDialect({ url: `file:${file}` }) });
  try {
    const migrated = await runMigrations(db);
    if (siteUrl) {
      await db
        .insertInto("options")
        .values({ name: "emdash:site_url", value: JSON.stringify(siteUrl) })
        .execute();
    }
    const row = await db
      .selectFrom("options")
      .select("value")
      .where("name", "=", "emdash:site_url")
      .executeTakeFirst();
    return { applied: migrated.applied.length, storedSiteUrl: row ? JSON.parse(row.value) : null };
  } finally {
    await db.destroy();
  }
}

function countRows(file, collection) {
  const database = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const table = database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_plugin_storage'")
      .get();
    if (!table) return 0;
    return database
      .prepare("SELECT COUNT(*) AS n FROM _plugin_storage WHERE plugin_id = ? AND collection = ?")
      .get("dinkus-commerce", collection).n;
  } finally {
    database.close();
  }
}

function startAstro(port, databaseFile) {
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(astro.pathname, ["dev", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: sandboxSite.pathname,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ASTRO_DEV_BACKGROUND: "1",
      COMMERCE_PROOF_DB: `file:${databaseFile}`,
      EMDASH_SITE_URL: origin,
      COMMERCE_SITE_URL: origin,
      NO_PROXY: "127.0.0.1,localhost,::1",
      no_proxy: "127.0.0.1,localhost,::1",
    },
  });
  let output = "";
  const capture = (chunk) => {
    output = `${output}${chunk}`.slice(-8000);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  return { child, origin, output: () => output };
}

async function stopAstro(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      resolve();
    }, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForServer(origin) {
  const deadline = Date.now() + 90000;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin, { redirect: "manual" });
      if (response.status < 500) return response.status;
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "fetch failed";
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`server did not accept connections: ${lastError}`);
}

function guestPayload(body) {
  const data = body?.data ?? body;
  return {
    ok: data?.ok === true,
    code: data?.error?.code ?? body?.error?.code ?? null,
    minted: typeof data?.capability?.capability === "string" && data.capability.capability.includes("."),
  };
}

async function postJson(url, origin, body, capability) {
  const headers = {
    origin,
    "sec-fetch-site": "same-origin",
    "content-type": "application/json",
  };
  if (capability) headers["x-commerce-guest-capability"] = capability;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: response.status, payload: guestPayload(parsed), body: parsed };
}

async function exercise(port, databaseFile, siteUrl) {
  const seeded = await migratedDatabase(databaseFile, siteUrl);
  const server = startAstro(port, databaseFile);
  try {
    const readyStatus = await waitForServer(server.origin);
    const prepare = await postJson(
      `${server.origin}/_emdash/api/plugins/dinkus-commerce/checkout/guest/prepare`,
      server.origin,
      {},
    );
    const prepareData = prepare.body?.data ?? prepare.body;
    const presented =
      prepare.payload.minted && prepareData && typeof prepareData.capability?.capability === "string"
        ? prepareData.capability.capability
        : null;
    const start = presented
      ? await postJson(
          `${server.origin}/_emdash/api/plugins/dinkus-commerce/checkout/guest/start`,
          server.origin,
          { lines: [{ catalogItemId: "guest-hat", quantity: 1 }] },
          presented,
        )
      : null;
    return {
      readyStatus,
      seededStoredSiteUrl: seeded.storedSiteUrl,
      migrationsApplied: seeded.applied,
      prepareStatus: prepare.status,
      prepareOk: prepare.payload.ok,
      prepareCode: prepare.payload.code,
      minted: prepare.payload.minted,
      capabilityRows: countRows(databaseFile, "checkout_guest_capabilities"),
      cartRows: countRows(databaseFile, "checkout_carts"),
      inventoryRows: countRows(databaseFile, "store_inventory_configurations"),
      startStatus: start?.status ?? null,
      startOk: start?.payload.ok ?? null,
      startCode: start?.payload.code ?? null,
      cartRowsAfterStart: countRows(databaseFile, "checkout_carts"),
      inventoryRowsAfterStart: countRows(databaseFile, "store_inventory_configurations"),
    };
  } catch (error) {
    return {
      failed: true,
      message: error instanceof Error ? error.message : "exercise failed",
      serverTail: server.output().replace(/did:plc:[a-z0-9]+/g, "[redacted]").slice(-1500),
    };
  } finally {
    await stopAstro(server.child);
  }
}

const configuredPort = 20121;
const missingPort = 20123;
if (!(await portFree(configuredPort)) || !(await portFree(missingPort))) {
  console.log(JSON.stringify({ result: "NOT_PROVEN", reason: "requested ports were already listening" }));
  process.exit(2);
}

const directory = mkdtempSync(join(tmpdir(), "registry-scope-"));
try {
  const configured = await exercise(
    configuredPort,
    join(directory, "configured.db"),
    `http://127.0.0.1:${configuredPort}`,
  );
  const missing = await exercise(missingPort, join(directory, "missing.db"), null);
  const configuredProved =
    configured.prepareOk === true &&
    configured.minted === true &&
    configured.capabilityRows === 1 &&
    configured.cartRows === 0 &&
    configured.inventoryRows === 0 &&
    configured.startOk === false &&
    configured.startCode === "PAYMENTS_UNAVAILABLE" &&
    configured.cartRowsAfterStart === 0 &&
    configured.inventoryRowsAfterStart === 0;
  const missingClosed =
    configuredProved &&
    missing.prepareOk === false &&
    missing.prepareCode === "UNAVAILABLE" &&
    missing.capabilityRows === 0 &&
    missing.cartRows === 0 &&
    missing.minted === false;
  console.log(JSON.stringify({
    result: configuredProved && missingClosed ? "PROVEN" : "NOT_PROVEN",
    configured,
    missing,
  }));
  process.exit(configuredProved && missingClosed ? 0 : 1);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
