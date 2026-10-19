interface Readable {
  get(id: string): Promise<unknown>;
  getMany?(ids: string[]): Promise<Map<string, unknown>>;
}

export interface RememberedReads {
  /** The same storage, except each collection's get answers each id once per request. */
  readonly storage: Record<string, unknown>;
  /** Reads these ids in one getMany call, so later gets for them cost nothing. */
  prefetch(collection: string, ids: Iterable<string>): Promise<void>;
  /** Records rows already read, such as a query page, so get does not read them again. */
  seed(collection: string, rows: Iterable<{ id: string; data: unknown }>): void;
}

/**
 * Each storage call from a Registry plugin is one subrequest, and the sandbox allows only a few
 * per call (EmDash's default is 10, Template Store's 32). Shop reads look up the same records
 * many times per product, so a read-only request reads through this: ids it names up front come
 * from one getMany call, and every other id is read once. A failed getMany is ignored, so each
 * product keeps its own single-read failure handling.
 */
export function rememberReads(storage: Record<string, unknown>): RememberedReads {
  const reads = new Map<string, Map<string, Promise<unknown>>>();
  const known = (name: string) => {
    let collection = reads.get(name);
    if (!collection) reads.set(name, (collection = new Map()));
    return collection;
  };
  const wrapped = new Map<string, unknown>();
  const view = new Proxy(storage, {
    get(target, name, receiver) {
      const collection = Reflect.get(target, name, receiver) as Readable | undefined;
      if (typeof name !== "string" || typeof collection?.get !== "function") return collection;
      let remembered = wrapped.get(name);
      if (!remembered) {
        const seen = known(name);
        const get = (id: string) => {
          let read = seen.get(id);
          if (!read) seen.set(id, (read = collection.get(id)));
          return read;
        };
        remembered = new Proxy(collection, {
          get: (inner, key, innerReceiver) => (key === "get" ? get : Reflect.get(inner, key, innerReceiver)),
        });
        wrapped.set(name, remembered);
      }
      return remembered;
    },
  });
  return {
    storage: view,
    async prefetch(name, ids) {
      const collection = storage[name] as Readable | undefined;
      const seen = known(name);
      const wanted = [...new Set(ids)].filter((id) => !seen.has(id));
      if (!wanted.length || typeof collection?.getMany !== "function") return;
      let found: Map<string, unknown>;
      try {
        found = await collection.getMany(wanted);
      } catch {
        return;
      }
      for (const id of wanted) if (!seen.has(id)) seen.set(id, Promise.resolve(found.get(id) ?? null));
    },
    seed(name, rows) {
      const seen = known(name);
      for (const row of rows) if (!seen.has(row.id)) seen.set(row.id, Promise.resolve(row.data));
    },
  };
}
