import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrustedTestPaymentPort } from '../../../dist/index.js';

// Synthetic service responses only; neither provider nor mode contacts a live service.
const providers = [
  { providerId: 'stripe', stripeAccountId: 'acct_synthetic' },
  { providerId: 'authorize_net', authorizeNetMerchantId: 'merchant_synthetic' },
];
const request = {
  attemptId: 'attempt-readiness',
  bindingRef: 'binding-synthetic',
  lines: [{ catalogItemId: 'hat', quantity: 1, name: 'Hat', unitPrice: { currency: 'USD', minor: '250' } }],
  total: { currency: 'USD', minor: '250' },
  paymentWindow: { minSeconds: 1800, maxSeconds: 1860 },
  paymentMethods: ['card'],
};

function fixture(provider, mode, readiness) {
  const calls = [];
  const binding = { bindingRef: request.bindingRef, ...provider, mode, ...readiness };
  const port = createTrustedTestPaymentPort({
    paymentsOrigin: 'https://payments.example.test',
    commerceOrigin: 'https://shop.example.test',
    siteId: 'site-synthetic',
    bindingRef: request.bindingRef,
    ...provider,
    mode,
    credentialResolver: async () => 'synthetic-credential',
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({ path, method: init.method, body: init.body });
      if (path === '/v1/checkout-binding' || path === '/v1/existing-binding') {
        return Response.json(binding);
      }
      // A normal wire outcome ensures a bad binding is the only reason to reject.
      return Response.json({ outcome: 'not-created' });
    },
  });
  return { port, calls };
}

for (const provider of providers) {
  for (const mode of ['test', 'live']) {
    test(`${provider.providerId} ${mode}: creation and readiness agree on explicit readiness flags`, async t => {
      for (const ready of [false, null, 'false', 'true', 0, 1, [], {}]) {
        await t.test(`rejects ready=${JSON.stringify(ready)} before POST`, async () => {
          const { port, calls } = fixture(provider, mode, { ready });
          await assert.rejects(() => port.verifyBinding(), /Payments binding unavailable/);
          await assert.rejects(() => port.ensureSession(request), /Payments binding unavailable/);
          assert.deepEqual(calls.map(({ path, method }) => [path, method]), [
            ['/v1/checkout-binding', 'GET'], ['/v1/checkout-binding', 'GET'],
          ]);
        });
      }
      for (const readiness of [{}, { ready: true }]) {
        await t.test(`admits ${Object.hasOwn(readiness, 'ready') ? 'ready=true' : 'omitted ready'}`, async () => {
          const { port, calls } = fixture(provider, mode, readiness);
          assert.equal((await port.verifyBinding()).ready, true);
          assert.deepEqual(await port.ensureSession(request), { outcome: 'not-created' });
          assert.deepEqual(calls.map(({ path, method }) => [path, method]), [
            ['/v1/checkout-binding', 'GET'], ['/v1/checkout-binding', 'GET'],
            ['/v1/checkout/session', 'POST'],
          ]);
          assert.deepEqual(JSON.parse(calls[2].body), request);
        });
      }
      await t.test('historical lookup still works when current creation is not ready', async () => {
        const { port, calls } = fixture(provider, mode, { ready: false });
        await assert.rejects(() => port.ensureSession(request), /Payments binding unavailable/);
        assert.deepEqual(await port.lookup(request), { outcome: 'not-created' });
        assert.deepEqual(calls.map(({ path, method }) => [path, method]), [
          ['/v1/checkout-binding', 'GET'], ['/v1/existing-binding', 'GET'],
          ['/v1/checkout/lookup', 'POST'],
        ]);
        assert.deepEqual(JSON.parse(calls[2].body), request);
      });
    });
  }
}
