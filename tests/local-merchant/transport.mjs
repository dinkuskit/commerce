// Local fixtures only. Every plugin HTTP request terminates here; no provider traffic.
import { generateKeyPairSync, sign } from 'node:crypto';

export const run = process.env.LOCAL_MERCHANT_RUN;
export const origin = process.env.EMDASH_SITE_URL;
export const siteId = 'local-' + run;
export const bindingRef = 'binding-' + run;
const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'local-fixture', alg: 'ES256' };
const sessions = new Map();
let connection;
let acknowledged = false;
let starts = 0;
function token(audience, scope) {
  const iat = Math.floor(Date.now() / 1000);
  const parts = [{ alg: 'ES256', kid: jwk.kid }, { iss: 'https://dinkuskit.com/account', aud: audience,
    sub: 'local-merchant', site_id: siteId, scope, iat, exp: iat + 300 }]
    .map(x => Buffer.from(JSON.stringify(x)).toString('base64url'));
  return [...parts, sign('sha256', Buffer.from(parts.join('.')), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')].join('.');
}
const json = value => Response.json(value);
const parse = init => JSON.parse(typeof init?.body === 'string' ? init.body : new TextDecoder().decode(init?.body));
export async function fixtureFetch(input, init = {}) {
  const u = new URL(input instanceof Request ? input.url : String(input));
  if (u.origin === 'https://dinkuskit.com') {
    if (u.pathname === '/api/store-connections') {
      const body = parse(init); starts++;
      if (body.site_origin !== origin) throw new Error('Fixture origin mismatch');
      connection = { protocol_version: 2, site_id: siteId, connection_id: 'connection-' + run,
        challenge: 'challenge-' + run, expires_at: Date.now() + 590000, interval: 1,
        verification_uri: origin + '/account/connect?connection_id=connection-' + run };
      return json(connection);
    }
    if (u.pathname === '/api/store-connections/token') {
      if (!connection) throw new Error('Connection not started');
      return json({ access_token: token('dinkus-payments', 'payments:admin'), token_type: 'Bearer', site_id: siteId, expires_in: 300 });
    }
    if (u.pathname === '/account/.well-known/jwks.json') return json({ keys: [jwk] });
    if (u.pathname === '/api/store-passes') {
      const body = parse(init);
      if (body.site_id !== siteId || body.scope !== 'payments:checkout') throw new Error('Fixture pass mismatch');
      return json({ access_token: token(body.audience, body.scope), token_type: 'Bearer', expires_in: 300 });
    }
  }
  if (u.origin === 'https://payments.dinkuskit.com') {
    if (u.pathname === '/v1/status') {
      const paid = [...sessions.values()].find(s => s.paid);
      return json({ state: 'ready', mode: 'test', bindingRef,
        connectionEvidence: { provider: 'stripe', mode: 'test', result: 'verified', accountRef: 'acct_localfixture' },
        ...(paid ? { testOrder: { provider: 'stripe', state: acknowledged ? 'recorded' : 'awaiting_commerce',
          total: paid.total, paidAt: paid.paidAt } } : {}) });
    }
    if (u.pathname.endsWith('-binding')) return json({ bindingRef, providerId: 'stripe', stripeAccountId: 'acct_localfixture', mode: 'test' });
    if (u.pathname === '/v1/checkout/wakes') return json([...sessions.values()].filter(s => s.paid && !acknowledged).map(s => ({
      eventId: 'evt_' + run.replaceAll(/[^a-zA-Z0-9]/g, ''), attemptId: s.attemptId, bindingRef, deliveryGeneration: 1, wokeAt: s.paidAt } )));
    if (u.pathname === '/v1/checkout/wakes/ack') { acknowledged = true; return json({ acknowledged: true }); }
    if (u.pathname === '/v1/checkout/session' || u.pathname === '/v1/checkout/lookup') {
      const request = parse(init);
      if (request.bindingRef !== bindingRef) throw new Error('Fixture binding mismatch');
      if (u.pathname.endsWith('/session') && !sessions.has(request.attemptId)) {
        const now = Math.floor(Date.now() / 1000);
        sessions.set(request.attemptId, { attemptId: request.attemptId, total: request.total, paid: false,
          session: { sessionId: 'cs_fixture_' + request.attemptId, redirectUrl: 'https://pay.example.test/local-fixture', createdAt: now, expiresAt: now + 1830 } });
      }
      const s = sessions.get(request.attemptId);
      return json(s ? { outcome: s.paid ? 'paid' : 'open', attemptId: s.attemptId, total: s.total, session: s.session,
        ...(s.paid ? { paymentId: 'pi_fixture_' + run } : {}) } : { outcome: 'not-created' });
    }
  }
  throw new Error('Unexpected fixture HTTP route');
}
// This changes only the fake provider's ledger. Commerce must observe and commit it itself.
export function payFixture() {
  if (sessions.size !== 1) throw new Error('Expected exactly one fixture session');
  const s = [...sessions.values()][0];
  s.paid = true; s.paidAt ??= Date.now();
}
export function publicReceipt() {
  return { run, siteId, bindingRef, connectionStarts: starts, sessions: [...sessions.values()].map(s => ({
    attemptId: s.attemptId, total: s.total, paid: s.paid, paidAt: s.paidAt })), acknowledged,
    boundary: 'SYNTHETIC issuer / Payments service / Stripe result; no external calls' };
}
