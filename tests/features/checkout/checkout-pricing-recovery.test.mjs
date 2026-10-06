import assert from 'node:assert/strict';
import test from 'node:test';
import { startCheckout, reconcileCheckout, reconcilePaymentWakes, projectGuestCheckout, createTrustedTestPaymentPort, bindGuestCheckoutRuntime, NATIVE_GUEST_CHECKOUT_STORAGE } from '../../../dist/features/checkout/index.js';
import { pricingFixture } from './pricing-fixture.mjs';

test('final zero is rejected before attempt, coupon or provider creation in positive-only slice', async t => {
  const f = await pricingFixture(t, { discount: { kind: 'percentage', basisPoints: 10000 }, shipping: '0' });
  await assert.rejects(startCheckout(f.execution, 'cart', f.input), /Zero-total/);
  assert.equal(await f.execution.store.read('cart'), null);
  assert.equal((await f.owner.getCounts(f.coupon.couponId)).pending, 0);
  assert.equal(f.sessions.size, 0);
});

test('schema support loss after ambiguous provider creation retains the coupon and frozen attempt', async t => {
  const f = await pricingFixture(t);
  f.setPayment('ambiguous');
  const a = await startCheckout(f.execution, 'cart', f.input);
  assert.equal(f.sessions.size, 1);
  f.execution.pricing.paymentPricingSchema = undefined;
  const held = await reconcileCheckout(f.execution, 'cart', a.attemptId);
  assert.equal(held.phase, 'paying');
  assert.equal((await f.owner.getCounts(f.coupon.couponId)).pending, 1);
  f.execution.pricing.paymentPricingSchema = 'dinkuskit.commerce.checkout-pricing/v1';
  f.setPayment('paid');
  const paid = await reconcileCheckout(f.execution, 'cart', a.attemptId);
  assert.equal(paid.phase, 'paid');
  assert.equal((await f.owner.getCounts(f.coupon.couponId)).consumed, 1);
});

test('canonical order stores exact pricing; guest projection excludes internal quote and configuration identities', async t => {
  const f = await pricingFixture(t);
  const a = await startCheckout(f.execution, 'cart', f.input);
  f.setPayment('paid');
  const paid = await reconcileCheckout(f.execution, 'cart', a.attemptId);
  assert.deepEqual(paid.order.pricing, a.payment.pricing);
  const guest = projectGuestCheckout(paid);
  assert.deepEqual(guest.order.pricing, guest.pricing);
  assert.equal(guest.pricing.finalTotal.minor, '200');
  const json = JSON.stringify(guest);
  for (const internal of ['configurationId', 'quoteId', 'ruleId', 'ruleVersion', 'couponId', 'overallPayableTotal']) assert.equal(json.includes(internal), false, internal);
});

test('wake is retained after failed coupon consume and resumes exactly one paid order', async t => {
  const f = await pricingFixture(t);
  const a = await startCheckout(f.execution, 'cart', f.input);
  const cas = f.coupons.compareAndSet.bind(f.coupons);
  let fail = true;
  f.coupons.compareAndSet = async (id, revision, value) => {
    if (fail && value.attempts.some(a => a.state === 'consumed')) throw new Error('coupon storage unavailable');
    return cas(id, revision, value);
  };
  f.setPayment('paid');
  let acknowledgments = 0;
  const wake = { eventId: 'event', attemptId: a.attemptId, bindingRef: a.payment.bindingRef, deliveryGeneration: 1, wokeAt: 1791288000 };
  const associations = { get: async () => ({ attemptId: a.attemptId, cartId: 'cart', bindingRef: a.payment.bindingRef }) };
  const wakes = { list: async () => [wake], acknowledge: async () => { acknowledgments++; return true; } };
  assert.equal((await reconcilePaymentWakes(f.execution, associations, wakes))[0].status, 'retained');
  assert.equal(acknowledgments, 0);
  const pending = (await f.execution.store.read('cart')).record.attempts[0];
  assert.equal(pending.phase, 'paid');
  fail = false;
  const completed = (await reconcilePaymentWakes(f.execution, associations, wakes))[0];
  assert.equal(completed.status, 'acknowledged');
  assert.deepEqual(completed.attempt.order, pending.order);
  assert.equal(completed.attempt.coupon.status, 'consumed');
  assert.equal((await f.owner.getCounts(f.coupon.couponId)).consumed, 1);
  assert.equal(f.sessions.size, 1);
});

test('expired authoritative session recovers a lost attachment and releases exactly once', async t => {
  const f = await pricingFixture(t);
  const cas = f.coupons.compareAndSet.bind(f.coupons);
  let fail = true;
  f.coupons.compareAndSet = async (id, revision, value) => {
    if (fail && value.attempts.some(a => a.providerSessionId)) throw new Error('session attach unavailable');
    return cas(id, revision, value);
  };
  const a = await startCheckout(f.execution, 'cart', f.input);
  assert.equal(a.session, undefined);
  fail = false;
  f.setPayment('expired-unpaid');
  const released = await reconcileCheckout(f.execution, 'cart', a.attemptId);
  assert.equal(released.phase, 'released');
  const coupon = await f.owner.get(f.coupon.couponId, a.attemptId);
  assert.equal(coupon.providerSessionId, f.sessions.get(a.attemptId).session.sessionId);
  assert.equal(coupon.state, 'released');
});

test('eight concurrent cart starts reserve one original coupon attempt; other carts cannot oversubscribe', async t => {
  const f = await pricingFixture(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => startCheckout(f.execution, 'cart', f.input)));
  assert.equal(new Set(results.map(a => a.attemptId)).size, 1);
  assert.equal(f.sessions.size, 1);
  assert.equal((await f.coupons.get(f.coupon.couponId)).attempts.length, 1);
  await Promise.all(Array.from({ length: 8 }, (_, i) => startCheckout(f.execution, 'other-' + i, f.input)));
  assert.equal((await f.owner.getCounts(f.coupon.couponId)).pending, 1);
  assert.equal(f.sessions.size, 1);
});

test('core input rejects a non-string coupon and cannot silently drop it', async t => {
  const f = await pricingFixture(t);
  await assert.rejects(startCheckout(f.execution, 'cart', { ...f.input, couponCode: 100 }), /Invalid cart/);
  assert.equal(f.sessions.size, 0);
});

test('expiry racing a delayed reserve writes a terminal coupon fence before a late slot can commit', async t => {
  const f = await pricingFixture(t);
  const cas = f.coupons.compareAndSet.bind(f.coupons);
  let unblock, entered;
  const blocked = new Promise(resolve => { entered = resolve; });
  const barrier = new Promise(resolve => { unblock = resolve; });
  let paused = false;
  f.coupons.compareAndSet = async (id, revision, value) => {
    if (!paused && value.attempts.some(a => a.state === 'pending')) {
      paused = true;
      entered();
      await barrier;
    }
    return cas(id, revision, value);
  };
  const first = startCheckout(f.execution, 'cart', f.input);
  await blocked;
  f.setNow(1800000000);
  const rejected = await startCheckout(f.execution, 'cart', f.input);
  assert.equal(rejected.phase, 'released');
  unblock();
  const late = await first;
  assert.equal(late.phase, 'released');
  assert.equal((await f.owner.getCounts(f.coupon.couponId)).pending, 0);
  assert.equal(f.sessions.size, 0);
});

test('lost coupon reserve/consume/release writes recover idempotently across the checkout aggregate', async t => {
  for (const target of ['pending', 'consumed', 'released']) {
    const f = await pricingFixture(t);
    const cas = f.coupons.compareAndSet.bind(f.coupons);
    let lost = false;
    f.coupons.compareAndSet = async (id, revision, value) => {
      const result = await cas(id, revision, value);
      if (result.applied && !lost && value.attempts.some(a => a.state === target)) {
        lost = true;
        throw new Error('reply lost after durable coupon write');
      }
      return result;
    };
    let a = await startCheckout(f.execution, 'cart', f.input);
    if (target === 'pending') {
      assert.equal(f.sessions.size, 0);
      a = await startCheckout(f.execution, 'cart', f.input);
    }
    f.setPayment(target === 'released' ? 'expired-unpaid' : 'paid');
    a = await reconcileCheckout(f.execution, 'cart', a.attemptId);
    a = await reconcileCheckout(f.execution, 'cart', a.attemptId);
    assert.equal(a.coupon.status, target === 'released' ? 'released' : 'consumed');
    const counts = await f.owner.getCounts(f.coupon.couponId);
    assert.equal(counts.pending, 0);
    assert.equal(counts[target === 'released' ? 'released' : 'consumed'], 1);
    assert.equal(f.sessions.size, 1);
  }
});

test('lost canonical order write is recovered before coupon consume without another order/session', async t => {
  const f = await pricingFixture(t);
  const a = await startCheckout(f.execution, 'cart', f.input);
  const cas = f.execution.store.compareAndSet.bind(f.execution.store);
  let lost = false;
  f.execution.store.compareAndSet = async (id, version, record) => {
    const result = await cas(id, version, record);
    if (!lost && result && record.attempts.some(a => a.order)) {
      lost = true;
      throw new Error('reply lost after durable order write');
    }
    return result;
  };
  f.setPayment('paid');
  await assert.rejects(reconcileCheckout(f.execution, 'cart', a.attemptId), /reply lost/);
  assert.equal((await f.owner.getCounts(f.coupon.couponId)).pending, 1);
  const order = (await f.execution.store.read('cart')).record.attempts[0].order;
  const recovered = await reconcileCheckout(f.execution, 'cart', a.attemptId);
  assert.deepEqual(recovered.order, order);
  assert.equal(recovered.coupon.status, 'consumed');
  assert.equal(f.sessions.size, 1);
});

test('percentage free shipping conserves whole-line cents without changing quantities', async t => {
  const f = await pricingFixture(t, { discount: { kind: 'percentage', basisPoints: 3333 }, shipping: '0' });
  const a = await startCheckout(f.execution, 'cart', f.input);
  assert.equal(a.payment.pricing.couponDiscount.minor, '83');
  assert.equal(a.payment.total.minor, '167');
  assert.deepEqual(a.payment.pricing.lines.map(l => [l.quantity, l.discount.minor, l.netAmount.minor]), [[2, '50', '100'], [1, '33', '67']]);
  assert.equal(f.sessions.get(a.attemptId).request.total.minor, '167');
  assert.equal(a.payment.lines[0].unitPrice.minor, '75');
});

test('merchandise-zero with positive shipping remains a payable frozen request', async t => {
  const f = await pricingFixture(t, { discount: { kind: 'percentage', basisPoints: 10000 }, shipping: '50' });
  const a = await startCheckout(f.execution, 'cart', f.input);
  assert.equal(a.payment.total.minor, '50');
  assert.equal(a.payment.pricing.netMerchandise.minor, '0');
  assert.equal(f.sessions.size, 1);
});

test('adapter requires exact schema support before credentials and sends the canonical snapshot unchanged', async t => {
  const f = await pricingFixture(t);
  const a = await startCheckout(f.execution, 'cart', f.input);
  let credentials = 0, calls = [];
  const config = {
    paymentsOrigin: 'https://payments.example', commerceOrigin: 'https://store.example', siteId: 'synthetic-site',
    bindingRef: a.payment.bindingRef, providerId: 'stripe', stripeAccountId: 'synthetic-account',
    credentialResolver: async () => { credentials++; return 'synthetic-test-token'; },
    fetch: async (url, init) => {
      calls.push({ url, body: init.body });
      return new Response(JSON.stringify(init.method === 'GET' ? {
        bindingRef: a.payment.bindingRef, providerId: 'stripe', stripeAccountId: 'synthetic-account', mode: 'test', ready: true,
      } : { outcome: 'unknown' }));
    },
  };
  const old = createTrustedTestPaymentPort(config);
  await assert.rejects(old.ensureSession(a.payment), /schema unsupported/);
  await assert.rejects(old.lookup(a.payment), /schema unsupported/);
  assert.equal(credentials, 0);
  assert.equal(calls.length, 0);
  const current = createTrustedTestPaymentPort({ ...config, pricingSchema: a.payment.pricing.schema });
  await current.ensureSession(a.payment);
  assert.equal(credentials, 2);
  assert.deepEqual(JSON.parse(calls[1].body), a.payment);
  assert.equal(JSON.parse(calls[1].body).total.minor, '200');
  await assert.rejects(current.ensureSession({ ...a.payment, pricing: { ...a.payment.pricing, schema: 'unknown-version' } }), /Unsupported/);
  assert.equal(credentials, 2);
});

test('frozen coupon/canonical catalog and shipping survive merchant edits and replay', async t => {
  const f = await pricingFixture(t);
  const a = await startCheckout(f.execution, 'cart', f.input);
  await f.admin.disable(f.coupon.couponId, f.coupon.revision);
  f.execution.catalog.prices.records.get('one').sale.minor = '10';
  f.execution.pricing.resolveShippingConfiguration = async () => { throw new Error('configuration changed/unavailable'); };
  const replay = await startCheckout(f.execution, 'cart', f.input);
  assert.deepEqual(replay.payment, a.payment);
  f.setPayment('paid');
  assert.deepEqual((await reconcileCheckout(f.execution, 'cart', a.attemptId)).order.pricing, a.payment.pricing);
  assert.equal((await f.owner.getCounts(f.coupon.couponId)).consumed, 1);
});

test('shipping validation and absent coupon never create attempts or calls', async t => {
  for (const configuration of [null, { configurationId: 'shipping', revision: 1, mode: 'free', amount: { currency: 'USD', minor: '1' } },
    { configurationId: 'shipping', revision: 1, mode: 'flat', amount: { currency: 'EUR', minor: '50' } },
    { configurationId: 'shipping', revision: 0, mode: 'free' }]) {
    const f = await pricingFixture(t);
    f.execution.pricing.resolveShippingConfiguration = async () => configuration;
    await assert.rejects(startCheckout(f.execution, 'cart', f.input));
    assert.equal(await f.execution.store.read('cart'), null);
    assert.equal(f.sessions.size, 0);
  }
  const f = await pricingFixture(t);
  await assert.rejects(startCheckout(f.execution, 'cart', { ...f.input, couponCode: 'MISSING' }), /Coupon unavailable/);
  assert.equal(f.sessions.size, 0);
});

test('owner coupon binding never falls back to a host-supplied foreign collection', async t => {
  const f = await pricingFixture(t);
  const runtime = bindGuestCheckoutRuntime({ coupons: f.coupons }, NATIVE_GUEST_CHECKOUT_STORAGE, {
    host: { pricing: { ...f.execution.pricing, coupons: { foreign: true } } },
  });
  assert.equal(runtime.pricing.coupons, f.coupons);
  const missing = bindGuestCheckoutRuntime({}, NATIVE_GUEST_CHECKOUT_STORAGE, {
    host: { pricing: { ...f.execution.pricing, coupons: f.coupons } },
  });
  assert.equal(missing.pricing.coupons, undefined);
});
