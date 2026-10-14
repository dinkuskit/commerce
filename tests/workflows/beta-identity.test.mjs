import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {COMMERCE_BETA_REGISTRY_RUNTIME_ID, COMMERCE_REGISTRY_RUNTIME_ID} from '../../dist/shared/plugin-identity.js';

function registryId(publisher, slug) {
  const bytes = createHash('sha256').update(`${publisher}\n${slug}`).digest();
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let value = 0, bits = 0, encoded = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { bits -= 5; encoded += alphabet[(value >>> bits) & 31]; }
  }
  return `r_${encoded.slice(0,16)}`;
}

test('runtime allowlist matches EmDash IDs for this publisher and the two package slugs', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../emdash-plugin.jsonc', import.meta.url), 'utf8'));
  assert.equal(COMMERCE_REGISTRY_RUNTIME_ID, registryId(manifest.publisher, manifest.slug));
  assert.equal(COMMERCE_BETA_REGISTRY_RUNTIME_ID, registryId(manifest.publisher, `${manifest.slug}-beta`));
  assert.notEqual(COMMERCE_REGISTRY_RUNTIME_ID, COMMERCE_BETA_REGISTRY_RUNTIME_ID);
});
