import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSandboxRunner } from '@emdash-cms/sandbox-workerd/sandbox';
import { createDialect } from 'emdash/db/sqlite';
import descriptor from '../../dist/sandbox/index.mjs';

// The same runtime dispatcher as the editor's panel endpoint, without building Astro's admin frontend.
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
const { EmDashRuntime } = await import('emdash/internal/plugin-test-runtime');

const site = 'https://shop.example.test';
const editor = { id: 'editor', email: 'editor@shop.example.test', name: 'Editor', role: 40, createdAt: new Date() };

export async function compiledProductPanel() {
  const dir = await mkdtemp(join(tmpdir(), 'commerce-product-panel-'));
  const url = `file:${join(dir, 'site.db')}`;
  const runtime = await EmDashRuntime.create({
    config: { siteUrl: site, database: { entrypoint: dir, type: 'sqlite', config: { url } } },
    plugins: [], createDialect: () => createDialect({ url }), createStorage: null, createScheduler: null,
    sandboxEnabled: true, createSandboxRunner,
    sandboxedPluginEntries: [{ ...descriptor, code: await readFile(new URL('../../dist/sandbox/plugin.mjs', import.meta.url), 'utf8') }],
  });
  await runtime.ensureStorageIndexesSynced();
  const call = async (route, body, editorContext, query = '') => {
    const result = await runtime.handlePluginApiRoute(descriptor.id, body ? 'POST' : 'GET', route,
      new Request(`${site}/${query}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      body ? editor : null, undefined, editorContext);
    assert.equal(result.success, true, JSON.stringify(result.error));
    return result.data;
  };
  return {
    async offer(entryId, sku) {
      const made = await call('catalog', { op: 'create', commandId: entryId, entryId, name: 'Trail Tote', sku, regular: '20', stockStatus: 'in-stock' });
      await call('catalog-items/set-on-sale', { entryId, onSale: true });
      const policy = runtime.getPluginEditorExtension(descriptor.id, 'panel', 'product', 'products')?.policy;
      assert.ok(policy);
      return {
        panel: (body) => call('product-panel', body, { kind: 'panel', policy, ui: {
          surface: 'content-editor-panel', locale: 'en', direction: 'ltr', extensionId: 'product',
          entry: { collection: 'products', id: entryId, locale: null, version: 1 },
        } }),
        publicOffer: () => call('catalog/public/item', undefined, undefined, `?itemId=${made.catalogItemId}`),
      };
    },
    async close() {
      try {
        await runtime.shutdown();
      } finally {
        try { await runtime.db.destroy(); }
        finally { await rm(dir, { recursive: true, force: true }); }
      }
    },
  };
}
