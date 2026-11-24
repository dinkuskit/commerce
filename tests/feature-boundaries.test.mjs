import test from 'node:test';
import assert from 'node:assert/strict';
import { auditFeatures, frontDoorFindings, storageFindings } from '../scripts/check-features.mjs';

const features = ['catalog', 'feeds', 'checkout', 'orders'];

test('a feature reaching into another feature\'s private files is refused', () => {
  // The shape Catalog had before Feeds got its own kernel entry.
  assert.deepEqual(frontDoorFindings('src/features/catalog/product-admin.ts',
    'import { loadProductFeedEligibility } from "../feeds/eligibility.js";', 'catalog', features),
  ['src/features/catalog/product-admin.ts bypasses the feeds public entry: ../feeds/eligibility.js']);
  assert.equal(frontDoorFindings('src/admin/index.ts', 'import { x } from "../features/orders/admin/page.js";', undefined, features).length, 1);
  assert.equal(frontDoorFindings('src/features/catalog/a.ts', 'import type { X } from "../feeds/kernel/index.js";', 'catalog', features).length, 0);
  assert.equal(frontDoorFindings('src/features/orders/a.ts', 'import { y } from "./store.js";', 'orders', features).length, 0);
  assert.equal(frontDoorFindings('src/features/orders/a.ts', 'import { y } from "../../handoffs/paid-order.js";', 'orders', features).length, 0);
});

test('a feature naming another feature\'s storage is refused', () => {
  // The shape the Orders page had before it kept its own copies.
  assert.deepEqual(storageFindings('src/features/orders/admin/page.ts', 'ctx.storage.checkout_carts ?? ctx.storage["checkout_carts"]', 'orders'),
    ['src/features/orders/admin/page.ts names checkout storage checkout_carts; go through a handoff instead']);
  assert.equal(storageFindings('src/features/checkout/storage.ts', 'const n = "checkout_carts";', 'checkout').length, 0);
  assert.equal(storageFindings('src/plugin.ts', 'ctx.storage["orders"]', undefined).length, 0);
  assert.equal(storageFindings('src/features/checkout/other.ts', 'const n = "catalog_items";', 'checkout').length, 1);
});

test('the repository itself passes the feature contract', async () => {
  assert.deepEqual(await auditFeatures(), []);
});
