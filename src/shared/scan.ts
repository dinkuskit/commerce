/**
 * Visits every stored record, at most 100 pages of 100. Fails closed on a
 * repeated or missing cursor and on running out of pages.
 */
export async function scanAll<T>(
  collection: { query(options: { limit: number; cursor?: string }): Promise<{ items: { id: string; data: T }[]; hasMore: boolean; cursor?: string }> },
  visit: (item: { id: string; data: T }) => void,
): Promise<void> {
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const result = await collection.query({ limit: 100, cursor });
    for (const item of result.items) visit(item);
    if (!result.hasMore) return;
    if (!result.cursor || cursors.has(result.cursor)) throw new Error("Invalid cursor");
    cursors.add(cursor = result.cursor);
  }
  throw new Error("Scan limit");
}
