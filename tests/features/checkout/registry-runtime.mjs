// Synthetic transport/issuer profile around the actual compiled default entrypoint.
// All plugin contexts and storage/CAS calls come from EmDash's real workerd bridge.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { generateKeyPair, SignJWT, jwtVerify } from 'jose';
import { PluginStorageRepository, createSettingsAccess } from 'emdash';
import { OptionsRepository } from 'emdash/internal/plugins/host';
import { WorkerdSandboxRunner } from '@emdash-cms/sandbox-workerd/sandbox';
import { COMMERCE_REGISTRY_RUNTIME_ID, REGISTRY_CHECKOUT_CONFIG_SCHEMA } from '../../../dist/features/checkout/index.js';

// A fresh key exists only in this isolated test process. No operator key is read.
process.env.EMDASH_ENCRYPTION_KEY = 'emdash_enc_v1_' + randomBytes(32).toString('base64url');
const artifact = JSON.parse(await readFile(new URL('../../../dist/sandbox/manifest.json', import.meta.url)));
const backend = await readFile(new URL('../../../dist/sandbox/plugin.mjs', import.meta.url), 'utf8');
const pair = await generateKeyPair('RS256');
export const SITE = 'https://shop.example.test';
// Public IP literal avoids DNS; the approved test-only HTTP callback intercepts every request.
// No connection is made to this address. Production grants remain empty.
export const TRANSPORT_ORIGIN = 'https://8.8.8.8';
const ISSUER = 'https://identity.example.test';
const AUDIENCE = 'synthetic-payments';
const SITE_ID = 'synthetic-site';
const BINDING = 'synthetic-binding';
const ACCOUNT = 'acct_synthetic';
// A second public IP literal stands in for the hosted coupon service; it is intercepted too.
export const COUPONS_ORIGIN = 'https://8.8.4.4';
const COUPONS_AUDIENCE = 'synthetic-coupons';
export const COUPONS = { origin: COUPONS_ORIGIN, audience: COUPONS_AUDIENCE };
export function configuration(shipping = { configurationId: 'shipping-synthetic', revision: 1, mode: 'free' }) {
  return { schema: REGISTRY_CHECKOUT_CONFIG_SCHEMA, enabled: true, commerceOrigin: SITE,
    siteId: SITE_ID, paymentsOrigin: TRANSPORT_ORIGIN, bindingRef: BINDING,
    providerId: 'stripe', mode: 'test', stripeAccountId: ACCOUNT, pricingSchema: 'dinkuskit.commerce.checkout-pricing/v1',
    issuer: ISSUER, audience: AUDIENCE, shipping };
}
/** Exact legacy enabled v1 shape: no mode, no authorizeNetMerchantId. */
export function legacyStripeConfiguration(shipping) {
  const { mode: _omitMode, ...legacy } = configuration(shipping);
  return legacy;
}
export function authorizeNetConfiguration(extra = {}, shipping = { configurationId: 'shipping-synthetic', revision: 1, mode: 'free' }) {
  const { stripeAccountId: _omit, ...base } = configuration(shipping);
  return { ...base, providerId: 'authorize_net', ...extra };
}
export async function credential(changes = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: ISSUER, aud: AUDIENCE, sub: 'synthetic-owner', site_id: SITE_ID,
    scope: 'payments:checkout', iat: now, exp: now + 1800, ...changes })
    .setProtectedHeader({ alg: 'RS256' }).sign(pair.privateKey);
}

/** A coupons:checkout pass for the coupon service, from the same issuer as the Payments pass. */
export function couponCredential(changes = {}) {
  return credential({ aud: COUPONS_AUDIENCE, scope: 'coupons:checkout', ...changes });
}
export async function verifyCouponPass(header) {
  const bearer = header?.replace(/^Bearer /, '');
  if (!bearer) return false;
  const { payload } = await jwtVerify(bearer, pair.publicKey,
    { issuer: ISSUER, audience: COUPONS_AUDIENCE, algorithms: ['RS256'], maxTokenAge: '1h', requiredClaims: ['sub', 'iat', 'exp'] });
  return payload.site_id === SITE_ID && payload.scope.split(' ').includes('coupons:checkout');
}

export async function runtimeFixture({
  grants = true,
  config = configuration(),
  token,
  managed = false,
  databasePath = ':memory:',
  seed = true,
  transportFetch,
  couponPass = null,
  couponService,
} = {}) {
  const sqlite = new BetterSqlite3(databasePath);
  // Minimal tables match the pinned SDK's options and plugin-storage schemas.
  // Storage operations below use the real repositories/bridge, never emulated CAS.
  sqlite.exec(`CREATE TABLE IF NOT EXISTS options (name TEXT PRIMARY KEY, value TEXT NOT NULL, revision TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS _plugin_storage (plugin_id TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL,
      data TEXT NOT NULL, revision TEXT NOT NULL DEFAULT '0', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(plugin_id,collection,id));`);
  const counts = { credentials: 0, transport: 0, scheduler: 0, acknowledgments: 0, coupons: 0 };
  const owner = COMMERCE_REGISTRY_RUNTIME_ID;
  const db = new Kysely({ dialect: new SqliteDialect({ database: sqlite }), log(event) {
    if (event.level !== 'query') return;
    const query = event.query;
    if (/^select /i.test(query.sql) && query.sql.includes('"options"') &&
      query.parameters.includes(`plugin:${owner}:settings:installedCheckoutCredential`)) counts.credentials++;
    if (query.sql.includes('_emdash_cron_tasks')) counts.scheduler++;
  } });
  const manifest = structuredClone(artifact);
  manifest.id = owner;
  // Explicit SYNTHETIC fixture variant only. Never mutate the shipped manifest or publish this variant.
  if (grants) { manifest.capabilities = ['network:request']; manifest.allowedHosts = ['8.8.8.8', '8.8.4.4']; }
  const collections = {};
  for (const [name, spec] of Object.entries(manifest.storage)) {
    collections[name] = new PluginStorageRepository(db, owner, name,
      [...spec.indexes, ...(spec.uniqueIndexes ?? [])]);
    // Real SQL uniqueness matches the SDK's expression-index definition and manifest fields.
    for (const [index, fields] of (spec.uniqueIndexes ?? []).entries()) {
      const fieldList = Array.isArray(fields) ? fields : [fields];
      assert.ok(fieldList.every(field => /^[A-Za-z_][A-Za-z0-9_]*$/.test(field)));
      const expressions = fieldList.map(field => `json_extract(data, '$.${field}')`).join(',');
      sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_plugin_${owner}_${name}_${fieldList.join('_')}" ON _plugin_storage(plugin_id,collection,${expressions})`);
    }
  }
  const settings = createSettingsAccess(new OptionsRepository(db), owner, manifest.admin.settingsSchema);
  if (config !== null) await settings.set('installedCheckout', JSON.stringify(config));
  if (token !== null) await settings.set('installedCheckoutCredential', token ?? await credential());
  if (couponPass !== null) await settings.set('installedCheckoutCouponsCredential', couponPass);
  if (seed) await collections.catalog_items.put('hat', {
    recordKind: 'catalog-item', itemId: 'hat', commandId: 'synthetic-create-hat', sku: 'HAT', skuKey: 'HAT', fulfillment: 'digital',
    creationIntent: { manageStock: managed }, kind: 'simple-product', name: 'Hat', state: 'draft',
    stockManagement: managed ? { mode: 'managed', status: 'active', inventorySkuId: 'sku-synthetic' } : { mode: 'unmanaged' },
    createdAt: new Date().toISOString(),
  });
  if (seed) await collections.catalog_prices.put('hat', { recordKind: 'catalog-price', recordId: 'hat', catalogItemId: 'hat',
    regular: { currency: 'USD', minor: '250' } });
  if (seed) await collections.catalog_manual_availability.put('hat', {
    recordKind: 'catalog-manual-availability', recordId: 'hat', catalogItemId: 'hat', status: 'in-stock' });
  if (seed && managed) await collections.store_inventory_configurations.put('active', {
    recordKind: 'store-inventory-configuration', recordId: 'active', configurationKey: 'active', siteId: SITE_ID,
    binding: { providerRef: 'inventory-synthetic', poolId: 'pool-synthetic', defaultFulfillmentLocationId: 'location-synthetic' },
    configuredAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const requests = [], sessions = new Map();
  let paid = false, pending = [], override;
  const json = value => Response.json(value);
  async function transport(url, init) {
    if (couponService && new URL(url).origin === COUPONS_ORIGIN) {
      counts.coupons++;
      assert.equal(init.redirect, 'manual');
      return couponService(url, init);
    }
    counts.transport++;
    assert.equal(new URL(url).origin, TRANSPORT_ORIGIN);
    assert.equal(init.redirect, 'manual'); // EmDash enforces redirect policy itself.
    const headers = new Headers(init.headers);
    const bearer = headers.get('authorization')?.replace(/^Bearer /, '');
    assert.ok(Boolean(bearer));
    const { payload } = await jwtVerify(bearer, pair.publicKey,
      { issuer: ISSUER, audience: AUDIENCE, algorithms: ['RS256'], maxTokenAge: '1h', requiredClaims: ['sub', 'iat', 'exp'] });
    assert.equal(payload.site_id, SITE_ID);
    assert.equal(headers.get('x-dinkus-site'), SITE_ID);
    assert.ok(payload.scope.split(' ').includes('payments:checkout'));
    const path = new URL(url).pathname;
    if (override) return override(path, init);
    if (path.endsWith('-binding')) {
      const providerId = config?.providerId === 'authorize_net' ? 'authorize_net' : 'stripe';
      return json(providerId === 'authorize_net'
        ? { bindingRef: BINDING, providerId, authorizeNetMerchantId: config?.authorizeNetMerchantId ?? 'anet_merchant', mode: 'test', ready: true }
        : { bindingRef: BINDING, providerId, stripeAccountId: ACCOUNT, mode: 'test', ready: true });
    }
    if (path === '/v1/checkout/wakes') return json(pending);
    if (path === '/v1/checkout/wakes/ack') {
      const event = JSON.parse(new TextDecoder().decode(init.body));
      const association = await collections.checkout_payment_associations.get(event.attemptId);
      const record = await collections.checkout_carts.get(association.cartId);
      const attempt = record.attempts.find(value => value.attemptId === event.attemptId);
      assert.equal(attempt.phase, 'paid');
      assert.ok(Boolean(attempt.order));
      assert.deepEqual(event, pending[0]);
      counts.acknowledgments++;
      pending = [];
      return json({ acknowledged: true });
    }
    const request = JSON.parse(new TextDecoder().decode(init.body));
    if (path === '/v1/checkout/session') {
      requests.push(structuredClone(request));
      const now = Math.floor(Date.now() / 1000);
      sessions.set(request.attemptId, { sessionId: 'cs_synthetic_' + request.attemptId,
        redirectUrl: 'https://pay.example.test/synthetic', createdAt: now, expiresAt: now + 1830 });
    }
    const session = sessions.get(request.attemptId);
    if (!session) return json({ outcome: 'not-created' });
    return json({ outcome: paid ? 'paid' : 'open', attemptId: request.attemptId,
      total: request.total, session, ...(paid ? { paymentId: 'pi_synthetic' } : {}) });
  }
  const runner = new WorkerdSandboxRunner({ db, siteInfo: { name: 'Synthetic fixture', url: SITE, locale: 'en' },
    httpFetch: transportFetch ? (...args) => { counts.transport++; return transportFetch(...args); } : transport, limits: { wallTimeMs: 15000 } });
  assert.equal(runner.isAvailable(), true, 'actual pinned workerd binary must be available');
  const plugin = await runner.load(manifest, backend);
  const invoke = (route, input = {}, capability, origin = SITE) => plugin.invokeRoute(route, input, {
    url: `${SITE}/_emdash/api/plugins/${owner}/${route}`, method: 'POST',
    headers: { origin, 'sec-fetch-site': 'same-origin', ...(capability ? { 'x-commerce-guest-capability': capability } : {}) },
  });
  return { manifest, artifact, runner, plugin, invoke, settings, collections, counts, requests,
    setPaid() { paid = true; },
    setWakes(values) { pending = structuredClone(values); },
    setTransportOverride(fn) { override = fn; },
    async cartRecords() { return (await collections.checkout_carts.query()).items.map(item => item.data); },
    async close() { await runner.terminateAll(); await db.destroy(); },
  };
}
