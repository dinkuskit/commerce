import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createCouponBuildTransform } from '../scripts/coupon-build-transform.mjs';
import { rolldown } from 'rolldown';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const authPackage = await readFile(`${root}/node_modules/@emdash-cms/auth/package.json`, 'utf8');
const transform = createCouponBuildTransform({ authPackageJson: authPackage, authRoot: `${root}/node_modules/@emdash-cms/auth` });
const indexId = `${root}/node_modules/@emdash-cms/auth/dist/index.mjs`;
const indexCode = await readFile(indexId, 'utf8');

test('audited auth transform fails closed on changed source and unexpected closure modules', async () => {
  await assert.rejects(() => transform.transform(indexCode.replace('const HTTP_SCHEME_RE', 'const CHANGED_SCHEME_RE'), indexId), /Unexpected @emdash-cms\/auth source/);
  await assert.rejects(() => transform.transform('export const changed = true;', `${root}/node_modules/@emdash-cms/auth/dist/new.mjs`), /Unexpected @emdash-cms\/auth source/);
});

test('emitted public permission helpers preserve every permission and valid/invalid role outcome', async () => {
  const directory = resolve(root, '.tmp/coupon-auth-equivalence');
  await mkdir(directory, { recursive: true });
  const entry = resolve(directory, 'entry.mjs');
  await writeFile(entry, "export { hasPermission, toRoleLevel, Permissions } from '@emdash-cms/auth';\n");
  const build = async (name, plugins) => {
    const bundle = await rolldown({ input: entry, platform: 'browser', plugins });
    const target = resolve(directory, name + '.mjs');
    try { await bundle.write({ file: target, format: 'esm', minify: true }); }
    finally { await bundle.close(); }
    return import(pathToFileURL(target).href);
  };
  const original = await build('original', []);
  const optimized = await build('optimized', [transform]);
  assert.deepEqual(optimized.Permissions, original.Permissions);
  const outcome = fn => { try { return { value: fn() }; } catch (error) { return { error: error.name, message: error.message }; } };
  const roles = [10, 20, 30, 40, 50, 0, 49, 51, -1, NaN, Infinity, undefined, null, 'admin', 'editor', 'invalid', '50', {}, []];
  for (const role of roles) {
    assert.deepEqual(outcome(() => optimized.toRoleLevel(role)), outcome(() => original.toRoleLevel(role)));
    for (const permission of [...Object.keys(original.Permissions), 'invalid:permission']) {
      assert.deepEqual(outcome(() => optimized.hasPermission({ role: optimized.toRoleLevel(role) }, permission)),
        outcome(() => original.hasPermission({ role: original.toRoleLevel(role) }, permission)), `${String(role)} ${permission}`);
    }
  }
});
