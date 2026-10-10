import assert from 'node:assert/strict';
import test from 'node:test';
import { createHostedCouponPort, projectGuestCheckout, reconcileCheckout, startCheckout } from '../../../dist/features/checkout/index.js';
import { CouponRedemptionError } from '../../../dist/features/coupons/index.js';
import { pricingFixture } from './pricing-fixture.mjs';
import { COUPON_SERVICE_ORIGIN, COUPON_SERVICE_PASS, couponServiceFake } from './coupon-service-fake.mjs';

// Issue 34's neutral case: a 1000-minor-unit item with an accepted 250 discount.
const neutral = { discount: { kind: 'fixed', amount: { currency: 'USD', minor: '250' } }, shipping: '0' };

async function hosted(t, options = neutral) {
  const f = await pricingFixture(t, options);
  f.execution.catalog.prices.records.set('one', { recordKind: 'catalog-price', recordId: 'one', catalogItemId: 'one',
    regular: { currency: 'USD', minor: '1000' } });
  const service = couponServiceFake(f.coupons, { now: () => new Date(f.execution.now() * 1000).toISOString() });
  let fetch = service.fetch;
  f.execution.pricing.coupons = createHostedCouponPort({ origin: COUPON_SERVICE_ORIGIN, siteId: 'site',
    fetch: (url, init) => fetch(url, init), credential: async () => COUPON_SERVICE_PASS });
  return { ...f, service, input: { ...f.input, lines: [{ catalogItemId: 'one', quantity: 1 }] },
    intercept(fn) { fetch = fn; } };
}

const path = url => new URL(url).pathname.replace(/^\/v1\/stores\/site/, '');
const answer = (status, code) => Response.json({ error: { code, message: code } }, { status });

test('hosted coupons price from Commerce, hold before payment, and settle once paid', async t => {
  const f = await hosted(t);
  const a = await startCheckout(f.execution, 'cart', f.input);
  assert.deepEqual(f.service.calls.map(call => call.path),
    ['/quotes', '/redemptions', `/redemptions/${a.attemptId}/provider-session`]);
  const [quoted, reserved] = f.service.calls;
  // Commerce sends its own catalog price and no clock; the service never sees a browser total.
  assert.deepEqual(quoted.body, { quoteId: `${a.attemptId}:coupon`, code: 'SAVE',
    lines: [{ productId: 'one', quantity: 1, regular: { currency: 'USD', minor: '1000' } }] });
  // The hold carries the quote exactly as the service issued it, plus the overall total.
  assert.equal(Object.hasOwn(reserved.body.quote, 'overallPayableTotal'), false);
  assert.deepEqual(reserved.body.overallPayableTotal, { currency: 'USD', minor: '750' });
  const request = f.sessions.get(a.attemptId).request;
  assert.equal(request.total.minor, '750');
  assert.equal(request.pricing.couponDiscount.minor, '250');
  f.setPayment('paid');
  const paid = await reconcileCheckout(f.execution, 'cart', a.attemptId);
  assert.equal(paid.coupon.status, 'consumed');
  assert.deepEqual(f.service.calls.at(-1).body.reconciliation,
    { kind: 'verified-success', providerSessionId: f.sessions.get(a.attemptId).session.sessionId });
  assert.equal((await f.owner.getCounts(f.coupon.couponId)).consumed, 1);
});

test('a coupon service failure at quote never continues at full price', async t => {
  for (const failure of [
    async () => answer(500, 'INTERNAL'),
    async () => { throw new Error('connection timed out'); },
    async () => new Response('<html>bad gateway</html>', { status: 502 }),
  ]) {
    const f = await hosted(t);
    f.intercept(failure);
    await assert.rejects(startCheckout(f.execution, 'cart', f.input), /^Error: Coupon unavailable: try-later$/);
    assert.equal(await f.execution.store.read('cart'), null);
    assert.equal(f.sessions.size, 0);
  }
});

test('a coupon that cannot be used says why, from what Commerce knows', async t => {
  const f = await hosted(t);
  await assert.rejects(startCheckout(f.execution, 'cart', { ...f.input, couponCode: 'NOPE' }),
    /^Error: Coupon unavailable: not-found$/);
  f.setNow(1800000000);
  await assert.rejects(startCheckout(f.execution, 'cart', f.input), /^Error: Coupon unavailable: expired$/);
  f.intercept(async () => answer(503, 'NOT_CONFIGURED'));
  await assert.rejects(startCheckout(f.execution, 'cart', f.input), /^Error: Coupon unavailable: try-later$/);
  assert.equal(await f.execution.store.read('cart'), null);
  assert.equal(f.sessions.size, 0);
});

test('a failed or lost hold starts no payment, and the retry keeps the attempt and the amount', async t => {
  for (const mode of ['failed', 'lost']) {
    const f = await hosted(t);
    let broken = true;
    f.intercept(async (url, init) => {
      if (!broken || path(url) !== '/redemptions') return f.service.fetch(url, init);
      broken = false;
      if (mode === 'failed') return answer(503, 'NOT_CONFIGURED');
      await f.service.fetch(url, init);
      throw new Error('reply lost after the hold was written');
    });
    const first = await startCheckout(f.execution, 'cart', f.input);
    assert.equal(first.phase, 'reserving');
    assert.equal(f.sessions.size, 0);
    const retried = await startCheckout(f.execution, 'cart', f.input);
    assert.equal(retried.attemptId, first.attemptId);
    assert.equal(retried.coupon.status, 'pending');
    assert.equal(f.sessions.get(first.attemptId).request.total.minor, '750');
    assert.equal((await f.owner.getCounts(f.coupon.couponId)).pending, 1);
  }
});

test('a refused or expired hold releases the attempt before any payment', async t => {
  const taken = await hosted(t);
  await startCheckout(taken.execution, 'first', taken.input);
  const refused = await startCheckout(taken.execution, 'second', taken.input);
  assert.equal(refused.phase, 'released');
  assert.equal(taken.sessions.size, 1);
  assert.equal((await taken.owner.getCounts(taken.coupon.couponId)).pending, 1);

  // Past its 24 hours the service no longer has the quote: nothing is held and nothing can be.
  const expired = await hosted(t);
  expired.intercept(async (url, init) => {
    if (path(url) === '/redemptions') expired.service.issued.clear();
    return expired.service.fetch(url, init);
  });
  const released = await startCheckout(expired.execution, 'cart', expired.input);
  assert.equal(released.phase, 'released');
  assert.equal(released.coupon.status, 'released');
  assert.equal(expired.sessions.size, 0);
  assert.deepEqual(expired.service.calls.map(call => call.path),
    ['/quotes', '/redemptions', `/redemptions/${released.attemptId}/release-unstarted`]);
  assert.equal((await expired.coupons.get(expired.coupon.couponId)).attempts.length, 0);
});

test('a quote whose arithmetic disagrees with Commerce prices never freezes a total', async t => {
  for (const tamper of [
    quote => { quote.lines[0].lineSubtotal.minor = '400'; },
    quote => { quote.lines[0].discount.minor = '1200'; quote.discount.minor = '1200'; },
    quote => { quote.payableMerchandiseTotal.minor = '100'; },
  ]) {
    const f = await hosted(t);
    f.intercept(async (url, init) => {
      const response = await f.service.fetch(url, init);
      if (path(url) !== '/quotes') return response;
      const body = await response.json();
      tamper(body.quote);
      return Response.json(body);
    });
    await assert.rejects(startCheckout(f.execution, 'cart', f.input), /Coupon unavailable: try-later/);
    assert.equal(await f.execution.store.read('cart'), null);
    assert.deepEqual(f.service.calls.map(call => call.path), ['/quotes']);
    assert.equal(f.sessions.size, 0);
  }
});

test('a refused coupon says so, and only removing it checks out at full price', async t => {
  const f = await hosted(t);
  await startCheckout(f.execution, 'first', f.input);
  const refused = await startCheckout(f.execution, 'second', f.input);
  assert.equal(refused.phase, 'released');
  assert.equal(refused.coupon.refused, 'used-up');
  const shown = projectGuestCheckout(refused, 0);
  assert.equal(shown.state, 'released-retry');
  assert.deepEqual(shown.unavailable, { code: 'COUPON_UNAVAILABLE', reason: 'used-up',
    message: "Coupon can't be used; remove it to check out at full price" });
  // Asking again with the same coupon is refused again, never charged at full price.
  const again = await startCheckout(f.execution, 'second', f.input, refused.attemptId);
  assert.equal(again.phase, 'released');
  assert.equal(projectGuestCheckout(again, 0).unavailable.reason, 'used-up');
  assert.equal(f.sessions.size, 1);
  // Removing the coupon is the shopper accepting the full price.
  const { couponCode: _dropped, ...withoutCoupon } = f.input;
  const full = await startCheckout(f.execution, 'second', withoutCoupon, again.attemptId);
  assert.equal(full.phase, 'paying');
  assert.equal(f.sessions.get(full.attemptId).request.total.minor, '1000');
  assert.equal(projectGuestCheckout(full, 0).unavailable, null);
});

test('an attempt refused before reasons existed answers the fallback reason', async t => {
  const f = await hosted(t);
  await startCheckout(f.execution, 'first', f.input);
  const refused = await startCheckout(f.execution, 'second', f.input);
  // Attempts saved by the release that added COUPON_UNAVAILABLE stored `refused: true`.
  const legacy = { ...refused, coupon: { ...refused.coupon, refused: true } };
  assert.deepEqual(projectGuestCheckout(legacy, 0).unavailable, { code: 'COUPON_UNAVAILABLE', reason: 'not-applicable',
    message: "Coupon can't be used; remove it to check out at full price" });
});

test('the hosted port answers like the in-process owner', async t => {
  const f = await hosted(t);
  const port = f.execution.pricing.coupons;
  const storage = { catalog: f.execution.catalog.catalog, prices: f.execution.catalog.prices };
  const input = { quoteId: 'q', lines: [{ productId: 'one', quantity: 1 }], now: '2026-10-01T00:00:00Z' };
  await assert.rejects(port.quote('SAVE', storage, { ...input, lines: [{ productId: 'missing', quantity: 1 }] }),
    /Product unpriced/);
  assert.equal(f.service.calls.length, 0);
  assert.equal(await port.quote('NOPE', storage, input), null);
  // A coupon that no longer applies is an error, as it is in process, not a missing code.
  f.setNow(1800000000);
  await assert.rejects(port.quote('SAVE', storage, input), error => !(error instanceof CouponRedemptionError));
  assert.equal(f.service.calls.length, 2);

  const reserve = { couponId: 'c', attemptId: 'a', quote: { quoteId: 'q' }, overallPayableTotal: { currency: 'USD', minor: '1' } };
  for (const code of ['CAPACITY_EXHAUSTED', 'INVALID_INPUT', 'CONFLICTING_ATTEMPT', 'TERMINAL_CONFLICT']) {
    f.intercept(async () => answer(code === 'INVALID_INPUT' ? 400 : 409, code));
    await assert.rejects(port.owner().reserve(reserve), error => error instanceof CouponRedemptionError && error.code === code);
  }
  for (const response of [answer(401, 'UNAUTHENTICATED'), answer(409, 'CONTENTION'), answer(500, 'CORRUPTED_RECORD'),
    Response.json({ attempt: null }), new Response('not json')]) {
    f.intercept(async () => response);
    await assert.rejects(port.owner().reserve(reserve), error => !(error instanceof CouponRedemptionError));
  }
});
