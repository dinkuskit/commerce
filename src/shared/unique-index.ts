/**
 * The names a store's database may give one plugin storage unique index.
 * EmDash 1.4 names it `uidx_plugin_<plugin>_<collection>_<field>`. EmDash 1.5
 * keeps that name only when every part is lowercase without an underscore;
 * otherwise it is `uidx_plugin_` plus the first 32 hex digits of the SHA-256 of
 * `[plugin, collection, [field]]` as JSON (emdash
 * `database/plugin-storage-index-name.ts`). Migration 095 renames existing
 * indexes, so Commerce accepts both until every store runs 1.5.
 */
export async function uniqueIndexNames(pluginId: string, collection: string, field: string): Promise<string[]> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([pluginId, collection, [field]])));
  let hash = "";
  for (const byte of new Uint8Array(digest, 0, 16)) hash += byte.toString(16).padStart(2, "0");
  return [`uidx_plugin_${pluginId}_${collection}_${field}`, "uidx_plugin_" + hash];
}

/** Whether an error's text or properties name one of `names`. */
export function namesIndex(text: string, properties: Array<Record<string, unknown>>, names: string[]): boolean {
  return names.some((name) => text.includes(name) || properties.some((entry) => entry.constraint === name || entry.index === name));
}
