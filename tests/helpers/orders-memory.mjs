// An in-memory stand-in for Commerce's orders collection with the EmDash storage behaviour Orders relies on:
// compare-and-set revisions, where (a value, null for a missing value, or { gt }), count, and orderBy one field
// the way EmDash sorts it (a missing value after every value ascending and before every value descending, then
// the row id), read 100 at most per call with a cursor. A real EmDash runtime test covers the same reads on SQLite.
export function ordersMemory() {
  const rows = new Map(); let version = 0, writes = 0;
  const matches = (value, where = {}) => Object.entries(where).every(([key, want]) =>
    want && typeof want === 'object' ? value[key] != null && value[key] > want.gt : (value[key] ?? null) === want);
  const sorted = (where, orderBy = {}) => {
    const items = [...rows].filter(([, row]) => matches(row.value, where)).map(([id, row]) => ({ id, data: structuredClone(row.value) }));
    const [field, direction] = Object.entries(orderBy)[0] ?? [];
    if (!field) return items;
    const sign = direction === 'desc' ? -1 : 1;
    const rank = item => item.data[field] == null ? 1 : 0;
    const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    return items.sort((a, b) => sign * (rank(a) - rank(b) || compare(a.data[field] ?? '', b.data[field] ?? '') || compare(a.id, b.id)));
  };
  return { rows, get writes() { return writes; },
    async get(id) { return structuredClone(rows.get(id)?.value ?? null); },
    async getVersioned(id) { return structuredClone(rows.get(id) ?? null); },
    async compareAndSet(id, expected, value) {
      if ((rows.get(id)?.revision ?? null) !== expected) return { applied: false };
      const revision = 'r' + ++version;
      rows.set(id, { value: structuredClone(value), revision }); writes++;
      return { applied: true, revision };
    },
    async compareAndDelete(id, expected) {
      if (rows.get(id)?.revision !== expected) return { applied: false };
      rows.delete(id); return { applied: true };
    },
    async query({ where, orderBy, limit = 50, cursor } = {}) {
      const items = sorted(where, orderBy), start = cursor ? Number(cursor) : 0, end = start + Math.min(limit, 100);
      return { items: items.slice(start, end), hasMore: end < items.length, ...(end < items.length && { cursor: String(end) }) };
    },
    async count(where) { return sorted(where).length; },
  };
}
