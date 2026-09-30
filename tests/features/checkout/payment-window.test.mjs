import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CURRENT_PAYMENT_WINDOW,
  CURRENT_PAYMENT_WINDOW_MAX_SECONDS,
  CURRENT_PAYMENT_WINDOW_MIN_SECONDS,
  LEGACY_EXACT_PAYMENT_WINDOW_SECONDS,
  createCurrentPaymentRequest,
  isCurrentPaymentRequest,
  isLegacyExact1800PaymentRequest,
  paymentRequestHandoff,
  providerSessionWindowIsValid,
  reconcileCheckout,
  startCheckout,
} from '../../../dist/features/checkout/index.js';
import * as checkout from '@dinkuskit/commerce/features/checkout';
import { cart, fixture, openStore } from './fixture.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const contract = readFileSync(join(root, 'docs/implementation/checkout-payment-window.md'), 'utf8');

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'payment-window-'));
  const path = join(dir, 'store.sqlite');
  const opened = openStore(path);
  t.after(() => { opened.db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { ...fixture(opened.store), path, opened };
}

function session(createdAt, expiresAt, overrides = {}) {
  return { sessionId: 'session-test', redirectUrl: 'https://checkout.stripe.com/test', createdAt, expiresAt, ...overrides };
}

function currentRequest() {
  return createCurrentPaymentRequest({
    attemptId: 'attempt-current',
    bindingRef: 'stripe-test-binding',
    lines: [],
    total: { currency: 'USD', minor: '250' },
  });
}

function legacyRequest() {
  return {
    attemptId: 'attempt-legacy',
    bindingRef: 'stripe-test-binding',
    lines: [],
    total: { currency: 'USD', minor: '250' },
    paymentWindowSeconds: 1800,
    paymentMethods: ['card'],
  };
}

async function persistLegacyPaying(f) {
  const stored = await f.execution.store.read('guest-cart');
  const current = stored.record.attempts[0];
  const { paymentWindow: _window, ...rest } = current.payment;
  const payment = { ...rest, paymentWindowSeconds: 1800 };
  assert.equal('paymentWindow' in payment, false);
  const applied = await f.execution.store.compareAndSet('guest-cart', stored.version, { attempts: [{ ...current, payment }] });
  assert.equal(applied, true);
  return payment;
}

test('public checkout entry exports the discriminated payment-window contract', () => {
  assert.deepEqual(checkout.CURRENT_PAYMENT_WINDOW, { minSeconds: 1800, maxSeconds: 1860 });
  assert.equal(checkout.CURRENT_PAYMENT_WINDOW_MIN_SECONDS, 1800);
  assert.equal(checkout.CURRENT_PAYMENT_WINDOW_MAX_SECONDS, 1860);
  assert.equal(checkout.LEGACY_EXACT_PAYMENT_WINDOW_SECONDS, 1800);
  assert.equal(checkout.PAYMENTS_CREATE_RETRY_BOUND_HOURS, 23);
  assert.equal(typeof checkout.createCurrentPaymentRequest, 'function');
  assert.equal(typeof checkout.paymentRequestHandoff, 'function');
  assert.equal(typeof checkout.isCurrentPaymentRequest, 'function');
  assert.equal(typeof checkout.isLegacyExact1800PaymentRequest, 'function');
  for (const required of [
    'paymentWindow:{minSeconds:1800;maxSeconds:1860}',
    'CurrentPaymentRequest',
    'LegacyExact1800PaymentRequest',
    'paymentRequestHandoff',
    'requestedExpiresAtSeconds',
    'legacy-exact-1800',
    '23-hour',
    '@dinkuskit/commerce/features/checkout',
  ]) {
    assert.ok(contract.includes(required), `timing contract must document ${required}`);
  }
  assert.equal(contract.includes('sk_live'), false);
  assert.equal(contract.includes('/Users/bobbybones/Developer/dinkus/payments'), false);
});

test('handoff discriminates current bounded shape from frozen exact-1800 originals', () => {
  const current = currentRequest();
  const legacy = legacyRequest();
  assert.equal(isCurrentPaymentRequest(current), true);
  assert.equal(isLegacyExact1800PaymentRequest(current), false);
  assert.deepEqual(paymentRequestHandoff(current), { kind: 'current-bounded-1800-1860', request: current });
  assert.equal(isLegacyExact1800PaymentRequest(legacy), true);
  assert.equal(isCurrentPaymentRequest(legacy), false);
  assert.deepEqual(paymentRequestHandoff(legacy), { kind: 'legacy-exact-1800', request: legacy });
  assert.equal(paymentRequestHandoff({ ...current, paymentWindowSeconds: 1800 }), null);
  assert.equal(paymentRequestHandoff({ ...legacy, paymentWindow: CURRENT_PAYMENT_WINDOW }), null);
});

test('current policy accepts 1800, 1859 and 1860 and rejects 1799, 1861, non-integers and unsafe timestamps', () => {
  const request = currentRequest();
  assert.equal(providerSessionWindowIsValid(session(1000, 2800), request), true);
  assert.equal(providerSessionWindowIsValid(session(1000, 2859), request), true);
  assert.equal(providerSessionWindowIsValid(session(1000, 2860), request), true);
  assert.equal(providerSessionWindowIsValid(session(1000, 2799), request), false);
  assert.equal(providerSessionWindowIsValid(session(1000, 2861), request), false);
  assert.equal(providerSessionWindowIsValid(session(1000.5, 2800.5), request), false);
  assert.equal(providerSessionWindowIsValid(session(1000, 2800.5), request), false);
  assert.equal(providerSessionWindowIsValid(session(Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1 + 1800), request), false);
  assert.equal(providerSessionWindowIsValid({ sessionId: 'session-test', redirectUrl: 'https://checkout.stripe.com/test', expiresAt: 2800 }, request), false);
  assert.equal(providerSessionWindowIsValid({ sessionId: 'session-test', redirectUrl: 'https://checkout.stripe.com/test', createdAt: 1000 }, request), false);
  assert.equal(providerSessionWindowIsValid(session(1000, 2800), legacyRequest()), true);
  assert.equal(providerSessionWindowIsValid(session(1000, 2859), legacyRequest()), false);
});

test('new checkout constructs only the bounded window and clones that exact request', async t => {
  const f = setup(t);
  const seen = [];
  const received = [];
  const ensure = f.execution.payments.ensureSession;
  f.execution.payments.ensureSession = async request => {
    received.push(structuredClone(request));
    seen.push(request);
    const outcome = await ensure(structuredClone(request));
    request.paymentWindow = { minSeconds: 1, maxSeconds: 2 };
    request.attemptId = 'mutated';
    return outcome;
  };
  const a = await startCheckout(f.execution, 'guest-cart', cart);
  assert.deepEqual(a.payment.paymentWindow, { minSeconds: CURRENT_PAYMENT_WINDOW_MIN_SECONDS, maxSeconds: CURRENT_PAYMENT_WINDOW_MAX_SECONDS });
  assert.equal('paymentWindowSeconds' in a.payment, false);
  const persisted = (await f.execution.store.read('guest-cart')).record.attempts[0].payment;
  assert.deepEqual(persisted.paymentWindow, { minSeconds: 1800, maxSeconds: 1860 });
  assert.equal(persisted.attemptId, a.attemptId);
  assert.deepEqual(received[0].paymentWindow, { minSeconds: 1800, maxSeconds: 1860 });
  assert.notEqual(seen[0], persisted);
  assert.deepEqual(seen[0].paymentWindow, { minSeconds: 1, maxSeconds: 2 });
  const retry = await startCheckout(f.execution, 'guest-cart', cart);
  assert.deepEqual(retry.payment, persisted);
  assert.deepEqual(received[1], persisted);
  assert.equal(retry.payment.attemptId, a.attemptId);
});

test('orchestration accepts provider endpoints 1800/1860 and interior 1859', async t => {
  for (const duration of [1800, 1859, 1860]) {
    const f = setup(t);
    f.setSessionDuration(duration);
    const a = await startCheckout(f.execution, 'guest-cart', cart);
    assert.equal(a.phase, 'paying');
    assert.equal(a.session.expiresAt - a.session.createdAt, duration);
    assert.equal(f.counts().releaseCalls, 0);
  }
});

test('orchestration rejects 1799/1861, non-integers and omitted or unsafe timestamps', async t => {
  const f = setup(t);
  const a = await startCheckout(f.execution, 'guest-cart', cart);
  const lookup = f.execution.payments.lookup;
  const cases = [
    session => ({ ...session, expiresAt: session.createdAt + 1799 }),
    session => ({ ...session, expiresAt: session.createdAt + 1861 }),
    session => ({ ...session, createdAt: session.createdAt + 0.5, expiresAt: session.expiresAt + 0.5 }),
    session => ({ ...session, expiresAt: session.expiresAt + 0.25 }),
    session => ({ sessionId: session.sessionId, redirectUrl: session.redirectUrl, expiresAt: session.expiresAt }),
    session => ({ sessionId: session.sessionId, redirectUrl: session.redirectUrl, createdAt: session.createdAt }),
    session => ({ ...session, createdAt: Number.MAX_SAFE_INTEGER + 1, expiresAt: Number.MAX_SAFE_INTEGER + 1 + 1800 }),
  ];
  for (const mutate of cases) {
    f.execution.payments.lookup = async request => {
      const outcome = await lookup(request);
      return { ...outcome, session: mutate(outcome.session) };
    };
    await assert.rejects(reconcileCheckout(f.execution, 'guest-cart', a.attemptId), /Invalid payment window/);
    const stored = (await f.execution.store.read('guest-cart')).record.attempts[0];
    assert.equal(stored.phase, 'paying');
    assert.equal(f.holds.get(a.attemptId).state, 'reserved');
    assert.equal(f.counts().releaseCalls, 0);
  }
});

test('later outcomes reject altered immutable session fields while the hold stays', async t => {
  const f = setup(t);
  f.setSessionDuration(1859);
  const a = await startCheckout(f.execution, 'guest-cart', cart);
  const original = a.session;
  const lookup = f.execution.payments.lookup;
  for (const mutate of [
    s => ({ ...s, sessionId: 'other-session' }),
    s => ({ ...s, redirectUrl: 'https://checkout.stripe.com/other' }),
    s => ({ ...s, createdAt: s.createdAt + 1, expiresAt: s.expiresAt + 1 }),
    s => ({ ...s, expiresAt: s.createdAt + 1860 }),
  ]) {
    f.execution.payments.lookup = async request => {
      const outcome = await lookup(request);
      return { outcome: 'paid', attemptId: request.attemptId, total: outcome.total, session: mutate(outcome.session), paymentId: 'payment-' + request.attemptId };
    };
    await assert.rejects(reconcileCheckout(f.execution, 'guest-cart', a.attemptId), /Payment session changed/);
    const stored = (await f.execution.store.read('guest-cart')).record.attempts[0];
    assert.equal(stored.phase, 'paying');
    assert.deepEqual(stored.session, original);
    assert.equal(f.holds.get(a.attemptId).state, 'reserved');
    assert.equal(f.counts().releaseCalls, 0);
  }
});

test('frozen old paymentWindowSeconds:1800 remains exact across retry and restart', async t => {
  const f = setup(t);
  const a = await startCheckout(f.execution, 'guest-cart', cart);
  const legacyPayment = await persistLegacyPaying(f);
  const retry = await startCheckout(f.execution, 'guest-cart', cart);
  assert.equal(retry.attemptId, a.attemptId);
  const afterRetry = (await f.execution.store.read('guest-cart')).record.attempts[0].payment;
  assert.deepEqual(afterRetry, legacyPayment);
  assert.equal(afterRetry.paymentWindowSeconds, LEGACY_EXACT_PAYMENT_WINDOW_SECONDS);
  assert.equal('paymentWindow' in afterRetry, false);
  const restarted = openStore(f.path);
  t.after(() => restarted.db.close());
  const afterRestart = await startCheckout({ ...f.execution, store: restarted.store }, 'guest-cart', cart);
  assert.equal(afterRestart.attemptId, a.attemptId);
  const persisted = (await restarted.store.read('guest-cart')).record.attempts[0].payment;
  assert.deepEqual(persisted, legacyPayment);
  assert.equal(paymentRequestHandoff(persisted).kind, 'legacy-exact-1800');
});

test('legacy exact-1800 rejects a 1859 window that the current policy would accept', async t => {
  const f = setup(t);
  const a = await startCheckout(f.execution, 'guest-cart', cart);
  await persistLegacyPaying(f);
  const lookup = f.execution.payments.lookup;
  f.execution.payments.lookup = async request => {
    const outcome = await lookup(request);
    return { ...outcome, session: { ...outcome.session, expiresAt: outcome.session.createdAt + 1859 } };
  };
  await assert.rejects(reconcileCheckout(f.execution, 'guest-cart', a.attemptId), /Invalid payment window/);
  const stored = (await f.execution.store.read('guest-cart')).record.attempts[0];
  assert.equal(stored.phase, 'paying');
  assert.equal(stored.payment.paymentWindowSeconds, 1800);
  assert.equal(f.counts().releaseCalls, 0);
});

test('unknown outcome and elapsed local timer cannot release or create a replacement session', async t => {
  const f = setup(t);
  const a = await startCheckout(f.execution, 'guest-cart', cart);
  const original = structuredClone(f.sessions.get(a.attemptId));
  f.setNow(a.session.expiresAt + 120);
  const elapsed = await startCheckout(f.execution, 'guest-cart', cart);
  assert.equal(elapsed.phase, 'paying');
  assert.equal(elapsed.session, undefined);
  assert.equal(f.sessions.size, 1);
  assert.deepEqual(f.sessions.get(a.attemptId).request, original.request);
  assert.deepEqual(f.sessions.get(a.attemptId).session, original.session);
  f.setPayment('unknown');
  assert.equal((await reconcileCheckout(f.execution, 'guest-cart', a.attemptId)).phase, 'paying');
  assert.equal(f.sessions.size, 1);
  assert.equal(f.counts().releaseCalls, 0);
  assert.equal(f.holds.get(a.attemptId).state, 'reserved');
  await assert.rejects(startCheckout(f.execution, 'guest-cart', [{ catalogItemId: 'one', quantity: 1 }]), /frozen/);
});
