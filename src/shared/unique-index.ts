import { bytesToHex, sha256 } from "./secret.js";

const rotate = (word: number, bits: number) => (word >>> bits) | (word << (32 - bits));

/**
 * The first 32 hex digits of the SHA-256 of `text` as UTF-8. Synchronous so the
 * published unique-violation classifiers keep returning plain values; Web
 * Crypto's digest only returns a Promise.
 */
export function sha256Prefix(text: string): string {
  const constants: number[] = [];
  const hash: number[] = [];
  for (let candidate = 2, found = 0; found < 64; candidate++) {
    let divisor = 2;
    while (candidate % divisor) divisor++;
    if (divisor === candidate) {
      hash[found] = (candidate ** 0.5 * 2 ** 32) | 0;
      constants[found++] = (candidate ** (1 / 3) * 2 ** 32) | 0;
    }
  }
  hash.length = 8;
  const bytes = new TextEncoder().encode(text);
  const words: number[] = [];
  const end = bytes.length;
  bytes.forEach((byte, index) => (words[index >> 2]! |= byte << (24 - (index % 4) * 8)));
  words[end >> 2]! |= 128 << (24 - (end % 4) * 8);
  words[(((end + 8) >> 6) << 4) + 15] = end * 8;
  for (let block = 0; block < words.length; block += 16) {
    const schedule: number[] = [];
    const state = hash.slice();
    for (let round = 0; round < 64; round++) {
      const early = schedule[round - 15]!;
      const late = schedule[round - 2]!;
      schedule[round] = round < 16
        ? words[block + round]! | 0
        : (schedule[round - 16]! + (rotate(early, 7) ^ rotate(early, 18) ^ (early >>> 3)) + schedule[round - 7]! + (rotate(late, 17) ^ rotate(late, 19) ^ (late >>> 10))) | 0;
      const [a, b, c, , e, f, g, h] = state as [number, number, number, number, number, number, number, number];
      const first = h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + constants[round]! + schedule[round]!;
      state.pop();
      state.unshift((first + (rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0);
      state[4]! += first;
    }
    hash.forEach((word, index) => (hash[index] = (word + state[index]!) | 0));
  }
  return hash.slice(0, 4).map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
}

/**
 * The names a store's database may give one plugin storage unique index.
 * EmDash 1.4 names it `uidx_plugin_<plugin>_<collection>_<field>`. EmDash 1.5
 * keeps that name only when every part is lowercase without an underscore;
 * otherwise it is `uidx_plugin_` plus the first 32 hex digits of the SHA-256 of
 * `[plugin, collection, [field]]` as JSON (emdash
 * `database/plugin-storage-index-name.ts`). Migration 095 renames existing
 * indexes, so Commerce accepts both until every store runs 1.5.
 */
export function uniqueIndexNames(pluginId: string, collection: string, field: string): string[] {
  return [`uidx_plugin_${pluginId}_${collection}_${field}`, `uidx_plugin_${sha256Prefix(JSON.stringify([pluginId, collection, [field]]))}`];
}

/**
 * The same two names through Web Crypto. The Registry backend uses this one:
 * the script SHA-256 above would not fit its 128 KB file cap.
 */
export async function uniqueIndexNamesAsync(pluginId: string, collection: string, field: string): Promise<string[]> {
  const digest = await sha256(JSON.stringify([pluginId, collection, [field]]));
  return [`uidx_plugin_${pluginId}_${collection}_${field}`, "uidx_plugin_" + bytesToHex(digest.subarray(0, 16))];
}

/** Whether an error's text or properties name one of `names`. */
export function namesIndex(text: string, properties: Array<Record<string, unknown>>, names: string[]): boolean {
  return names.some((name) => text.includes(name) || properties.some((entry) => entry.constraint === name || entry.index === name));
}
