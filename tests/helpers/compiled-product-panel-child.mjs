import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSandboxRunner } from '@emdash-cms/sandbox-workerd/sandbox';
import { createDialect } from 'emdash/db/sqlite';

// Mount the editor endpoint's dispatcher without the Astro admin frontend.
// These shims run only in this fixture process, never in Playwright's loader.
registerHooks({
  resolve: (specifier, context, next) => specifier.startsWith('virtual:emdash/')
    ? { url: 'data:text/javascript,export default undefined;', shortCircuit: true }
    : next(specifier, context),
  load(url, context, next) {
    const loaded = next(url, context);
    return url.includes('/node_modules/emdash/dist/') && loaded.source
      ? { ...loaded, source: String(loaded.source).replaceAll('import.meta.env', '({ DEV: false, PROD: true })') }
      : loaded;
  },
});

const site = 'https://shop.example.test';
const editor = { id: 'editor', email: 'editor@shop.example.test', name: 'Editor', role: 40, createdAt: new Date() };
let dir, runtime, descriptor;

async function call(route, body, editorContext, query = '') {
  const result = await runtime.handlePluginApiRoute(descriptor.id, body ? 'POST' : 'GET', route,
    new Request(`${site}/${query}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    body ? editor : null, undefined, editorContext);
  assert.equal(result.success, true, JSON.stringify(result.error));
  return result.data;
}

const actions = {
  async start() {
    ({ default: descriptor } = await import('../../dist/sandbox/index.mjs'));
    const code = await readFile(new URL('../../dist/sandbox/plugin.mjs', import.meta.url), 'utf8');
    const { EmDashRuntime } = await import('emdash/internal/plugin-test-runtime');
    dir = await mkdtemp(join(tmpdir(), 'commerce-product-panel-'));
    const url = `file:${join(dir, 'site.db')}`;
    runtime = await EmDashRuntime.create({
      config: { siteUrl: site, database: { entrypoint: dir, type: 'sqlite', config: { url } } },
      plugins: [], createDialect: () => createDialect({ url }), createStorage: null, createScheduler: null,
      sandboxEnabled: true, createSandboxRunner, sandboxedPluginEntries: [{ ...descriptor, code }],
    });
    await runtime.ensureStorageIndexesSynced();
  },
  async offer(entryId, sku) {
    const made = await call('catalog', { op: 'create', commandId: entryId, entryId, name: 'Trail Tote', sku, regular: '20', stockStatus: 'in-stock' });
    await call('catalog-items/set-on-sale', { entryId, onSale: true });
    return made.catalogItemId;
  },
  panel(entryId, body) {
    const policy = runtime.getPluginEditorExtension(descriptor.id, 'panel', 'product', 'products')?.policy;
    assert.ok(policy);
    return call('product-panel', body, { kind: 'panel', policy, ui: {
      surface: 'content-editor-panel', locale: 'en', direction: 'ltr', extensionId: 'product',
      entry: { collection: 'products', id: entryId, locale: null, version: 1 },
    } });
  },
  publicOffer(itemId) {
    return call('catalog/public/item', undefined, undefined, `?${new URLSearchParams({ itemId })}`);
  },
};

let pending = Promise.resolve();
process.on('message', ({ id, method, args }) => {
  pending = pending.then(async () => {
    let reply;
    try { reply = { id, result: await actions[method](...args) }; }
    catch (error) { reply = { id, error: String(error.stack ?? error) }; }
    if (process.connected) process.send(reply, () => {});
  });
});

process.once('disconnect', async () => {
  // Also runs after a rejected start or if the Playwright worker goes away.
  await pending;
  try {
    try { await runtime?.shutdown(); }
    finally { await runtime?.db.destroy(); }
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});
