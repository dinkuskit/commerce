import { createCouponAttemptOwner } from "../../../dist/features/coupons/index.js";
import { COMMERCE_PLUGIN_ID } from "../../../dist/index.js";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { PluginStorageRepository } from "emdash";

const [dbPath, couponId, attemptId, quoteArg, totalArg] = process.argv.slice(2);
const database = new BetterSqlite3(dbPath); database.pragma("journal_mode = WAL"); database.pragma("busy_timeout = 5000");
const db = new Kysely({ dialect: new SqliteDialect({ database }) });
const coupons = new PluginStorageRepository(db, COMMERCE_PLUGIN_ID, "coupons", ["normalizedCode"]);
const owner = createCouponAttemptOwner(coupons);
process.send?.({ type: "ready" });
process.on("message", async (message) => {
  if (message !== "go") return;
  try {
    const attempt = await owner.reserve({ couponId, attemptId, quote: JSON.parse(Buffer.from(quoteArg, "base64").toString()), overallPayableTotal: { currency: "USD", minor: totalArg }, now: "2026-10-01T12:00:00Z" });
    process.send?.({ type: "result", ok: true, attempt });
  } catch (error) {
    process.send?.({ type: "result", ok: false, code: error?.code || null, message: error?.message || String(error) });
  } finally { await db.destroy(); process.disconnect?.(); }
});
