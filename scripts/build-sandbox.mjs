import { rolldown } from 'rolldown';
import { shareGlobals, shareLiterals } from './share-literals.mjs';
import { buildPlugin } from '@emdash-cms/plugin-cli';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stageRegistryListing } from './stage-registry-listing.mjs';

// Neutral resolution omits legacy package main fields. Prebundle supported
// browser-compatible dependencies, then retain the official manifest/probe build.
const stage = resolve('.tmp/sandbox-source');
await mkdir(resolve(stage, 'src'), { recursive: true });
// The Registry build cannot reach Manage stock, stock reservation or Pack (see
// src/shared/registry-build.ts), so the flag is true here and Rolldown drops
// those paths. Everything else is built exactly as the library build (dist/) is.
const registryBuild = {
  name: 'commerce-registry-build',
  load(id) {
    return id === resolve('src/shared/registry-build.ts') ? 'export const REGISTRY_BUILD = true;' : null;
  },
};
const bundle = await rolldown({
  input: resolve('src/plugin.ts'), platform: 'browser',
  // Measured on 0.7.0: inlining constants and tree-shaking without property-read or unknown-global side
  // effects take 168 bytes off the final backend after literal sharing and the plugin CLI's own minify.
  optimization: { inlineConst: true },
  treeshake: { moduleSideEffects: true, propertyReadSideEffects: false, unknownGlobalSideEffects: false },
  plugins: [registryBuild],
  onwarn(warning) {
    if (warning.code === 'UNRESOLVED_IMPORT') throw new Error(warning.message);
    console.warn(warning.message);
  },
});
try { await bundle.write({ file: resolve(stage, 'bundled/plugin.js'), format: 'esm', minify: true }); }
finally { await bundle.close(); }
const runtime = shareGlobals(shareLiterals(await readFile(resolve(stage, 'bundled/plugin.js'), 'utf8')));
await writeFile(resolve(stage, 'src/plugin.ts'), '// @ts-nocheck -- generated dependency bundle; source is checked separately\n' + runtime);
for (const file of ['emdash-plugin.jsonc', 'package.json']) {
  await copyFile(resolve(file), resolve(stage, file));
}
await stageRegistryListing(resolve('.'), stage);
await buildPlugin({ dir: stage, outDir: resolve('dist/sandbox') });
