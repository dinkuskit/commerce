import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { REGISTRY_BUILD } from '../dist/shared/registry-build.js';

// Code only an Inventory provider makes reachable: a managed item's stock read,
// Pack's ticket command and the stock reservation hand-off.
const INVENTORY_ONLY = ['readSkuStock', 'stock.pack_all', 'reserveTicketIds', 'allowBackorders'];
// Code only a bound coupon port makes reachable: the coupon owner calls in
// checkout, the quote conservation check, the payment coupon check and the
// coupon record validator.
const COUPON_ONLY = ['Coupon owner unavailable', 'Coupon allocation is not conserved', 'payment pricing coupon', 'CouponRecordValidationError'];

test('the native entry keeps every Manage stock and coupon path', async () => {
  assert.equal(REGISTRY_BUILD, false);
  const native = await Promise.all([
    'dist/features/storefront-availability/resolve.js', 'dist/features/orders/pack.js', 'dist/features/checkout/orchestrate.js',
    'dist/features/checkout/pricing.js', 'dist/features/checkout/test-payments.js', 'dist/features/coupons/validation.js',
  ].map(file => readFile(new URL('../' + file, import.meta.url), 'utf8')));
  for (const marker of [...INVENTORY_ONLY, ...COUPON_ONLY]) assert.ok(native.some(code => code.includes(marker)), marker);
});

test('the Registry build drops the Manage stock, stock reservation, Pack and coupon paths it cannot reach', async () => {
  const backend = await readFile(new URL('../dist/sandbox/plugin.mjs', import.meta.url), 'utf8');
  for (const marker of [...INVENTORY_ONLY, ...COUPON_ONLY]) assert.ok(!backend.includes(marker), marker);
  // What stays: the v1 refusal clerks see, the unmanaged stock status choices,
  // and the coupon refusal a shopper gets (code admitted, then try-later).
  assert.ok(backend.includes('Manage stock is coming soon and cannot be turned on.'));
  assert.ok(backend.includes('on-backorder'));
  assert.ok(backend.includes('COUPON_UNAVAILABLE'));
  assert.ok(backend.includes('try-later'));
  assert.ok(backend.includes('Invalid cart coupon'));
});
