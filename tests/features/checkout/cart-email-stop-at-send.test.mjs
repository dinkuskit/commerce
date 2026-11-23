// The built Registry bundle of Commerce, in a workerd isolate behind a real EmDash runtime on Node's built-in SQLite, with
// a stand-in email sender: a cart email that was already waiting when its shopper stopped cart emails is refused at send
// time, and the refusal reaches the plugin that sent it (cart-email-stop-at-send-20261123).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDialect } from 'emdash/db/sqlite';

registerHooks({
  resolve: (specifier, context, next) => specifier.startsWith('virtual:emdash/') ? { url: 'data:text/javascript,export default undefined;', shortCircuit: true } : next(specifier, context),
  load(url, context, next) {
    const loaded = next(url, context);
    if (!url.includes('/node_modules/emdash/dist/') || !loaded.source) return loaded;
    return { ...loaded, source: String(loaded.source).replaceAll('import.meta.env', '({ DEV: false, PROD: true })') };
  },
});
const { EmDashRuntime } = await import('emdash/internal/plugin-test-runtime');
const { PluginStorageRepository, definePlugin } = await import('emdash');
import { readFileSync } from 'node:fs';
import descriptor from '../../../dist/sandbox/index.mjs';
const { createSandboxRunner } = await import('@emdash-cms/sandbox-workerd/sandbox');
const code = readFileSync(new URL('../../../dist/sandbox/plugin.mjs', import.meta.url), 'utf8');

const sha256 = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
const link = 'https://shop.test/cart/c/cap_1?key=k1';
// Store emails' cart email: the cart link, and the stop link in both parts (HTML escapes the ampersand).
const cartEmail = to => ({ to, subject: 'You left something in your cart', text: `Back to your cart: ${link}\nStop these emails: ${link}&stop=1`,
  html: `<a href="${link}">Back to your cart</a> <a href="${link}&amp;stop=1">Stop these emails</a>` });

test('a waiting cart email is refused once its shopper stops cart emails; other emails go', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'commerce-stop-at-send-'));
  const url = `file:${join(dir, 'store.db')}`;
  const delivered = [];
  const sender = definePlugin({ id: 'test-sender', version: '0.0.0', capabilities: ['hooks.email-transport:register'],
    hooks: { 'email:deliver': { exclusive: true, handler: async ({ message }) => { delivered.push(message); } } } });
  const runtime = await EmDashRuntime.create({
    config: { database: { entrypoint: `commerce-stop-${crypto.randomUUID()}`, type: 'sqlite', config: { url } } },
    // Commerce runs as the Registry runs it: its built bundle in a workerd isolate, through EmDash's sandbox bridge.
    plugins: [sender], createSandboxRunner, sandboxEnabled: true, sandboxedPluginEntries: [{ ...descriptor, code }],
    createDialect: () => createDialect({ url }), createStorage: null, createScheduler: null,
  });
  try {
    await runtime.ensureStorageIndexesSynced();
    assert.equal(runtime.email.pipeline.getExclusiveSelection('email:deliver'), 'test-sender');
    // Store emails' ctx.email.send is EmDash's send for its plugin id.
    const send = message => runtime.email.send(message, 'dinkus-email');
    const stops = new PluginStorageRepository(runtime.db, 'dinkus-commerce', 'cart_email_stops', []);

    await send(cartEmail('ana@buyer.test'));
    assert.equal(delivered.length, 1, 'before the stop, the cart email goes');

    // Ana presses "Stop these emails" (Commerce's own stop route keeps the hash of her trimmed, lowercased address).
    await stops.put(await sha256('ana@buyer.test'), { at: String(Math.floor(Date.now() / 1000)) });
    const refused = await send(cartEmail(' Ana@Buyer.test ')).then(() => null, error => error);
    assert.match(String(refused?.message), /CART_EMAIL_STOPPED: /, 'the sender sees the refusal; a cancel would have looked sent');
    assert.equal(delivered.length, 1, 'nothing reached the sender');

    // Her order emails, and another shopper's cart email, still go.
    await send({ to: 'ana@buyer.test', subject: 'Order #1041 confirmed', text: `View your order: https://shop.test/track-order`, html: '<p>Thanks</p>' });
    await send(cartEmail('bo@buyer.test'));
    assert.deepEqual(delivered.map(m => [m.to, m.subject]), [['ana@buyer.test', 'You left something in your cart'],
      ['ana@buyer.test', 'Order #1041 confirmed'], ['bo@buyer.test', 'You left something in your cart']]);
    console.log('cart email stop at send proof', JSON.stringify({ refused: refused.message, delivered: delivered.map(m => [m.to, m.subject]) }));
  } finally {
    await runtime.getSandboxRunner()?.terminateAll();
    try { await runtime.db.destroy(); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});
