import { rolldown } from 'rolldown';
import { buildPlugin } from '@emdash-cms/plugin-cli';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { auditedCouponTransformFrom } from './coupon-build-transform.mjs';
import { checkCouponCatalog } from './coupon-catalog.mjs';

// Neutral resolution omits legacy package main fields. Prebundle supported
// browser-compatible dependencies, then retain the official manifest/probe build.
const stage = resolve('.tmp/sandbox-source');
await mkdir(resolve(stage, 'src'), { recursive: true });
await checkCouponCatalog(resolve('.'));
const authTransform = await auditedCouponTransformFrom(resolve('.'));
// Commerce reaches only hasPermission/toRoleLevel from the audited auth
// package; its passkey/OAuth closure imports pure @oslojs crypto and encoding
// modules that never run here. Marking them side-effect-free lets Rolldown drop
// the unused code (about 5.6 KB) without touching the audited transform.
const pureVendorModules = {
  name: 'commerce-pure-vendor-modules',
  transform(code, id) {
    return id.includes('/node_modules/@oslojs/') ? { code, moduleSideEffects: false } : null;
  },
};
const bundle = await rolldown({
  input: resolve('src/plugin.ts'), platform: 'browser',
  plugins: [authTransform, pureVendorModules],
  onwarn(warning) {
    if (warning.code === 'UNRESOLVED_IMPORT') throw new Error(warning.message);
    console.warn(warning.message);
  },
});
try { await bundle.write({ file: resolve(stage, 'bundled/plugin.js'), format: 'esm', minify: true }); }
finally { await bundle.close(); }
const runtime = await readFile(resolve(stage, 'bundled/plugin.js'), 'utf8');
await writeFile(resolve(stage, 'src/plugin.ts'), '// @ts-nocheck -- generated dependency bundle; source is checked separately\n' + runtime);
for (const file of ['emdash-plugin.jsonc', 'package.json']) {
  await copyFile(resolve(file), resolve(stage, file));
}
await buildPlugin({ dir: stage, outDir: resolve('dist/sandbox') });
