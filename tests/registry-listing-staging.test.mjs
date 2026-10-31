import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { stageRegistryListing } from '../scripts/stage-registry-listing.mjs';

test('release staging preserves declared profile text and image bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'commerce-listing-'));
  try {
    const source = join(root, 'source');
    const destination = join(root, 'release');
    await mkdir(join(source, 'docs'), { recursive: true });
    await mkdir(join(source, 'art'), { recursive: true });
    await writeFile(join(source, 'docs/about.md'), 'About the plugin');
    const image = Buffer.from([0, 1, 2, 255]);
    await writeFile(join(source, 'art/icon.webp'), image);
    await writeFile(join(source, 'emdash-plugin.jsonc'), JSON.stringify({
      sections: { description: { file: './docs/about.md' }, faq: 'Inline FAQ' },
      release: { artifacts: { icon: { file: './art/icon.webp' }, screenshots: [{ file: './art/icon.webp' }] } },
    }));
    await stageRegistryListing(source, destination);
    assert.equal(await readFile(join(destination, 'docs/about.md'), 'utf8'), 'About the plugin');
    assert.deepEqual(await readFile(join(destination, 'art/icon.webp')), image);
    await writeFile(join(source, 'emdash-plugin.jsonc'), '{}');
    await stageRegistryListing(source, destination);
    await writeFile(join(source, 'emdash-plugin.jsonc'), JSON.stringify({ sections: { description: { file: '../outside.md' } } }));
    await assert.rejects(stageRegistryListing(source, destination), /inside the plugin directory/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
