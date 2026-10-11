import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const root = resolve('.');
const run = String(Date.now());
const evidence = resolve('.tmp/commerce-consumers-runs', 'native-' + run, 'evidence');
mkdirSync(evidence, { recursive: true });
const external = mkdtempSync(join(tmpdir(), 'commerce-native-consumer-'));
const archive = resolve('.tmp/native-consumer', run); mkdirSync(archive, { recursive: true });
const lock = JSON.parse(readFileSync('package-lock.json'));
const manifest = JSON.parse(readFileSync('package.json'));
const env = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', COMMERCE_CONSUMER_EVIDENCE: evidence };
let phase = 'pack';
let failure = {};
function command(args, cwd, timeout = 180000) {
  const result = spawnSync('npm', args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 });
  // Never emit npm/host stderr, account configuration or arbitrary raw logs.
  if (result.status !== 0 || result.error || result.signal) {
    failure = { category: 'npm-command', exitCode: result.status, signal: result.signal };
    throw new Error('Consumer command failed');
  }
  return result.stdout;
}
try {
  const packed = JSON.parse(command(['pack', '--json', '--pack-destination', archive], root))[0];
  const tarball = join(archive, packed.filename);
  const binPaths = Object.values(manifest.bin ?? {}).map(path => path.replace(/^\.\//, ''));
  assert(packed.files.every(file => manifest.files.some(path => file.path === path || file.path.startsWith(path + '/')) ||
    [...binPaths, 'package.json', 'README.md', 'LICENSE'].includes(file.path)));
  writeFileSync(resolve(evidence, 'digests.json'), JSON.stringify({ format: 'native-npm-consumer', package: manifest.name, version: manifest.version,
    tarballSha256: createHash('sha256').update(readFileSync(tarball)).digest('hex'), tarballBytes: packed.size }, null, 2));
  const versions = Object.fromEntries(['emdash', 'react', 'react-dom', 'astro', '@astrojs/node', '@astrojs/react', '@playwright/test']
    .map(name => [name, lock.packages['node_modules/' + name].version]));
  const consumer = { name: 'synthetic-commerce-consumer', version: '0.0.0', private: true, type: 'module',
    dependencies: { '@dinkuskit/commerce': 'file:' + tarball, emdash: versions.emdash, react: versions.react },
    devDependencies: Object.fromEntries(Object.entries(versions).filter(([name]) => !['emdash', 'react'].includes(name))) };
  writeFileSync(join(external, 'package.json'), JSON.stringify(consumer, null, 2));
  // Seed npm's standard lock reconciliation with this repository's public
  // lock, then prune to the consumer's minimal declared host/tool dependencies.
  // No repository node_modules is linked or copied, and no aliases are used.
  const seeded = structuredClone(lock);
  seeded.name = consumer.name; seeded.version = consumer.version; seeded.packages[''] = consumer;
  writeFileSync(join(external, 'package-lock.json'), JSON.stringify(seeded));
  phase = 'install';
  command(['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], external);
  const installedLock = JSON.parse(readFileSync(join(external, 'package-lock.json')));
  const originalPins = new Set(Object.entries(lock.packages).filter(([path]) => path)
    .map(([path, value]) => path.split('node_modules/').at(-1) + '@' + value.version));
  for (const [path, entry] of Object.entries(installedLock.packages)) {
    if (!path || path === 'node_modules/@dinkuskit/commerce') continue;
    if (!originalPins.has(path.split('node_modules/').at(-1) + '@' + entry.version)) {
      failure = { category: 'dependency-drift', package: path.split('node_modules/').at(-1), version: entry.version };
      throw new Error('Consumer dependency drift');
    }
  }
  command(['ci', '--no-audit', '--no-fund'], external);
  phase = 'exports-and-host';
  writeFileSync(join(external, 'astro.config.mjs'), `
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
import emdash, { local } from 'emdash/astro';
import { sqlite } from 'emdash/db';
import { dinkusCommerce } from '@dinkuskit/commerce';
export default defineConfig({ output: 'server', adapter: node({ mode: 'standalone' }),
 integrations: [react(), emdash({ database: sqlite({ url: 'file:./content.db' }),
 storage: local({ directory: './uploads', baseUrl: '/_emdash/api/media/file' }),
 siteUrl: process.env.EMDASH_SITE_URL, plugins: [dinkusCommerce({ siteUrl: process.env.EMDASH_SITE_URL })] })],
 devToolbar: { enabled: false } });
`);
  mkdirSync(join(external, 'src/pages'), { recursive: true });
  writeFileSync(join(external, 'src/pages/index.astro'), '<html><body><h1>Synthetic external Commerce consumer</h1></body></html>');
  writeFileSync(join(external, 'smoke.mjs'), String.raw`
import assert from 'node:assert/strict';
import { readFileSync, realpathSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import { dinkusCommerce, createPlugin } from '@dinkuskit/commerce';
const packageRoot = resolve(dirname(fileURLToPath(import.meta.resolve('@dinkuskit/commerce'))), '..');
assert(packageRoot.startsWith(realpathSync(resolve('node_modules')) + sep));
const pkg = JSON.parse(readFileSync(resolve(packageRoot, 'package.json')));
const entrypoints = [];
for (const [subpath, declaration] of Object.entries(pkg.exports)) {
 const target = typeof declaration === 'string' ? declaration : declaration.default;
 const specifier = '@dinkuskit/commerce' + (subpath === '.' ? '' : subpath.slice(1));
 assert.equal(fileURLToPath(import.meta.resolve(specifier)), resolve(packageRoot, target));
 assert(existsSync(resolve(packageRoot, target)));
 if (declaration.types) assert(existsSync(resolve(packageRoot, declaration.types)));
 entrypoints.push(subpath);
 if (!['./admin', './sandbox', './descriptor'].includes(subpath)) {
  if (target.endsWith('.json')) await import(specifier, { with: { type: 'json' } });
  else await import(specifier);
 }
}
for (const path of Object.values(pkg.bin ?? {})) {
 assert(existsSync(resolve(packageRoot, path)));
 const help = spawnSync(process.execPath, [resolve(packageRoot, path), '--help'], { encoding: 'utf8' });
 assert.equal(help.status, 0); assert(help.stdout.includes('dinkus-commerce'));
}
assert.equal(dinkusCommerce().entrypoint, '@dinkuskit/commerce');
assert(createPlugin().routes['checkout/guest/prepare']);
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const origin = 'http://127.0.0.1:' + port;
const host = spawn(process.execPath, [realpathSync('node_modules/.bin/astro'), 'dev', '--host', '127.0.0.1', '--port', String(port)],
 { cwd: process.cwd(), env: { ...process.env, EMDASH_SITE_URL: origin, ASTRO_DEV_BACKGROUND: '1', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
host.stdout.resume();
const hostCodes = new Set(), missingPackages = new Set();
host.stderr.on('data', chunk => {
 const text = String(chunk);
 for (const code of text.match(/ERR_[A-Z_]+/g) ?? []) hostCodes.add(code);
 for (const name of Object.keys(pkg.devDependencies ?? {})) {
  if (text.includes('Cannot find') && text.includes(name) || text.includes('Failed to resolve') && text.includes(name)) missingPackages.add(name);
 }
});
let browser, page;
function stopHost() {
 if (host.exitCode === null && host.pid) {
  try { if (process.platform !== 'win32') process.kill(-host.pid, 'SIGTERM'); else host.kill('SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
 }
}
process.once('exit', stopHost);
process.once('SIGTERM', () => { stopHost(); process.exit(1); });
try {
 const deadline = Date.now() + 120000;
 let ready = false;
 while (Date.now() < deadline) {
  if (host.exitCode !== null) throw new Error('Native host exited');
  try { ready = (await fetch(origin, { signal: AbortSignal.timeout(2000) })).ok; } catch {}
  if (ready) break;
  await new Promise(resolve => setTimeout(resolve, 250));
 }
 assert(ready, 'Native consumer host unavailable');
 browser = await chromium.launch({ headless: true });
 const context = await browser.newContext();
 page = await context.newPage();
 assert.equal((await context.request.get(origin + '/_emdash/api/setup/dev-bypass')).status(), 200);
 await page.goto(origin + '/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/plugins/dinkus-commerce/store');
 const store = page.getByRole('textbox', { name: 'Store country (ISO alpha-2 code)', exact: true });
 const welcome = page.getByRole('button', { name: 'Get Started', exact: true });
 await store.or(welcome).first().waitFor({ timeout: 60000 });
 if (await welcome.isVisible()) await welcome.click();
 await store.waitFor({ timeout: 60000 });
 await page.screenshot({ path: resolve(process.env.COMMERCE_CONSUMER_EVIDENCE, 'native-settings.png'), animations: 'disabled' });
 const denied = await context.request.post(origin + '/_emdash/api/plugins/dinkus-commerce/checkout/guest/prepare', {
  data: {}, headers: { origin: 'https://foreign.example.test', 'sec-fetch-site': 'cross-site' } });
 assert.equal(denied.ok(), false);
 writeFileSync(resolve('native-result.json'), JSON.stringify({ entrypoints, packageRootInsideExternalNodeModules: true,
  nativeAdminMounted: true, foreignOriginDenied: true, cliHelp: true, version: pkg.version }));
} catch (error) {
 if (page) await page.screenshot({ path: resolve(process.env.COMMERCE_CONSUMER_EVIDENCE, 'native-failure.png'), animations: 'disabled' }).catch(() => {});
 writeFileSync(resolve('native-failure.json'), JSON.stringify({ category: 'host-smoke', errorName: error.name, errorCode: error.code ?? null, hostExitCode: host.exitCode, hostCodes: [...hostCodes], missingPackages: [...missingPackages] }));
 throw error;
} finally {
 await browser?.close();
 // Only this test's newly spawned host process group is touched.
 stopHost();
}
`);
  const smoke = spawnSync(process.execPath, ['smoke.mjs'], { cwd: external, env, encoding: 'utf8', timeout: 240000 });
  if (smoke.status !== 0 || smoke.error || smoke.signal) {
    failure = existsSync(join(external, 'native-failure.json')) ? JSON.parse(readFileSync(join(external, 'native-failure.json'))) :
      { category: 'module-loader', errorCode: smoke.stderr?.match(/ERR_[A-Z_]+/)?.[0] ?? null, exitCode: smoke.status };
    throw new Error('Native integration smoke failed');
  }
  const result = JSON.parse(readFileSync(join(external, 'native-result.json')));
  writeFileSync(resolve(evidence, 'digests.json'), JSON.stringify({ format: 'native-npm-consumer', package: manifest.name,
    version: manifest.version, tarballSha256: createHash('sha256').update(readFileSync(tarball)).digest('hex'),
    tarballBytes: packed.size, entrypoints: result.entrypoints, versions,
    lockfileSha256: createHash('sha256').update(readFileSync('package-lock.json')).digest('hex'),
    packageRootInsideExternalNodeModules: result.packageRootInsideExternalNodeModules }, null, 2));
  writeFileSync(resolve(evidence, 'outcomes.json'), JSON.stringify({ status: 'passed',
    nativeAdminMounted: result.nativeAdminMounted, foreignOriginDenied: result.foreignOriginDenied, cliHelp: result.cliHelp }, null, 2));
  console.log('native_npm_consumer=pass declared-exports installed-native-admin foreign-origin-denial');
} catch {
  writeFileSync(resolve(evidence, 'outcomes.json'), JSON.stringify({ status: 'failed', phase, failure }, null, 2));
  console.error('native_npm_consumer=failed phase=' + phase);
  process.exitCode = 1;
}
