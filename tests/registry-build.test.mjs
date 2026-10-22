import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { REGISTRY_BUILD } from '../dist/shared/registry-build.js';

// Code only an Inventory provider makes reachable: a managed item's stock read,
// Pack's ticket command and the stock reservation hand-off.
const INVENTORY_ONLY = ['readSkuStock', 'stock.pack_all', 'reserveTicketIds', 'allowBackorders'];

test('the native entry keeps every Manage stock path and answers managed items itself', async () => {
  assert.equal(REGISTRY_BUILD, false);
  const native = await Promise.all([
    'dist/features/storefront-availability/resolve.js', 'dist/features/orders/pack.js', 'dist/features/checkout/orchestrate.js',
  ].map(file => readFile(new URL('../' + file, import.meta.url), 'utf8')));
  for (const marker of INVENTORY_ONLY) assert.ok(native.some(code => code.includes(marker)), marker);
});

test('the Registry build drops the Manage stock, stock reservation and Pack paths it cannot reach', async () => {
  const backend = await readFile(new URL('../dist/sandbox/plugin.mjs', import.meta.url), 'utf8');
  for (const marker of INVENTORY_ONLY) assert.ok(!backend.includes(marker), marker);
  // What stays: the v1 refusal clerks see, and the unmanaged stock status choices.
  assert.ok(backend.includes('Manage stock is coming soon and cannot be turned on.'));
  assert.ok(backend.includes('on-backorder'));
});
