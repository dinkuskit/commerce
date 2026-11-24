import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { REGISTRY_BUILD } from '../dist/shared/registry-build.js';

// Code only an Inventory provider makes reachable: a managed item's stock read,
// Pack's ticket command and the stock reservation hand-off.
const INVENTORY_ONLY = ['readSkuStock', 'stock.pack_all', 'reserveTicketIds', 'allowBackorders'];
// Commerce's own coupon code is gone from both builds: coupons are a plugin in the store (commerce-addons-door-20261124).
const COUPON_GONE = ['Coupon owner unavailable', 'Coupon allocation is not conserved', 'payment pricing coupon', 'CouponRecordValidationError',
  'COUPON_UNAVAILABLE', 'couponCode', 'Invalid cart coupon'];

test('the library build keeps every Manage stock path and no coupon code', async () => {
  assert.equal(REGISTRY_BUILD, false);
  const library = await Promise.all([
    'dist/features/storefront-availability/resolve.js', 'dist/features/orders/pack.js', 'dist/features/checkout/orchestrate.js',
    'dist/features/checkout/pricing.js', 'dist/features/checkout/test-payments.js', 'dist/features/checkout/guest.js',
  ].map(file => readFile(new URL('../' + file, import.meta.url), 'utf8')));
  for (const marker of INVENTORY_ONLY) assert.ok(library.some(code => code.includes(marker)), marker);
  for (const marker of COUPON_GONE) assert.ok(!library.some(code => code.includes(marker)), marker);
});

test('the Registry build drops the Manage stock, stock reservation and Pack paths it cannot reach, and has no coupon code', async () => {
  const backend = await readFile(new URL('../dist/sandbox/plugin.mjs', import.meta.url), 'utf8');
  for (const marker of [...INVENTORY_ONLY, ...COUPON_GONE]) assert.ok(!backend.includes(marker), marker);
  // What stays: the v1 refusal clerks see, the unmanaged stock status choices, and the add-ons door.
  assert.ok(backend.includes('Manage stock is coming soon and cannot be turned on.'));
  assert.ok(backend.includes('on-backorder'));
  assert.ok(backend.includes('checkout/addons/start'));
  assert.ok(backend.includes('Invalid add-on answer'));
});
