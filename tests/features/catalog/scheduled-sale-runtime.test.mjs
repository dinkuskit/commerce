// The built Registry bundle of Commerce, run in-process by a real EmDash runtime on Node's built-in SQLite: an Editor's
// and an Author's schedules go through EmDash's own schedule policy, and EmDash's own timer sweep publishes the page.
// Only the final catalog record decides whether the product sells (scheduled-sale-in-commerce-20261122).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDialect } from 'emdash/db/sqlite';
import { sql } from 'kysely';
import { adaptSandboxEntry } from 'emdash/internal/plugins/adapt-sandbox-entry';

// EmDash's runtime imports modules Astro generates for a real site, and reads Vite's import.meta.env; this test builds
// the runtime itself, as a production site would run it.
registerHooks({
  resolve: (specifier, context, next) => specifier.startsWith('virtual:emdash/') ? { url: 'data:text/javascript,export default undefined;', shortCircuit: true } : next(specifier, context),
  load(url, context, next) {
    const loaded = next(url, context);
    if (!url.includes('/node_modules/emdash/dist/') || !loaded.source) return loaded;
    return { ...loaded, source: String(loaded.source).replaceAll('import.meta.env', '({ DEV: false, PROD: true })') };
  },
});
const { EmDashRuntime } = await import('emdash/internal/plugin-test-runtime');
const { PluginStorageRepository, SchemaRegistry } = await import('emdash');
import descriptor from '../../../dist/sandbox/index.mjs';
import definition from '../../../dist/sandbox/plugin.mjs';
import { createCatalogItem, linkProductPage } from '../../../dist/features/catalog/kernel/index.js';

const ID = 'dinkus-commerce';
const EDITOR = { id: 'editor', role: 40 }, AUTHOR = { id: 'author', role: 30 };

async function store() {
  const dir = mkdtempSync(join(tmpdir(), 'commerce-schedule-'));
  const url = `file:${join(dir, 'store.db')}`;
  const runtime = await EmDashRuntime.create({
    config: { database: { entrypoint: `commerce-schedule-${crypto.randomUUID()}`, type: 'sqlite', config: { url } } },
    plugins: [adaptSandboxEntry(definition, descriptor)],
    createDialect: () => createDialect({ url }),
    createStorage: null,
    createScheduler: null,
    sandboxEnabled: false,
    sandboxedPluginEntries: [],
  });
  await runtime.ensureStorageIndexesSynced();
  const schema = new SchemaRegistry(runtime.db);
  await schema.createCollection({ slug: 'products', label: 'Products', labelSingular: 'Product', supports: ['drafts', 'scheduling'] });
  await schema.createField('products', { slug: 'title', label: 'Title', type: 'string' });
  const storage = (name) => new PluginStorageRepository(runtime.db, ID, name, [...(descriptor.storage[name].indexes ?? []), ...(descriptor.storage[name].uniqueIndexes ?? [])]);
  const catalog = storage('catalog_items'), pages = storage('product_pages');
  return {
    runtime, catalog,
    /** A draft Products page whose panel picked a new product, as the page's first Save does. */
    async page(sku) {
      const created = await runtime.handleContentCreate('products', { data: { title: `${sku} mug` }, slug: sku.toLowerCase() });
      assert.equal(created.success, true, JSON.stringify(created.error));
      const entryId = created.data.item.id;
      await createCatalogItem(catalog, { commandId: `create-${sku}`, name: sku, sku, fulfillment: 'physical' }, { createId: () => sku, collection: 'catalog_items', offSale: true });
      await storage('catalog_prices').put(sku, { recordKind: 'catalog-price', recordId: sku, catalogItemId: sku, regular: { currency: 'USD', minor: '900' } });
      // A product made for its page starts as a Draft, off the shop, until the page sells it.
      await linkProductPage({ catalog, pages }, entryId, sku);
      return entryId;
    },
    schedule: (entryId, at, actor) => runtime.handleContentSchedule('products', entryId, at, { actor, origin: { source: 'api' } }),
    async sold(sku) { const item = await catalog.get(sku); return Boolean(item?.pageId) && !item.offSale; },
    async stop() { try { await runtime.db.destroy(); } catch {} rmSync(dir, { recursive: true, force: true }); },
  };
}

test('EmDash\'s timer publishing the built Commerce sells only an Editor\'s schedule, even with an Author asking at the same moment', async () => {
  const shop = await store();
  try {
    const at = new Date(Date.now() + 1500).toISOString();
    const editors = await shop.page('EDIT'), authors = await shop.page('AUTH'), together = await shop.page('BOTH');
    const forwards = await shop.page('FORW'), backwards = await shop.page('BACK'), mixed = await shop.page('MIX');
    const ok = (result) => assert.equal(result.success, true, JSON.stringify(result.error));
    ok(await shop.schedule(editors, at, EDITOR));
    ok(await shop.schedule(authors, at, AUTHOR));
    // One after the other, in each order.
    ok(await shop.schedule(forwards, at, EDITOR));
    ok(await shop.schedule(forwards, at, AUTHOR));
    ok(await shop.schedule(backwards, at, AUTHOR));
    ok(await shop.schedule(backwards, at, EDITOR));
    // At once: EmDash keeps one and may refuse the other as changed meanwhile, after both asked Commerce.
    const both = await Promise.all([shop.schedule(together, at, EDITOR), shop.schedule(together, at, AUTHOR)]);
    assert.ok(both.some((result) => result.success), JSON.stringify(both.map((result) => result.error ?? 'kept')));
    console.log('overlapping schedules', JSON.stringify(both.map((result) => (result.success ? 'kept' : result.error.code))));
    // An Editor's schedule, then two Authors at once for that moment and for a later one: whichever EmDash keeps, the
    // later request cannot hide the Author's request for the Editor's moment.
    ok(await shop.schedule(mixed, at, EDITOR));
    const later = new Date(Date.parse(at) + 60_000).toISOString();
    const authors2 = await Promise.all([shop.schedule(mixed, at, AUTHOR), shop.schedule(mixed, later, AUTHOR)]);
    assert.ok(authors2.some((result) => result.success));
    console.log('overlapping Author schedules', JSON.stringify(authors2.map((result) => (result.success ? 'kept' : result.error.code))));
    const mixedAt = (await shop.runtime.handleContentGet('products', mixed)).data.item.scheduledAt;
    await new Promise((resolve) => setTimeout(resolve, 1700));
    const published = await shop.runtime.publishScheduled();
    const due = mixedAt === at ? 6 : 5;
    assert.equal(published.length, due, 'EmDash published every page due');
    for (const entryId of [editors, authors, together, forwards, backwards, ...(due === 6 ? [mixed] : [])]) {
      assert.equal((await shop.runtime.handleContentGet('products', entryId)).data.item.status, 'published');
    }
    assert.equal(await shop.sold('EDIT'), true, "an Editor's schedule sells");
    assert.equal((await shop.catalog.get('EDIT')).name, 'EDIT mug', 'under the published title');
    assert.equal(await shop.sold('AUTH'), false, "an Author's schedule leaves a Draft");
    assert.equal(await shop.sold('BOTH'), false, 'an Author asking at the same moment withdraws the sale');
    assert.equal(await shop.sold('FORW'), false, 'one after the other');
    assert.equal(await shop.sold('BACK'), false, 'in either order');
    assert.equal(await shop.sold('MIX'), false, 'an Author asking for another moment at once hides nothing');
    console.log('scheduled-sale proof', JSON.stringify(Object.fromEntries(await Promise.all(['EDIT', 'AUTH', 'BOTH', 'FORW', 'BACK', 'MIX']
      .map(async (sku) => [sku, { pageId: (await shop.catalog.get(sku)).pageId ?? null, offSale: (await shop.catalog.get(sku)).offSale ?? false }])))));
  } finally {
    await shop.stop();
  }
});

test('a scheduled sale the store could not save is saved by the background check, behind other pages\' schedules', async () => {
  const shop = await store();
  try {
    const at = new Date(Date.now() + 1500).toISOString(), much = new Date(Date.now() + 86_400_000).toISOString();
    const page = await shop.page('MUG');
    assert.equal((await shop.schedule(page, at, EDITOR)).success, true);
    // Sixty other pages wait on schedules for tomorrow.
    for (let n = 0; n < 60; n += 1) assert.equal((await shop.schedule(await shop.page(`WAIT${n}`), much, EDITOR)).success, true);
    // The catalog cannot be written when the timer publishes the page.
    await sql`CREATE TRIGGER busy BEFORE UPDATE ON _plugin_storage WHEN NEW.collection = 'catalog_items' BEGIN SELECT RAISE(ABORT, 'database is busy'); END`.execute(shop.runtime.db);
    await new Promise((resolve) => setTimeout(resolve, 1700));
    assert.equal((await shop.runtime.publishScheduled()).length, 1);
    assert.equal((await shop.runtime.handleContentGet('products', page)).data.item.status, 'published');
    assert.equal(await shop.sold('MUG'), false, 'the sale was not saved');
    await sql`DROP TRIGGER busy`.execute(shop.runtime.db);
    // EmDash runs Commerce's five-minute background check.
    await shop.runtime.hooks.invokeCronHook(ID, { name: 'commerce-checkout-wakes', scheduledAt: new Date().toISOString() });
    assert.equal(await shop.sold('MUG'), true, 'the background check saved it');
    assert.equal(await shop.sold('WAIT0'), false);
    console.log('retried sale', JSON.stringify({ MUG: await shop.sold('MUG'), waiting: 60 }));
  } finally {
    await shop.stop();
  }
});
