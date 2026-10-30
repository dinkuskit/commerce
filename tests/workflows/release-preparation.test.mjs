import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { BETA_SLUG_SUFFIX, effectiveSelector } from '../../scripts/beta-release.mjs';
import { stageRegistryListing } from '../../scripts/stage-registry-listing.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = join(root, 'scripts/prepare-emdash-release.mjs');
const manifest = JSON.parse(await readFile(join(root, 'emdash-plugin.jsonc'), 'utf8'));
// main is stable or in Changesets pre mode, and the Changesets release PR
// carries a prerelease version. Exercise both release shapes from the same
// prebundle so neither one depends on which branch the suite runs on.
const stableVersion = manifest.version.split('-')[0];
const releases = [
  { kind: 'stable', version: stableVersion, slug: manifest.slug },
  { kind: 'beta', version: `${stableVersion}-beta.0`, slug: `${manifest.slug}${BETA_SLUG_SUFFIX}` },
];

async function fixture(t, version = manifest.version) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'commerce-release-test-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, '.tmp/sandbox-source/src'), { recursive: true });
  await mkdir(join(directory, 'src'));
  // Raw source must never be selected by the release preparation path.
  await writeFile(join(directory, 'src/plugin.ts'), 'throw new Error("raw source selected");\n');
  for (const name of ['package.json', 'emdash-plugin.jsonc']) {
    if (version === manifest.version) {
      await copyFile(join(root, name), join(directory, name));
      await copyFile(join(root, '.tmp/sandbox-source', name), join(directory, '.tmp/sandbox-source', name));
    } else {
      const value = JSON.parse(await readFile(join(root, '.tmp/sandbox-source', name), 'utf8'));
      value.version = version;
      const source = `${JSON.stringify(value, null, 2)}\n`;
      await writeFile(join(directory, name), source);
      await writeFile(join(directory, '.tmp/sandbox-source', name), source);
    }
  }
  await copyFile(join(root, '.tmp/sandbox-source/src/plugin.ts'), join(directory, '.tmp/sandbox-source/src/plugin.ts'));
  await stageRegistryListing(join(root, '.tmp/sandbox-source'), join(directory, '.tmp/sandbox-source'));
  const output = join(directory, 'github-output');
  // The slug the release flow hands the helper: the beta listing for a prerelease.
  const selector = effectiveSelector(`${manifest.slug}@${version}`);
  return { directory, output, selector, run(value = selector) {
    return execFileSync(process.execPath, [script, value], {
      cwd: directory, env: { ...process.env, GITHUB_OUTPUT: output }, encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } };
}

for (const release of releases) {
  test(`release preparation uses official CLI on the prebundle and preserves attestation outputs (${release.kind})`, async t => {
    const f = await fixture(t, release.version);
    assert.equal(f.selector, `${release.slug}@${release.version}`);
    f.run();
    const fields = Object.fromEntries((await readFile(f.output, 'utf8')).trim().split('\n').map(line => {
      const at = line.indexOf('=');
      return [line.slice(0, at), line.slice(at + 1)];
    }));
    assert.equal(fields['package-slug'], release.slug);
    assert.equal(fields.version, release.version);
    assert.equal(fields['publisher-did'], manifest.publisher);
    assert.equal(fields['plugin-directory'], '.');
    assert.equal(fields['bundle-file'], join(f.directory, '.emdash-release', `${release.slug}-${release.version}.tar.gz`));
    const backend = execFileSync('tar', ['-xOf', fields['bundle-file'], 'backend.js']);
    assert.deepEqual(backend, await readFile(join(root, 'dist/sandbox/plugin.mjs')));
    const bundledManifest = JSON.parse(execFileSync('tar', ['-xOf', fields['bundle-file'], 'manifest.json'], { encoding: 'utf8' }));
    const shipped = JSON.parse(await readFile(join(root, 'dist/sandbox/manifest.json'), 'utf8'));
    // Only identity fields may differ from the audited prebundle manifest.
    assert.deepEqual(bundledManifest, { ...shipped, id: release.slug, version: release.version });
  });

  test(`release preparation refuses stale prebundle metadata before emitting outputs (${release.kind})`, async t => {
    const f = await fixture(t, release.version);
    await writeFile(join(f.directory, '.tmp/sandbox-source/emdash-plugin.jsonc'), '{}');
    assert.throws(() => f.run(), /Prebundle metadata is stale/);
    await assert.rejects(readFile(f.output), { code: 'ENOENT' });
  });
}

test('release preparation refuses a selector that does not match the package', async t => {
  const f = await fixture(t);
  assert.throws(() => f.run(`${manifest.slug}@9.9.9`), /Release selector must match/);
  await assert.rejects(readFile(f.output), { code: 'ENOENT' });
});

test('release preparation refuses a prerelease under the stable slug and a stable version under the beta slug', async t => {
  const [stable, beta] = releases;
  const prerelease = await fixture(t, beta.version);
  assert.throws(() => prerelease.run(`${stable.slug}@${beta.version}`), /Release selector must match/);
  await assert.rejects(readFile(prerelease.output), { code: 'ENOENT' });
  const release = await fixture(t, stable.version);
  assert.throws(() => release.run(`${beta.slug}@${stable.version}`), /Release selector must match/);
  await assert.rejects(readFile(release.output), { code: 'ENOENT' });
});
