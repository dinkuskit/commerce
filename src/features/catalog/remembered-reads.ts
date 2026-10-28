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
        const versions = new Map<string, Promise<{ value: unknown; revision: string } | null>>();
        const get = (id: string) => {
          let read = seen.get(id);
          if (!read) seen.set(id, (read = collection.get(id)));
          return read;
        };
        remembered = new Proxy(collection, {
          get(inner, key, innerReceiver) {
            if (key === "get") return get;
            const method = Reflect.get(inner, key, innerReceiver);
            if (typeof method !== "function") return method;
            if (key === "getMany") return async (ids: string[]) => {
              const missing = [...new Set(ids)].filter(id => !seen.has(id));
              if (missing.length) {
                const found = await method.call(inner, missing);
                for (const id of missing) seen.set(id, Promise.resolve(found.get(id) ?? null));
              }
              const rows = await Promise.all(ids.map(async id => [id, await seen.get(id)] as const));
              return new Map(rows.filter(([, value]) => value !== null));
            };
            if (key === "getVersioned") return (id: string) => {
              let result = versions.get(id);
              if (!result) {
                result = method.call(inner, id);
                versions.set(id, result!);
                const value = result!.then(row => row?.value ?? null);
                value.catch(() => {}); // The versioned caller observes the original failure.
                seen.set(id, value);
              }
              return result;
            };
            if (key === "compareAndSet") return async (id: string, revision: string | null, value: unknown) => {
              // Forget before issuing the write: even a rejected transport may have committed.
              seen.delete(id); versions.delete(id);
              const result = await method.call(inner, id, revision, value);
              if (result.applied) {
                seen.set(id, Promise.resolve(value));
                if (result.revision) versions.set(id, Promise.resolve({ value, revision: result.revision }));
              }
              return result;
            };
            if (["put", "delete", "compareAndDelete", "updateIf"].includes(String(key))) return async (id: string, ...args: unknown[]) => {
              seen.delete(id); versions.delete(id);
              return method.call(inner, id, ...args);
            };
            return method.bind(inner);
          },
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
