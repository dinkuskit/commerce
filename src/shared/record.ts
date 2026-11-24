/** A non-null, non-array object, as JSON object input or a stored record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** The object's own enumerable keys, sorted and comma-joined, for exact-shape checks. */
export function sortedKeys(value: object): string {
  return Object.keys(value).sort().join();
}

/** How many bytes the value takes as JSON, for size limits. */
export const jsonBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

/** Parses bytes as JSON, refusing anything that is not well-formed UTF-8. */
export const parseUtf8Json = (bytes: AllowSharedBufferSource): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));

/** JSON with object keys sorted, so the same contents compare equal whatever their key order. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) => isRecord(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1)) : v);
}
