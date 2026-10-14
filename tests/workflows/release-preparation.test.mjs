import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = join(root, 'scripts/prepare-emdash-release.mjs');
const manifest = JSON.parse(await readFile(join(root, 'emdash-plugin.jsonc'), 'utf8'));
const selector = `${manifest.slug}@${manifest.version}`;

async function fixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'commerce-release-test-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, '.tmp/sandbox-source/src'), { recursive: true });
  await mkdir(join(directory, 'src'));
  // Raw source must never be selected by the release preparation path.
  await writeFile(join(directory, 'src/plugin.ts'), 'throw new Error("raw source selected");\n');
  for (const name of ['package.json', 'emdash-plugin.jsonc']) {
    await copyFile(join(root, name), join(directory, name));
    await copyFile(join(root, '.tmp/sandbox-source', name), join(directory, '.tmp/sandbox-source', name));
  }
  await copyFile(join(root, '.tmp/sandbox-source/src/plugin.ts'), join(directory, '.tmp/sandbox-source/src/plugin.ts'));
  const output = join(directory, 'github-output');
  return { directory, output, run(value = selector) {
    return execFileSync(process.execPath, [script, value], {
      cwd: directory, env: { ...process.env, GITHUB_OUTPUT: output }, encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } };
}

test('release preparation uses official CLI on the prebundle and preserves attestation outputs', async t => {
  const f = await fixture(t);
  f.run();
  const fields = Object.fromEntries((await readFile(f.output, 'utf8')).trim().split('\n').map(line => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)];
  }));
  assert.equal(fields['package-slug'], manifest.slug);
  assert.equal(fields.version, manifest.version);
  assert.equal(fields['publisher-did'], manifest.publisher);
  assert.equal(fields['plugin-directory'], '.');
  assert.equal(fields['bundle-file'], join(f.directory, '.emdash-release', `${selector.replace('@', '-')}.tar.gz`));
  const backend = execFileSync('tar', ['-xOf', fields['bundle-file'], 'backend.js']);
  assert.deepEqual(backend, await readFile(join(root, 'dist/sandbox/plugin.mjs')));
  const bundledManifest = JSON.parse(execFileSync('tar', ['-xOf', fields['bundle-file'], 'manifest.json'], { encoding: 'utf8' }));
  assert.deepEqual(bundledManifest, JSON.parse(await readFile(join(root, 'dist/sandbox/manifest.json'), 'utf8')));
});

test('release preparation refuses a selector that does not match the package', async t => {
  const f = await fixture(t);
  assert.throws(() => f.run(`${manifest.slug}@9.9.9`), /Release selector must match/);
  await assert.rejects(readFile(f.output), { code: 'ENOENT' });
});

test('release preparation refuses stale prebundle metadata before emitting outputs', async t => {
  const f = await fixture(t);
  await writeFile(join(f.directory, '.tmp/sandbox-source/emdash-plugin.jsonc'), '{}');
  assert.throws(() => f.run(), /Prebundle metadata is stale/);
  await assert.rejects(readFile(f.output), { code: 'ENOENT' });
});
