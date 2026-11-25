// An upgrade proof for the backorder ship date (google-backorder-ship-date-20261124):
//   npm run build && COMMERCE_UPGRADE_FROM_SANDBOX=<v0.8.0 checkout>/dist/sandbox node --test tests/upgrade/ship-date-upgrade.test.mjs
// Commerce 0.8.0's own Registry bundle, on 0.8.0's own EmDash (1.4), makes a backordered product and a variant product in a
// real EmDash runtime on SQLite; this checkout's Registry bundle, on this checkout's EmDash, then opens the same database. The 0.8.0 products read, sell and save as before, a date
// can be added per variant, and the Google feed then carries it.
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createDialect } from 'emdash/db/sqlite';
import { adaptSandboxEntry } from 'emdash/internal/plugins/adapt-sandbox-entry';
import { buildGoogleMerchantFeed } from '../../dist/features/feeds/index.js';

registerHooks({
  resolve: (specifier, context, next) => specifier.startsWith('virtual:emdash/') ? { url: 'data:text/javascript,export default undefined;', shortCircuit: true } : next(specifier, context),
  load(url, context, next) {
    const loaded = next(url, context);
    if (!url.includes('/node_modules/emdash/dist/') || !loaded.source) return loaded;
    return { ...loaded, source: String(loaded.source).replaceAll('import.meta.env', '({ DEV: false, PROD: true })') };
  },
});
const { EmDashRuntime } = await import('emdash/internal/plugin-test-runtime');
const { PluginStorageRepository } = await import('emdash');

const from = process.env.COMMERCE_UPGRADE_FROM_SANDBOX;
const ID = 'dinkus-commerce';
const EDITOR = { id: 'editor', email: 'editor@shop.test', name: 'Editor', role: 40, createdAt: new Date() };
const day = days => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

async function open(url, sandbox) {
  const descriptor = (await import(pathToFileURL(join(sandbox, 'index.mjs')).href)).default;
  const definition = (await import(pathToFileURL(join(sandbox, 'plugin.mjs')).href)).default;
  const runtime = await EmDashRuntime.create({
    config: { database: { entrypoint: `commerce-ship-date-${crypto.randomUUID()}`, type: 'sqlite', config: { url } } },
    plugins: [adaptSandboxEntry(definition, descriptor)],
    createDialect: () => createDialect({ url }), createStorage: null, createScheduler: null, sandboxEnabled: false, sandboxedPluginEntries: [],
  });
  // EmDash 1.5 names this step; 0.8.0's EmDash 1.4 runs the same sync as syncPluginStorageIndexesOnce.
  await (runtime.ensureStorageIndexesSynced ? runtime.ensureStorageIndexesSynced() : runtime.syncPluginStorageIndexesOnce());
  const items = new PluginStorageRepository(runtime.db, ID, 'catalog_items', descriptor.storage.catalog_items.indexes);
  const answer = async (method, route, request, user, editor) => {
    const result = await runtime.handlePluginApiRoute(ID, method, route, request, user, undefined, editor);
    assert.equal(result.success, true, JSON.stringify(result.error));
    return result.data;
  };
  const post = (route, body, editor) => answer('POST', route, new Request('https://shop.test/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), EDITOR, editor);
  return {
    items,
    catalog: body => post('catalog', body),
    // The editor's panel dispatch: EmDash posts the bare input and hands the page as the route's ui, checked against the panel's policy.
    panel: (entryId, input) => post('product-panel', input, { kind: 'panel', policy: (runtime.getPluginEditorExtension(ID, 'panel', 'product', 'products') ?? assert.fail('no product panel')).policy,
      ui: { surface: 'content-editor-panel', locale: 'en', direction: 'ltr', extensionId: 'product', entry: { collection: 'products', id: entryId, locale: null, version: 1 } } }),
    item: itemId => answer('GET', 'catalog/public/item', new Request(`https://shop.test/?itemId=${itemId}`), null),
    async close() { try { await runtime.db.destroy(); } catch { /* already closed */ } },
  };
}

/** What a page publish does to a Draft's product: it goes on sale. This harness has no content pages. */
async function publish(shop, id) {
  const record = await shop.items.get(id);
  delete record.offSale;
  await shop.items.put(id, record);
}
const blocksOf = blocks => blocks.flatMap(block => block.type === 'accordion' ? blocksOf(block.blocks) : [block]);
const dateBoxes = view => blocksOf(view.blocks).filter(b => b.type === 'form').flatMap(f => f.fields).filter(f => f.action_id === 'shipBy');

/** The 0.8.0 phase, run by a copy of this file inside the 0.8.0 checkout so it loads that release's own EmDash. */
async function oldPhase(url, sandbox) {
  const old = await open(url, sandbox);
  try {
    const hat = (await old.catalog({ op: 'create', commandId: 'make-hat', entryId: 'page-hat', name: 'Wool hat', sku: 'HAT', regular: '25', stockStatus: 'on-backorder' })).catalogItemId;
    const tee = (await old.catalog({ op: 'create', commandId: 'make-tee', entryId: 'page-tee', name: 'Field tee', sku: 'TEE', regular: '20', stockStatus: 'in-stock' })).catalogItemId;
    await old.catalog({ op: 'option', productId: tee, optionId: 'size', optionLabel: 'Size', values: [
      { valueId: 'm', label: 'M', member: { catalogItemId: tee, fulfillment: 'physical' } },
      { valueId: 'l', label: 'L', member: { commandId: 'tee-l', name: 'Field tee', sku: 'TEE-L', fulfillment: 'physical' } }] });
    const large = (await old.catalog({ op: 'get', catalogItemId: tee })).product.variantProduct.members.find(m => m.sku === 'TEE-L').catalogItemId;
    await old.catalog({ op: 'prices', catalogItemId: large, regular: '22', sale: '', stockStatus: 'on-backorder' });
    await publish(old, hat); await publish(old, tee);
    return { hat, tee, large, oldHat: await old.item(hat), oldTee: await old.item(tee), stored: await old.items.get(hat) };
  } finally { await old.close(); }
}

if (process.env.SHIP_DATE_UPGRADE_PHASE === 'old') {
  console.log('SHIP_DATE_OLD ' + JSON.stringify(await oldPhase(process.env.SHIP_DATE_UPGRADE_URL, process.env.SHIP_DATE_UPGRADE_SANDBOX)));
} else test('products made on 0.8.0 read, sell and save as before, and take a ship date per variant after the upgrade', { skip: !from && 'set COMMERCE_UPGRADE_FROM_SANDBOX' }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'commerce-ship-date-upgrade-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const url = `file:${join(dir, 'store.db')}`;

  // On 0.8.0, on its own EmDash: a simple hat on backorder, and a tee with sizes M (in stock) and L (on backorder).
  const checkout = dirname(dirname(from)), copy = join(checkout, 'tests/upgrade/ship-date-upgrade.phase.mjs');
  mkdirSync(dirname(copy), { recursive: true });
  copyFileSync(fileURLToPath(import.meta.url), copy);
  const run = spawnSync(process.execPath, [copy], { cwd: checkout, encoding: 'utf8',
    env: { ...process.env, SHIP_DATE_UPGRADE_PHASE: 'old', SHIP_DATE_UPGRADE_URL: url, SHIP_DATE_UPGRADE_SANDBOX: from } });
  rmSync(copy, { force: true });
  const line = run.stdout.split('\n').find(l => l.startsWith('SHIP_DATE_OLD '));
  assert.ok(line, run.stdout + run.stderr);
  const { hat, tee, large, oldHat, oldTee, stored } = JSON.parse(line.slice(14));
  assert.equal(Object.hasOwn(stored.catalogData.items[hat].availability, 'shipBy'), false, '0.8.0 stored no date');
  assert.equal(oldHat.availability.status, 'available-on-backorder');
  t.diagnostic(`0.8.0 wrote hat ${hat} (${oldHat.availability.status}) and tee ${tee} with L ${large}`);

  // This build, same database: the public catalog gives exactly what 0.8.0 gave, with no shipBy anywhere.
  const shop = await open(url, join(process.cwd(), 'dist/sandbox'));
  t.after(() => shop.close());
  // Main has added other public fields since 0.8.0 (such as each member's sku); every availability reads exactly as 0.8.0 gave it.
  const stock = product => [product.availability, ...(product.variants?.members ?? []).map(m => [m.catalogItemId, m.availability])];
  assert.deepEqual(stock(await shop.item(hat)), stock(oldHat), 'the 0.8.0 hat\'s stock reads exactly as before');
  assert.deepEqual(stock(await shop.item(tee)), stock(oldTee), 'the 0.8.0 tee\'s stock, M and L, reads exactly as before');
  assert.equal(JSON.stringify(await shop.item(tee)).includes('shipBy'), false);
  const facts = (product) => ({ product, content: { canonicalUrl: `https://shop.test/products/${product.id}`, title: product.name, description: 'Proof', imageUrls: [] }, eligibility: ['google-merchant'] });
  assert.equal(buildGoogleMerchantFeed([facts((await shop.item(hat)))]).includes('<item>'), false, 'an undated backorder stays out of Google');

  // The panel opens on the 0.8.0 hat with an empty date box under On backorder.
  const panel = await shop.panel('page-hat', { type: 'panel_load' });
  assert.deepEqual(dateBoxes(panel).map(b => [b.label, b.initial_value ?? null]), [['Expected ship date', null]]);

  // A 0.8.0-style API save (no shipBy) still works; then dates are added, per variant.
  assert.equal((await shop.catalog({ op: 'prices', catalogItemId: hat, regular: '26', sale: '', stockStatus: 'on-backorder' })).saved, true);
  const hatDate = day(20), largeDate = day(40);
  assert.equal((await shop.catalog({ op: 'prices', catalogItemId: hat, regular: '26', sale: '', stockStatus: 'on-backorder', shipBy: hatDate })).saved, true);
  assert.equal((await shop.catalog({ op: 'prices', catalogItemId: large, regular: '22', sale: '', stockStatus: 'on-backorder', shipBy: largeDate })).saved, true);
  assert.equal((await shop.catalog({ op: 'prices', catalogItemId: hat, regular: '27', sale: '', stockStatus: 'on-backorder' })).saved, true, 'a save with no shipBy keeps the date');
  // The panel, through EmDash's dispatch: its form now starts with the date; a submit that leaves the key out keeps it.
  const form = blocksOf((await shop.panel('page-hat', { type: 'panel_load' })).blocks).find(b => b.type === 'form' && b.submit.action_id.startsWith('save:'));
  assert.equal(dateBoxes({ blocks: [form] })[0].initial_value, hatDate);
  const kept = await shop.panel('page-hat', { type: 'form_submit', action_id: form.submit.action_id, values: { regular: '27', sale: '', sku: 'HAT', stockStatus: 'on-backorder' } });
  assert.equal(kept.toast.type, 'success', JSON.stringify(kept.toast));
  const newHat = (await shop.item(hat)), newTee = (await shop.item(tee));
  assert.equal(newHat.availability.shipBy, hatDate);
  assert.deepEqual(newTee.variants.members.map(m => [m.sku, m.availability.status, m.availability.shipBy]),
    [['TEE', 'in-stock', undefined], ['TEE-L', 'available-on-backorder', largeDate]]);
  const google = buildGoogleMerchantFeed([facts(newHat), facts(newTee)]);
  assert.match(google, new RegExp(`<g:availability_date>${hatDate}T00:00:00Z</g:availability_date>`));
  assert.match(google, new RegExp(`<g:availability_date>${largeDate}T00:00:00Z</g:availability_date>`));
  t.diagnostic(`after upgrade: hat shipBy=${newHat.availability.shipBy}; tee L shipBy=${newTee.variants.members[1].availability.shipBy}, M none; Google rows ${google.match(/<item>/g).length} with availability_date ${google.match(/availability_date>/g).length / 2}`);
});
