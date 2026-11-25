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

/** The catalog's category door as the panel sees it, and the saved product page: matches for words, or the one category an id names. */
function catalog({ down = false, page = {} } = {}) {
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
  const content = { get: async (collection, id) => (assert.deepEqual([collection, id], ['products', 'page-1']), { id, data: page }) };
  return { asked, ctx: { http: { fetch }, content } };
}
const UI = { surface: 'content-editor-panel', locale: 'en', direction: 'ltr', extensionId: 'product-category', entry: { collection: 'products', id: 'page-1', locale: null, version: 1 } };
const panel = (input, ctx) => productCategoryPanel({ input, ui: UI }, ctx);
// EmDash opens a panel with no draft: the panel reads the saved page.
const load = { type: 'panel_load' };
const notes = out => out.blocks.filter(b => b.type === 'context').map(b => b.text);
const uses = out => out.blocks.filter(b => b.type === 'section').map(b => [b.text, b.accessory.label, b.accessory.action_id, b.accessory.value]);
const sets = out => out.patch?.operations;

test('an unpicked product is offered the best match for its own words, which one click on Use fills in', async () => {
  const { asked, ctx } = catalog({ page: { title: 'Wool beanie', description: 'A warm hat' } });
  const out = await panel(load, ctx);
  validateBlockResponse(out);
  assert.deepEqual(asked, ['Wool beanie A warm hat']);
  assert.deepEqual(notes(out), ["Uncategorized. Suggested from its title and description:"]);
  assert.deepEqual(uses(out), [[HATS.name, 'Use', 'use', HATS]], 'the suggestion has its own Use button');
  assert.equal(out.patch, undefined, 'opening a panel cannot change the draft');
  assert.equal(out.blocks.find(b => b.type === 'form').submit.action_id, 'find');
  const used = await panel({ type: 'block_action', action_id: 'use', value: HATS, draft: { fields: { title: 'Wool beanie' } } }, ctx);
  assert.deepEqual(notes(used), [`${HATS.name}. Save the page to keep it.`]);
  assert.deepEqual(sets(used), [{ op: 'set', field: 'product_category', value: 'aa-2-17' }]);
});

test('a saved category is named, and nothing in the draft changes', async () => {
  const { asked, ctx } = catalog({ page: { title: 'Wool beanie', product_category: 'aa-2-17-2' } });
  const out = await panel(load, ctx);
  assert.deepEqual(asked, ['aa-2-17-2'], 'the saved id is looked up, not the words');
  assert.deepEqual(notes(out), [`Category: ${BEANIES.name}`]);
  assert.deepEqual(uses(out), []);
  assert.equal(out.patch, undefined);
});

test('a search lists matches, and Use fills the box until the page is saved', async () => {
  const { ctx } = catalog();
  const found = await panel({ type: 'form_submit', action_id: 'find', values: { q: 'hat' }, draft: { fields: { product_category: 'aa-2-17' } } }, ctx);
  validateBlockResponse(found);
  assert.equal(sets(found), undefined, 'a search alone changes nothing');
  assert.deepEqual(uses(found), [[HATS.name, 'Use', 'use', HATS], [BEANIES.name, 'Use', 'use', BEANIES]]);
  assert.deepEqual(notes(found), [`Category: ${HATS.name}`], 'the unsaved category in the matches is named');
  const used = await panel({ type: 'block_action', action_id: 'use', value: BEANIES, draft: { fields: { product_category: 'aa-2-17' } } }, ctx);
  validateBlockResponse(used);
  assert.deepEqual(notes(used), [`${BEANIES.name}. Save the page to keep it.`]);
  assert.deepEqual(uses(used), [], 'the matches close once one is used');
  assert.deepEqual(sets(used), [{ op: 'set', field: 'product_category', value: 'aa-2-17-2' }]);
});

test('with the catalog down the box still shows and still searches', async () => {
  const { ctx } = catalog({ down: true, page: { title: 'Wool beanie' } });
  const fresh = await panel(load, ctx);
  assert.deepEqual(notes(fresh), ['Uncategorized']);
  assert.deepEqual(uses(fresh), []);
  assert.deepEqual(notes(await panel(load, catalog({ down: true, page: { product_category: 'aa-2-17' } }).ctx)), ['Category: aa-2-17'], 'the saved id stands in for its name');
  const thrown = { http: { fetch: async () => { throw new TypeError('network down'); } }, content: { get: async () => { throw new Error('gone'); } } };
  assert.deepEqual(notes(await panel(load, thrown)), ['Uncategorized'], 'a page that cannot be read is Uncategorized');
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

/** A store on the built Registry plugin, with a Products page, answering through EmDash's own editor dispatcher. */
async function store(t) {
  const { EmDashRuntime, dispatchPluginEditorExtensionApiRequest } = await import('emdash/internal/plugin-test-runtime');
  const { SchemaRegistry } = await import('emdash');
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
  await runtime.ensureStorageIndexesSynced();
  const schema = new SchemaRegistry(runtime.db);
  await schema.createCollection({ slug: 'products', label: 'Products', labelSingular: 'Product', supports: ['drafts'] });
  for (const slug of ['title', 'description', 'product_category']) await schema.createField('products', { slug, label: slug, type: 'string' });
  const { asked, ctx } = catalog();
  // EmDash checks a named host with Cloudflare's DNS over HTTPS first; answer catalog.dinkuskit.com with a public address.
  const dns = [], realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin + url.pathname !== 'https://cloudflare-dns.com/dns-query') return ctx.http.fetch(url.href, init);
    dns.push(url.searchParams.get('name'));
    const found = url.searchParams.get('name') === 'catalog.dinkuskit.com' && url.searchParams.get('type') === 'A';
    return Promise.resolve(Response.json({ Status: 0, Answer: found ? [{ type: 1, data: '9.9.9.9' }] : [] }));
  };
  t.after(() => { globalThis.fetch = realFetch; });
  const created = await runtime.handleContentCreate('products', { data: { title: 'Wool beanie', description: 'A warm hat' }, slug: 'wool-beanie', authorId: 'author' });
  assert.equal(created.success, true, JSON.stringify(created.error));
  const entryId = created.data.item.id;
  let generation = 0;
  /** The panel as the content editor asks for it: the unsaved fields it may read, from the signed-in person. */
  async function ask(user, interaction, fields) {
    const saved = await runtime.handleContentGet('products', entryId);
    // As the editor sends them: a click carries the unsaved fields the panel may read; opening carries none.
    const draft = fields && { collection: 'products', entryId, locale: saved.data.item.locale ?? null, baseRevision: saved.data._rev, generation: generation++, invocationId: `invocation-${crypto.randomUUID()}`, fields };
    const request = new Request(`https://shop.test/_emdash/api/plugins/dinkus-commerce/editor/panel/product-category/products/${entryId}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-EmDash-Request': '1' }, body: JSON.stringify({ ...interaction, ...draft && { draft } }) });
    const response = await dispatchPluginEditorExtensionApiRequest({ runtime, pluginId: 'dinkus-commerce', kind: 'panel', extensionId: 'product-category', collection: 'products', entryId, request, user });
    return { status: response.status, body: await response.json() };
  }
  return { runtime, entryId, asked, dns, ask };
}
const person = (id, role) => ({ id, email: `${id}@shop.test`, name: id, role, createdAt: new Date() });

test('the Registry build answers an Editor through EmDash\'s own editor dispatcher, may patch only the category, and a saved pick reopens named', async (t) => {
  const shop = await store(t);
  const fields = { title: 'Wool beanie', description: 'A warm hat' };
  const editor = person('editor', 40);
  const opened = await shop.ask(editor, { type: 'panel_load' });
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  assert.deepEqual(shop.asked, ['Wool beanie A warm hat'], 'opening reads the saved page\'s words');
  assert.ok(shop.dns.includes('catalog.dinkuskit.com'), 'the request went through EmDash\'s own allowed-host check');
  assert.deepEqual(notes(opened.body.data), ["Uncategorized. Suggested from its title and description:"]);
  assert.deepEqual(uses(opened.body.data), [[HATS.name, 'Use', 'use', HATS]]);
  const used = await shop.ask(editor, { type: 'block_action', action_id: 'use', value: HATS }, fields);
  assert.equal(used.status, 200, JSON.stringify(used.body));
  assert.deepEqual(sets(used.body.data), [{ op: 'set', field: 'product_category', value: 'aa-2-17' }]);
  assert.equal(used.body.data.editorInvocation.entryId, shop.entryId, 'EmDash issued the patch for this page');
  // Saving the page keeps the pick; opening it again names it and changes nothing.
  const saved = await shop.runtime.handleContentUpdate('products', shop.entryId, { data: { ...fields, product_category: 'aa-2-17' } });
  assert.equal(saved.success, true, JSON.stringify(saved.error));
  const reopened = await shop.ask(editor, { type: 'panel_load' });
  assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
  assert.deepEqual(shop.asked.at(-1), 'aa-2-17', 'the saved id is looked up');
  assert.deepEqual(notes(reopened.body.data), [`Category: ${HATS.name}`]);
  assert.equal(reopened.body.data.patch, undefined);
});

test('someone without content:edit_any, even the page\'s own Author, is refused before the catalog is asked or a patch is made', async (t) => {
  const shop = await store(t);
  for (const [user, role] of [['author', 30], ['contributor', 20], ['subscriber', 10]]) {
    const refused = await shop.ask(person(user, role), { type: 'panel_load' });
    assert.equal(refused.status, 403, `${user}: ${JSON.stringify(refused.body)}`);
    assert.equal(refused.body.error.code, 'FORBIDDEN');
    assert.equal(refused.body.data?.patch, undefined);
    const used = await shop.ask(person(user, role), { type: 'block_action', action_id: 'use', value: BEANIES }, { title: 'Wool beanie' });
    assert.equal(used.status, 403, `${user} using a match: ${JSON.stringify(used.body)}`);
  }
  const nobody = await shop.ask(null, { type: 'panel_load' });
  assert.equal(nobody.status, 401, JSON.stringify(nobody.body));
  assert.deepEqual(shop.asked, [], 'the catalog was never asked');
  assert.deepEqual(shop.dns, [], 'nor its address looked up');
});
