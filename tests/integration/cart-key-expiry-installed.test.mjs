// commerce-cart-key-expiry-20261125 through the installed plugin: the compiled Registry backend in workerd, EmDash's
// real storage bridge, its routes as the store's pages call them, and its 5-minute background check.
import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeFixture } from '../features/checkout/registry-runtime.mjs';
import { COMMERCE_CHECKOUT_WAKES_TASK } from '../../dist/features/checkout/index.js';

const basket = { contact: { email: 'shopper@example.test', billing: { name: 'Bill Payer', line1: '9 Billing Way', city: 'Billtown', postalCode: '00009', country: 'US' } }, lines: [{ catalogItemId: 'hat', quantity: 1 }] };

test('installed routes: a live key reads its checkout; once the cart is past its date the cleared cart never renews the key, before any Payments call', async t => {
  const state = await runtimeFixture();
  t.after(() => state.close());
  const keys = state.collections.checkout_guest_capabilities, carts = state.collections.checkout_carts;
  const prepared = await state.invoke('checkout/guest/prepare');
  assert.equal(prepared.ok, true);
  const token = prepared.capability.capability, keyId = prepared.capability.capabilityId;
  const started = await state.invoke('checkout/guest/start', basket, token);
  assert.equal(started.ok, true, JSON.stringify(started));
  const allowed = await state.invoke('checkout/guest/cart', {}, token);
  assert.equal(allowed.ok, true, JSON.stringify(allowed));
  t.diagnostic(`allowed: cart read ok=${allowed.ok} checkout=${allowed.checkout?.state}`);

  // Thirty days on: the cart and the key it carried are both past their date, with the payment still unfinished.
  const past = String(Math.floor(Date.now() / 1000) - 60);
  const [{ id: cartId, data: cart }] = (await carts.query()).items;
  await carts.put(cartId, { ...cart, cartExpires: past });
  const key = { ...(await keys.get(keyId)), expiresAt: past };
  await keys.put(keyId, key);
  await state.plugin.invokeHook('cron', { name: COMMERCE_CHECKOUT_WAKES_TASK });
  const kept = await carts.get(cartId);
  assert.equal(kept.cart, undefined, 'the expired lines are gone');
  assert.ok(+kept.cartExpires > Date.now() / 1000, 'the unfinished payment is looked at again a day on');
  assert.equal(await keys.get(keyId), null, 'the key is deleted, not moved to the payment retry date');
  t.diagnostic(`background check: cart lines cleared, attempt kept with retry ${kept.cartExpires}; key deleted`);

  // A key the check has not reached yet is refused all the same, and Payments is never asked.
  await keys.put(keyId, key);
  const transport = state.counts.transport;
  const read = await state.invoke('checkout/guest/cart', {}, token);
  const again = await state.invoke('checkout/guest/start', { contact: basket.contact }, token);
  assert.equal(read.error?.code, 'CAPABILITY_DENIED', JSON.stringify(read));
  assert.equal(again.error?.code, 'CAPABILITY_DENIED', JSON.stringify(again));
  assert.equal(state.counts.transport, transport);
  t.diagnostic(`expired key: cart=${read.error.code} start=${again.error.code} payments calls=${state.counts.transport - transport}`);
});
