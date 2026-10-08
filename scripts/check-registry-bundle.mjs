import { bundlePlugin } from '@emdash-cms/plugin-cli';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

// Runs the official Registry packaging validation on the staged sandbox
// source, so a backend over the per-file limit fails the build instead of a
// later installed proof. bundlePlugin enforces the limit; this copy of it
// only reports headroom.
const REGISTRY_FILE_LIMIT_BYTES = 128 * 1024;
const directory = resolve('.tmp/registry-bundle');
await rm(directory, { recursive: true, force: true });
const extracted = resolve(directory, 'extracted');
await mkdir(extracted, { recursive: true });
const artifact = await bundlePlugin({ dir: resolve('.tmp/sandbox-source'), outDir: resolve(directory, 'build') });
execFileSync('tar', ['-xf', artifact.tarballPath, '-C', extracted]);
const backend = await readFile(resolve(extracted, 'backend.js'));
const manifest = JSON.parse(await readFile(resolve(extracted, 'manifest.json'), 'utf8'));
console.log([
  'registry_bundle=pass',
  `backend_bytes=${backend.byteLength}`,
  `headroom_bytes=${REGISTRY_FILE_LIMIT_BYTES - backend.byteLength}`,
  `backend_sha256=${createHash('sha256').update(backend).digest('hex')}`,
  `storage=${Object.keys(manifest.storage).sort().join(',')}`,
].join(' '));
