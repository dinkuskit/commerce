// A stand-in for the hosted coupon service (dinkuskit/coupons HTTP contract v1),
// built on Commerce's own coupon core over a test collection, so checkout's
// coupon cases can run through the hosted port. It keeps the contract's
// rules: priced lines, the service's own clock, and the issued-quote check.
import {
  CouponAdminError,
  CouponRedemptionError,
  createCheckoutCouponPort,
  createCouponAttemptOwner,
} from '../../../dist/features/coupons/index.js';

export const COUPON_SERVICE_ORIGIN = 'https://coupons.example.test';
export const COUPON_SERVICE_PASS = 'synthetic-coupon-pass';

const STATUS = { INVALID_INPUT: 400, UNKNOWN_ATTEMPT: 404, CAPACITY_EXHAUSTED: 409, CONFLICTING_ATTEMPT: 409,
  TERMINAL_CONFLICT: 409, CONTENTION: 409, CORRUPTED_RECORD: 500 };

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

class Refusal extends Error {
  constructor(status, code, detail) { super(code); this.status = status; this.code = code; this.detail = detail; }
}

function pricedStorage(lines) {
  const prices = new Map(lines.map(line => [line.productId, line]));
  return {
    catalog: { get: async id => prices.has(id) ? { recordKind: 'catalog-item', itemId: id } : null },
    prices: { get: async id => {
      const line = prices.get(id);
      return line ? { recordKind: 'catalog-price', recordId: id, catalogItemId: id, regular: line.regular,
        ...(line.sale ? { sale: line.sale } : {}) } : null;
    } },
  };
}

export function couponServiceFake(collection, {
  siteId = 'site',
  origin = COUPON_SERVICE_ORIGIN,
  now = () => new Date().toISOString(),
  authorize = async header => header === `Bearer ${COUPON_SERVICE_PASS}`,
} = {}) {
  const issued = new Map();
  const calls = [];
  const owner = createCouponAttemptOwner(collection);
  let down = false;

  async function requireIssued(couponId, attemptId, quote) {
    try { if (await owner.get(couponId, attemptId)) return; }
    catch (error) { if (!(error instanceof CouponRedemptionError && error.code === 'UNKNOWN_ATTEMPT')) throw error; }
    const known = issued.get(quote?.quoteId);
    if (!known || known.couponId !== couponId || known.value !== canonical(quote)) throw new Refusal(409, 'QUOTE_NOT_ISSUED');
  }

  async function handle(path, body) {
    if (path === '/quotes') {
      const { quoteId, code, lines } = body;
      let result;
      try {
        result = await createCheckoutCouponPort(collection).quote(code, pricedStorage(lines), {
          quoteId, lines: lines.map(({ productId, quantity }) => ({ productId, quantity })), now: now(),
        });
      } catch (error) {
        if (error instanceof CouponAdminError && error.code === 'INVALID_INPUT') throw new Refusal(422, 'NOT_APPLICABLE', error.notApplicable);
        throw error;
      }
      if (!result) throw new Refusal(404, 'NOT_FOUND');
      issued.set(quoteId, { couponId: result.couponId, value: canonical(result.quote) });
      return result;
    }
    if (path === '/redemptions') {
      await requireIssued(body.couponId, body.attemptId, body.quote);
      return { attempt: await owner.reserve({ ...body, now: now() }) };
    }
    const [, attemptId, action] = path.match(/^\/redemptions\/([^/]+)\/([a-z-]+)$/) ?? [];
    const id = decodeURIComponent(attemptId ?? '');
    if (action === 'release-unstarted') {
      await requireIssued(body.couponId, id, body.quote);
      return { attempt: await owner.releaseUnstarted({ ...body, attemptId: id }) };
    }
    if (action === 'provider-session') return { attempt: await owner.attachProviderSession(body.couponId, id, body.providerSessionId) };
    if (action === 'reconcile') return { attempt: await owner.reconcile(body.couponId, id, body.reconciliation) };
    if (action === 'free-order') return { attempt: await owner.reconcileFreeOrder({ couponId: body.couponId, attemptId: id, proof: body.proof }) };
    throw new Refusal(404, 'NOT_FOUND');
  }

  async function fetch(url, init) {
    const { pathname } = new URL(url);
    const prefix = `/v1/stores/${encodeURIComponent(siteId)}`;
    if (new URL(url).origin !== origin || !pathname.startsWith(prefix) || init.method !== 'POST') {
      throw new Error(`unexpected coupon service request ${init.method} ${url}`);
    }
    if (!await authorize(new Headers(init.headers).get('authorization'))) {
      return Response.json({ error: { code: 'UNAUTHENTICATED', message: 'bad pass' } }, { status: 401 });
    }
    const path = pathname.slice(prefix.length);
    const body = JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body));
    calls.push({ path, body: structuredClone(body) });
    if (down) return new Response('unavailable', { status: 503 });
    try {
      return Response.json(await handle(path, body));
    } catch (error) {
      const status = error instanceof Refusal ? error.status : error instanceof CouponRedemptionError ? STATUS[error.code] ?? 500 : 500;
      const code = error instanceof Refusal || error instanceof CouponRedemptionError ? error.code : 'INTERNAL';
      return Response.json({ error: { code, message: error.message, ...error.detail } }, { status });
    }
  }

  return { fetch, calls, issued, setDown(value) { down = value; } };
}
