import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { validateBlockResponse } from '@emdash-cms/blocks/server';
import { createDialect } from 'emdash/db/sqlite';
import { adaptSandboxEntry } from 'emdash/internal/plugins/adapt-sandbox-entry';
import { productCategoryPanel } from '../../../dist/admin/index.js';

// The Product category panel on a product page (product-category-box-20261125): it copies Shopify's
// Category box, with Shopify's list searched through the DinkusKit catalog (template-product-category-pick-20261124).
const HATS = { id: 'aa-2-17', name: 'Apparel & Accessories > Clothing Accessories > Hats' };
const BEANIES = { id: 'aa-2-17-2', name: 'Apparel & Accessories > Clothing Accessories > Hats > Beanies' };

/** The catalog's category door as the panel sees it: matches for words, or the one category an id names. */
function catalog({ down = false } = {}) {
  const asked = [];
  const fetch = async (url, init) => {
    asked.push(new URL(url).searchParams.get('q'));
    assert.equal(new URL(url).origin + new URL(url).pathname, 'https://catalog.dinkuskit.com/api/categories');
    // The panel refuses redirects; EmDash's own fetch takes them over as manual and checks each hop's host.
    assert.ok(['error', 'manual'].includes(init.redirect), init.redirect);
    if (down) return new Response('{"error":"categories_unavailable"}', { status: 503 });
    const q = new URL(url).searchParams.get('q');
    const categories = /^[a-z]{2}(-\d+)*$/.test(q) ? [HATS, BEANIES].filter(c => c.id === q) : [HATS, BEANIES];
    return Response.json({ taxonomy: 'shopify', version: '2026-11', categories });
  };
  return { asked, ctx: { http: { fetch } } };
}
const panel = (input, ctx) => productCategoryPanel({ input }, ctx);
const load = (fields) => ({ type: 'panel_load', draft: { fields } });
const notes = out => out.blocks.filter(b => b.type === 'context').map(b => b.text);
const uses = out => out.blocks.filter(b => b.type === 'section').map(b => [b.text, b.accessory.label, b.accessory.action_id, b.accessory.value]);
const sets = out => out.patch?.operations;

test('an unpicked product gets the best match from its own words filled in as a suggestion', async () => {
  const { asked, ctx } = catalog();
  const out = await panel(load({ title: 'Wool beanie', description: 'A warm hat' }), ctx);
  validateBlockResponse(out);
  assert.deepEqual(uses(out), [], 'a suggestion lists no matches');
  assert.deepEqual(asked, ['Wool beanie A warm hat']);
  assert.deepEqual(notes(out), [`Suggested: ${HATS.name}. Save the page to keep it.`]);
  assert.deepEqual(out.patch, { type: 'editor-draft-patch', operations: [{ op: 'set', field: 'product_category', value: 'aa-2-17' }] });
  assert.equal(out.blocks.find(b => b.type === 'form').submit.action_id, 'find');
});

test('a saved category is named, and nothing in the draft changes', async () => {
  const { asked, ctx } = catalog();
  const out = await panel(load({ title: 'Wool beanie', product_category: 'aa-2-17-2' }), ctx);
  assert.deepEqual(asked, ['aa-2-17-2'], 'the saved id is looked up, not the words');
  assert.deepEqual(notes(out), [`Category: ${BEANIES.name}`]);
  assert.equal(out.patch, undefined);
});

test('a search lists matches, and Use fills the box until the page is saved', async () => {
  const { ctx } = catalog();
  const found = await panel({ type: 'form_submit', action_id: 'find', values: { q: 'hat' }, draft: { fields: { product_category: 'aa-2-17' } } }, ctx);
  validateBlockResponse(found);
  assert.equal(sets(found), undefined, 'a search alone changes nothing');
  assert.deepEqual(uses(found), [[HATS.name, 'Use', 'use', HATS], [BEANIES.name, 'Use', 'use', BEANIES]]);
  assert.deepEqual(notes(found), [`Category: ${HATS.name}`], 'a saved category in the matches is named');
  const used = await panel({ type: 'block_action', action_id: 'use', value: BEANIES, draft: { fields: { product_category: 'aa-2-17' } } }, ctx);
  validateBlockResponse(used);
  assert.deepEqual(notes(used), [`${BEANIES.name}. Save the page to keep it.`]);
  assert.deepEqual(uses(used), [], 'the matches close once one is used');
  assert.deepEqual(sets(used), [{ op: 'set', field: 'product_category', value: 'aa-2-17-2' }]);
});

test('with the catalog down the box still shows and still searches', async () => {
  const { ctx } = catalog({ down: true });
  const fresh = await panel(load({ title: 'Wool beanie' }), ctx);
  assert.deepEqual(notes(fresh), ['Uncategorized']);
  assert.equal(fresh.patch, undefined);
  assert.deepEqual(notes(await panel(load({ product_category: 'aa-2-17' }), ctx)), ['Category: aa-2-17'], 'the saved id stands in for its name');
  const thrown = { http: { fetch: async () => { throw new TypeError('network down'); } } };
  assert.deepEqual(uses(await panel({ type: 'form_submit', action_id: 'find', values: { q: 'hat' }, draft: { fields: {} } }, thrown)), []);
});

// The built Registry plugin, through EmDash's own panel dispatch and draft-patch policy.
registerHooks({
  resolve: (specifier, context, next) => specifier.startsWith('virtual:emdash/') ? { url: 'data:text/javascript,export default undefined;', shortCircuit: true } : next(specifier, context),
  load(url, context, next) {
    const loaded = next(url, context);
    if (!url.includes('/node_modules/emdash/dist/') || !loaded.source) return loaded;
    return { ...loaded, source: String(loaded.source).replaceAll('import.meta.env', '({ DEV: false, PROD: true })') };
  },
});

test('the Registry build answers the Product category panel and may patch only that field', async (t) => {
  const { EmDashRuntime } = await import('emdash/internal/plugin-test-runtime');
  const sandbox = join(process.cwd(), 'dist/sandbox');
  const descriptor = (await import(pathToFileURL(join(sandbox, 'index.mjs')).href)).default;
  const definition = (await import(pathToFileURL(join(sandbox, 'plugin.mjs')).href)).default;
  const dir = mkdtempSync(join(tmpdir(), 'commerce-category-')), url = `file:${join(dir, 'db.sqlite')}`;
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const runtime = await EmDashRuntime.create({
    config: { database: { entrypoint: `commerce-category-${crypto.randomUUID()}`, type: 'sqlite', config: { url } } },
    plugins: [adaptSandboxEntry(definition, descriptor)],
    createDialect: () => createDialect({ url }), createStorage: null, createScheduler: null, sandboxEnabled: false, sandboxedPluginEntries: [],
  });
  t.after(async () => { try { await runtime.db.destroy(); } catch { /* already closed */ } });
  const extension = runtime.getPluginEditorExtension('dinkus-commerce', 'panel', 'product-category', 'products') ?? assert.fail('no Product category panel');
  const { asked, ctx } = catalog();
  const realFetch = globalThis.fetch;
  // EmDash checks a named host with Cloudflare's DNS over HTTPS first; answer catalog.dinkuskit.com with a public address.
  const dns = [];
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin + url.pathname !== 'https://cloudflare-dns.com/dns-query') return ctx.http.fetch(url.href, init);
    dns.push(url.searchParams.get('name'));
    const found = url.searchParams.get('name') === 'catalog.dinkuskit.com' && url.searchParams.get('type') === 'A';
    return Promise.resolve(Response.json({ Status: 0, Answer: found ? [{ type: 1, data: '9.9.9.9' }] : [] }));
  };
  t.after(() => { globalThis.fetch = realFetch; });
  const editor = { id: 'editor', email: 'editor@shop.test', name: 'Editor', role: 40, createdAt: new Date() };
  const result = await runtime.handlePluginApiRoute('dinkus-commerce', 'POST', 'product-category-panel',
    new Request('https://shop.test/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(load({ title: 'Wool beanie', description: 'A warm hat' })) }),
    editor, undefined, { kind: 'panel', policy: extension.policy, ui: { surface: 'content-editor-panel', locale: 'en', direction: 'ltr', extensionId: 'product-category', entry: { collection: 'products', id: 'page-1', locale: null, version: 1 } } });
  assert.equal(result.success, true, JSON.stringify(result.error));
  assert.deepEqual(asked, ['Wool beanie A warm hat']);
  assert.ok(dns.includes('catalog.dinkuskit.com'), 'the request went through EmDash\'s own allowed-host check');
  assert.deepEqual(notes(result.data), [`Suggested: ${HATS.name}. Save the page to keep it.`]);
  assert.deepEqual(sets(result.data), [{ op: 'set', field: 'product_category', value: 'aa-2-17' }]);
});
