import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createCouponBuildTransform } from '../scripts/coupon-build-transform.mjs';
import { englishCouponCatalog } from '../dist/admin/coupon-catalog.js';
import { couponText } from '../dist/admin/coupon-i18n.js';
import { extractCouponDescriptors, checkCouponCatalog } from '../scripts/coupon-catalog.mjs';
import { compileMessage } from '@lingui/message-utils/compileMessage';
import { rolldown } from 'rolldown';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const authPackage = await readFile(`${root}/node_modules/@emdash-cms/auth/package.json`, 'utf8');
const transform = createCouponBuildTransform({ authPackageJson: authPackage, authRoot: `${root}/node_modules/@emdash-cms/auth` });
const indexId = `${root}/node_modules/@emdash-cms/auth/dist/index.mjs`;
const indexCode = await readFile(indexId, 'utf8');
const source = await readFile(`${root}/src/admin/coupons-blocks.ts`, 'utf8');

test('audited auth transform fails closed on changed source and unexpected closure modules', async () => {
  await assert.rejects(() => transform.transform(indexCode.replace('const HTTP_SCHEME_RE', 'const CHANGED_SCHEME_RE'), indexId), /Unexpected @emdash-cms\/auth source/);
  await assert.rejects(() => transform.transform('export const changed = true;', `${root}/node_modules/@emdash-cms/auth/dist/new.mjs`), /Unexpected @emdash-cms\/auth source/);
});

test('English catalog covers every literal coupon descriptor and interpolates', () => {
  const descriptors = extractCouponDescriptors(source);
  assert.equal(new Set(descriptors).size, 44);
  for (const descriptor of descriptors) assert.ok(descriptor in englishCouponCatalog, descriptor);
  const t = couponText({ ui: { locale: 'ar', direction: 'rtl' } });
  assert.equal(t('Open {code}', { code: 'SAVE10' }), 'Open SAVE10');
  assert.equal(t('{code} — {state} — {consumed} consumed / {remaining} remaining', {
    code: 'SALE', state: 'Active', consumed: 1, remaining: 9,
  }), 'SALE — Active — 1 consumed / 9 remaining');
});

test('compact emitted catalog preserves every pinned compiler message', () => {
  const expected = Object.fromEntries(extractCouponDescriptors(source).map(message => [message, compileMessage(message)]));
  assert.deepEqual(englishCouponCatalog, expected);
});

test('catalog compiler and extraction fail closed and support escaped literal descriptors', async () => {
  assert.deepEqual(extractCouponDescriptors('t("It\\\'s {value}"); t(`Other`);'), ["It's {value}", 'Other']);
  assert.throws(() => extractCouponDescriptors('t(variable);'), /dynamic/);
  assert.throws(() => extractCouponDescriptors('t(`Hello ${value}`);'), /dynamic/);
  await checkCouponCatalog(root);
  assert.throws(() => createCouponBuildTransform({ authPackageJson: authPackage + ' ', authRoot: `${root}/node_modules/@emdash-cms/auth` }), /identity changed/);
});

test('request-local locale instances remain isolated during mixed-locale rendering', async () => {
  const en = couponText({ ui: { locale: 'en', direction: 'ltr' } });
  const ar = couponText({ ui: { locale: 'ar', direction: 'rtl' } });
  const fr = couponText({ ui: { locale: 'fr', direction: 'ltr' } });
  const renders = await Promise.all(Array.from({ length: 50 }, (_, index) => Promise.resolve().then(() =>
    [en('Open {code}', { code: `EN${index}` }), ar('Open {code}', { code: `AR${index}` }), fr('Open {code}', { code: `FR${index}` })])));
  for (let index = 0; index < renders.length; index++) {
    assert.deepEqual(renders[index], [`Open EN${index}`, `Open AR${index}`, `Open FR${index}`]);
  }
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
