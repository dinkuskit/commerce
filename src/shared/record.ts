/** A non-null, non-array object, as JSON object input or a stored record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** The object's own enumerable keys, sorted and comma-joined, for exact-shape checks. */
export function sortedKeys(value: object): string {
  return Object.keys(value).sort().join();
}
