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
    runtime, catalog, pages, prices: storage('catalog_prices'),
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
    /** The store's off-sale check, as the template's publish check calls it for a signed-in Editor. */
    withdraw: (entryId) => runtime.handlePluginApiRoute(ID, 'POST', 'catalog-items/set-on-sale', new Request('https://shop.test/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entryId, onSale: false }) }),
      { id: 'editor', email: 'editor@shop.test', name: 'Editor', role: 40, createdAt: new Date() }),
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

test('a held sale the background check resumes after the owner withdrew the page and an Author published it sells nothing', async () => {
  const shop = await store();
  try {
    const at = new Date(Date.now() + 1500).toISOString();
    const page = await shop.page('LATE');
    const sales = new PluginStorageRepository(shop.runtime.db, ID, 'scheduled_sales', ['page', 'go']);
    assert.equal((await shop.schedule(page, at, EDITOR)).success, true);
    await sql`CREATE TRIGGER busy BEFORE UPDATE ON _plugin_storage WHEN NEW.collection = 'catalog_items' BEGIN SELECT RAISE(ABORT, 'database is busy'); END`.execute(shop.runtime.db);
    await new Promise((resolve) => setTimeout(resolve, 1700));
    assert.equal((await shop.runtime.publishScheduled()).length, 1);
    await sql`DROP TRIGGER busy`.execute(shop.runtime.db);
    assert.equal(await shop.sold('LATE'), false, 'the sale is held for the background check');
    // The background check has read this held sale when it pauses: meanwhile the owner unpublishes the page, the
    // store's off-sale check runs, and an Author publishes the page again, which clears the record.
    const loaded = await sales.get(page + ':go');
    assert.ok(loaded?.fence, JSON.stringify(loaded));
    const steps = [];
    steps.push((await shop.runtime.handleContentUnpublish('products', page, { actor: EDITOR, origin: { source: 'api' } })).success && 'unpublished');
    steps.push((await shop.withdraw(page)).success && 'withdrawn');
    steps.push((await shop.runtime.handleContentPublish('products', page, { actor: AUTHOR, origin: { source: 'api' } })).success && 'Author published');
    assert.equal(await sales.get(page + ':go'), null, "the Author's publish cleared the held sale");
    // The check resumes with the record it had read, as EmDash runs it.
    await sales.put(page + ':go', loaded);
    await shop.runtime.hooks.invokeCronHook(ID, { name: 'commerce-checkout-wakes', scheduledAt: new Date().toISOString() });
    assert.deepEqual(steps, ['unpublished', 'withdrawn', 'Author published']);
    assert.equal((await shop.runtime.handleContentGet('products', page)).data.item.status, 'published');
    assert.equal(await shop.sold('LATE'), false, "the Editor's held sale does not outlive the withdrawal");
    assert.equal(await sales.get(page + ':go'), null, 'and is not tried again');
    console.log('resumed sale', JSON.stringify({ steps, LATE: { sold: await shop.sold('LATE'), fence: loaded.fence, held: await sales.get(page + ':go') } }));
  } finally {
    await shop.stop();
  }
});

test('a permanent delete that stopped halfway is finished by the background check, so the SKU can be used again', async () => {
  const shop = await store();
  try {
    const page = await shop.page('GONE');
    const setOnSale = (body) => shop.runtime.handlePluginApiRoute(ID, 'POST', 'catalog-items/set-on-sale', new Request('https://shop.test/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      { id: 'editor', email: 'editor@shop.test', name: 'Editor', role: 40, createdAt: new Date() });
    assert.equal((await setOnSale({ entryId: page, onSale: true })).success, true);
    // The owner moves the page to the trash and deletes it for good; EmDash deletes it, then the store's publish check
    // tells Commerce, and the Worker stops while Commerce is deleting the product's price.
    assert.equal((await shop.runtime.handleContentDelete('products', page)).success, true);
    assert.equal((await shop.runtime.handleContentPermanentDelete('products', page)).success, true);
    await sql`CREATE TRIGGER stopped BEFORE DELETE ON _plugin_storage WHEN OLD.collection = 'catalog_prices' BEGIN SELECT RAISE(ABORT, 'worker stopped'); END`.execute(shop.runtime.db);
    assert.equal((await setOnSale({ entryId: page, onSale: false, deleted: true })).success, false);
    await sql`DROP TRIGGER stopped`.execute(shop.runtime.db);
    const held = await shop.catalog.get('GONE');
    assert.deepEqual([held?.pageId, held?.offSale, held?.deleting], [page, true, true], 'held off the shop by the deleted page');
    // Nothing else would ever send that delete again. EmDash runs Commerce's five-minute background check.
    await shop.runtime.hooks.invokeCronHook(ID, { name: 'commerce-checkout-wakes', scheduledAt: new Date().toISOString() });
    assert.equal(await shop.catalog.get('GONE'), null, 'the background check finished the delete');
    await createCatalogItem(shop.catalog, { commandId: 'create-GONE-again', name: 'GONE', sku: 'GONE', fulfillment: 'physical' }, { createId: () => 'GONE-2', collection: 'catalog_items' });
    assert.equal((await shop.catalog.get('GONE-2')).sku, 'GONE', 'the SKU is free again');
    console.log('finished delete', JSON.stringify({ before: { pageId: held.pageId === page, offSale: held.offSale, deleting: held.deleting }, after: await shop.catalog.get('GONE') }));
  } finally {
    await shop.stop();
  }
});

test('the background check finishes a stopped delete through the page, so a panel pick it had on sale goes too', async () => {
  const shop = await store();
  try {
    const page = await shop.page('MUG');
    const setOnSale = (body) => shop.runtime.handlePluginApiRoute(ID, 'POST', 'catalog-items/set-on-sale', new Request('https://shop.test/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      { id: 'editor', email: 'editor@shop.test', name: 'Editor', role: 40, createdAt: new Date() });
    assert.equal((await setOnSale({ entryId: page, onSale: true })).success, true);
    // The panel then picked CUP, and a publish check stopped after selling it under this page, before moving the pointer.
    await createCatalogItem(shop.catalog, { commandId: 'create-CUP', name: 'CUP', sku: 'CUP', fulfillment: 'physical' }, { createId: () => 'CUP', collection: 'catalog_items' });
    await linkProductPage({ catalog: shop.catalog, pages: shop.pages }, page, 'CUP');
    await shop.catalog.put('CUP', { ...await shop.catalog.get('CUP'), pageId: page, offSale: undefined });
    assert.equal(await shop.sold('CUP'), true);
    assert.equal((await shop.runtime.handleContentDelete('products', page)).success, true);
    assert.equal((await shop.runtime.handleContentPermanentDelete('products', page)).success, true);
    // The delete stops after holding MUG, before it reaches the pick.
    await sql`CREATE TRIGGER stopped BEFORE UPDATE ON _plugin_storage WHEN OLD.collection = 'catalog_items' AND OLD.id = 'CUP' BEGIN SELECT RAISE(ABORT, 'worker stopped'); END`.execute(shop.runtime.db);
    assert.equal((await setOnSale({ entryId: page, onSale: false, deleted: true })).success, false);
    await sql`DROP TRIGGER stopped`.execute(shop.runtime.db);
    assert.equal((await shop.catalog.get('MUG'))?.deleting, true);
    assert.equal(await shop.sold('CUP'), true, 'the pick is still on sale under the deleted page');
    await shop.runtime.hooks.invokeCronHook(ID, { name: 'commerce-checkout-wakes', scheduledAt: new Date().toISOString() });
    assert.deepEqual([await shop.catalog.get('MUG'), await shop.catalog.get('CUP')], [null, null], 'both products are gone');
    assert.deepEqual((await shop.pages.query({ where: { entryId: page }, limit: 10 })).items, [], 'and the page links after them');
  } finally {
    await shop.stop();
  }
});

test('the background check finishes one stopped delete a run, so a run stays small', async () => {
  const shop = await store();
  try {
    const pages = [await shop.page('ONE'), await shop.page('TWO')];
    for (const page of pages) {
      assert.equal((await shop.runtime.handleContentDelete('products', page)).success, true);
      assert.equal((await shop.runtime.handleContentPermanentDelete('products', page)).success, true);
    }
    // Both deletes stop before deleting anything: each product is held, off the shop, by its deleted page.
    for (const [sku, page] of [['ONE', pages[0]], ['TWO', pages[1]]]) await shop.catalog.put(sku, { ...await shop.catalog.get(sku), pageId: page, offSale: true, deleting: true });
    const run = () => shop.runtime.hooks.invokeCronHook(ID, { name: 'commerce-checkout-wakes', scheduledAt: new Date().toISOString() });
    const left = async () => (await Promise.all(['ONE', 'TWO'].map(sku => shop.catalog.get(sku)))).filter(Boolean).length;
    await run();
    assert.equal(await left(), 1, 'one delete a run');
    await run();
    assert.equal(await left(), 0, 'the next run finishes the other');
  } finally {
    await shop.stop();
  }
});

test('the background check deletes nothing another page owns, nor a product whose page still exists', async () => {
  const shop = await store();
  try {
    const setOnSale = (body) => shop.runtime.handlePluginApiRoute(ID, 'POST', 'catalog-items/set-on-sale', new Request('https://shop.test/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      { id: 'editor', email: 'editor@shop.test', name: 'Editor', role: 40, createdAt: new Date() });
    const live = await shop.page('ALIVE'), gone = await shop.page('GONE'), other = await shop.page('OTHER');
    for (const page of [gone, other, live]) assert.equal((await setOnSale({ entryId: page, onSale: true })).success, true);
    // The deleted page's panel last picked OTHER, which another page owns and sells; its delete stopped before anything went.
    await linkProductPage({ catalog: shop.catalog, pages: shop.pages }, gone, 'OTHER').catch(() => {});
    await shop.pages.put('e:' + gone, { entryId: gone, catalogItemId: 'OTHER' });
    assert.equal((await shop.runtime.handleContentDelete('products', gone)).success, true);
    assert.equal((await shop.runtime.handleContentPermanentDelete('products', gone)).success, true);
    await shop.catalog.put('GONE', { ...await shop.catalog.get('GONE'), offSale: true, deleting: true });
    // A product marked deleting whose page EmDash still has (a stale mark, say a delete sent for a live page that stopped):
    // its page is live and sells it.
    await shop.catalog.put('ALIVE', { ...await shop.catalog.get('ALIVE'), deleting: true });
    const snapshot = async () => ({
      items: { OTHER: await shop.catalog.get('OTHER'), ALIVE: await shop.catalog.get('ALIVE') },
      links: (await shop.pages.query({ where: {}, limit: 100 })).items.filter(row => row.data.entryId !== gone).map(row => [row.id, row.data]).sort(),
      prices: (await shop.prices.query({ where: {}, limit: 100 })).items.filter(row => row.id !== 'GONE').map(row => [row.id, row.data]).sort(),
    });
    const before = await snapshot();
    // EmDash runs the 5-minute check once: it passes over ALIVE (the stale mark, read first) and finishes the deleted page.
    await shop.runtime.hooks.invokeCronHook(ID, { name: 'commerce-checkout-wakes', scheduledAt: new Date().toISOString() });
    const after = await snapshot();
    assert.deepEqual(after, before, 'OTHER and ALIVE, their prices and their pages\' links are exactly as they were');
    assert.equal(await shop.sold('OTHER'), true);
    assert.equal(await shop.sold('ALIVE'), true);
    assert.equal(await shop.catalog.get('GONE'), null, 'the deleted page\'s own product is finished in the same run');
    console.log('forbidden products kept', JSON.stringify({ other: { pageId: after.items.OTHER.pageId === other, onSale: !after.items.OTHER.offSale }, live: { pageId: after.items.ALIVE.pageId === live, deleting: after.items.ALIVE.deleting }, gone: await shop.catalog.get('GONE') }));
  } finally {
    await shop.stop();
  }
});
