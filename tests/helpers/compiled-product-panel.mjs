import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function compiledProductPanel() {
  const child = fork(fileURLToPath(new URL('./compiled-product-panel-child.mjs', import.meta.url)), { execArgv: [] });
  const pending = new Map();
  let nextId = 0;
  const failPending = (error) => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      const error = new Error(`Product panel fixture exited (${signal ?? code})`);
      failPending(error);
      resolve(code === 0 ? null : error);
    });
    child.on('error', (error) => {
      failPending(error);
      if (child.pid === undefined) resolve(error);
    });
  });
  child.on('message', ({ id, result, error }) => {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (error) request.reject(new Error(error));
    else request.resolve(result);
  });

  const request = (method, ...args) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.send({ id, method, args }, (error) => {
      if (!error) return;
      pending.delete(id);
      reject(error);
    });
  });
  const close = async () => {
    if (child.connected) child.disconnect();
    const error = await exited;
    if (error) throw error;
  };

  try {
    await request('start');
  } catch (error) {
    try { await close(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Product panel fixture could not start or close'); }
    throw error;
  }
  return {
    async offer(entryId, sku) {
      const itemId = await request('offer', entryId, sku);
      return {
        panel: (body) => request('panel', entryId, body),
        publicOffer: () => request('publicOffer', itemId),
      };
    },
    close,
  };
}
