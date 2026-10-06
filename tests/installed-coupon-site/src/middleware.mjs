import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { dispatchPluginApiRequest } from 'emdash/internal/plugin-test-runtime';

const trace = globalThis[Symbol.for('commerce:coupon-proof-access')] ??= { count: 0, methods: [] };
const patched = Symbol.for('commerce:coupon-proof-patched');

export async function onRequest(context, next) {
  if (!context.url.pathname.startsWith('/__proof/')) return next();
  if (!import.meta.env.DEV || !['127.0.0.1', 'localhost'].includes(context.url.hostname)) {
    return new Response('Local development proof only', { status: 403 });
  }
  const runtime = context.locals.emdash;
  if (!runtime?.db) return new Response('Host runtime unavailable', { status: 503 });
  const executor = runtime.db.getExecutor();
  if (!executor[patched]) {
    const original = executor.executeQuery;
    executor.executeQuery = function (query, ...args) {
      if (query.sql.includes('_plugin_storage') && query.parameters.includes('coupons')) {
        trace.count++;
        trace.methods.push(query.sql.trim().split(/\s/)[0].toUpperCase());
      }
      return original.call(this, query, ...args);
    };
    Object.defineProperty(executor, patched, { value: true });
  }
  if (context.url.pathname === '/__proof/access') return Response.json(trace);
  if (context.url.pathname === '/__proof/scopes') {
    // Exercises the genuine production dispatch policy with explicit test
    // scopes and the already host-authenticated caller; no bearer is minted.
    if (!context.locals.user) return new Response('Authenticated fixture caller required', { status: 401 });
    return dispatchPluginApiRequest({ runtime, pluginId: process.env.COMMERCE_COUPON_PLUGIN_ID,
      path: '/admin', request: context.request, user: context.locals.user,
      tokenScopes: [context.url.searchParams.get('scope') ?? 'content:read'] });
  }
  if (context.url.pathname !== '/__proof/install' || context.request.method !== 'POST') {
    return new Response('Not found', { status: 404 });
  }
  const pluginId = process.env.COMMERCE_COUPON_PLUGIN_ID;
  const artifact = process.env.COMMERCE_SANDBOX_ARTIFACT;
  const originalManifest = JSON.parse(await readFile(resolve(artifact, '../manifest.json'), 'utf8'));
  const manifest = { ...originalManifest, id: pluginId };
  const backend = await readFile(artifact);
  const prefix = resolve(process.env.COMMERCE_PROOF_STORAGE, 'registry', pluginId, manifest.version);
  await mkdir(prefix, { recursive: true });
  await writeFile(resolve(prefix, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(resolve(prefix, 'backend.js'), backend);
  const now = new Date().toISOString();
  const row = { plugin_id: pluginId, version: manifest.version, status: 'active', installed_at: now, activated_at: now,
    deactivated_at: null, data: null, source: 'registry', marketplace_version: null,
    display_name: manifest.name ?? 'Commerce', description: 'Unsigned local installed runtime proof',
    registry_publisher_did: process.env.COMMERCE_COUPON_PUBLISHER, registry_slug: originalManifest.id,
    mcp_tools_enabled: 0, mcp_tools_consent: null };
  await runtime.db.insertInto('_plugin_state').values(row).onConflict(oc => oc.column('plugin_id').doNothing()).execute();
  const state = await runtime.db.selectFrom('_plugin_state').select(['version', 'source']).where('plugin_id', '=', pluginId).executeTakeFirst();
  if (state?.version !== manifest.version || state?.source !== 'registry') throw new Error('Installed profile identity drift');
  await runtime.syncRegistryPlugins();
  // Astro locals expose a runtime facade. This pinned test-only observer uses
  // the host's documented source singleton to invoke its genuine index sync.
  const instance = globalThis[Symbol.for('emdash:runtime-holder')]?.instance;
  if (instance?.db !== runtime.db || typeof instance.syncPluginStorageIndexesOnce !== 'function') {
    throw new Error('Pinned installed-host index-sync seam changed');
  }
  await instance.syncPluginStorageIndexesOnce();
  if (!runtime.getPluginRouteMeta(pluginId, '/admin')) throw new Error('Registry runtime failed to load coupon admin');
  return Response.json({ pluginId, source: 'registry', configuredCommerce: false,
    backendSha256: createHash('sha256').update(backend).digest('hex'),
    publisherVerification: 'NOT_RUN: unsigned local installed profile, not Registry release acceptance' });
}
