import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { PluginStorageRepository } from "emdash";

import {
  CATALOG_COLLECTION,
  COMMERCE_PLUGIN_ID,
  catalogUniqueIndexName,
} from "../../dist/index.js";

export function initializeCatalogDatabase(path, uniqueFields = ["commandId", "skuKey"]) {
  const database = new BetterSqlite3(path);
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  database.exec(`
    CREATE TABLE IF NOT EXISTS _plugin_storage (
      plugin_id TEXT NOT NULL,
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (plugin_id, collection, id)
    )
  `);
  for (const field of uniqueFields) {
    const indexName = catalogUniqueIndexName(field);
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS "${indexName}"
      ON _plugin_storage(plugin_id, collection, json_extract(data, '$.${field}'))
    `);
  }
  database.close();
}

export function openCatalogRepository(path) {
  const database = new BetterSqlite3(path);
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  const db = new Kysely({ dialect: new SqliteDialect({ database }) });
  const storage = new PluginStorageRepository(
    db,
    COMMERCE_PLUGIN_ID,
    CATALOG_COLLECTION,
    ["commandId", "skuKey"],
  );
  return { db, storage };
}

export function readCatalogItems(path) {
  const database = new BetterSqlite3(path, { readonly: true });
  const rows = database
    .prepare(
      "SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = ? ORDER BY id",
    )
    .all(COMMERCE_PLUGIN_ID, CATALOG_COLLECTION)
    .map(({ data }) => JSON.parse(data))
    .filter((record) => record.recordKind === "catalog-item");
  database.close();
  return rows;
}
