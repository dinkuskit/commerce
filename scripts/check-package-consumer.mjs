import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

// Packs Commerce, installs the tarball in a fresh outside project, and proves what host apps rely on:
// every declared export resolves and loads, the CLI runs, and the package root is a library with no
// EmDash plugin entry. The Registry build itself is proven installed by test:sandbox:orders.

const root = resolve('.');
const run = String(Date.now());
const evidence = resolve('.tmp/commerce-consumers-runs', 'package-' + run, 'evidence');
mkdirSync(evidence, { recursive: true });
const external = mkdtempSync(join(tmpdir(), 'commerce-package-consumer-'));
const archive = resolve('.tmp/package-consumer', run); mkdirSync(archive, { recursive: true });
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
  writeFileSync(resolve(evidence, 'digests.json'), JSON.stringify({ format: 'npm-package-consumer', package: manifest.name, version: manifest.version,
    tarballSha256: createHash('sha256').update(readFileSync(tarball)).digest('hex'), tarballBytes: packed.size }, null, 2));
  // A host app that imports Commerce's libraries: the package and its EmDash peer, nothing else.
  const versions = Object.fromEntries(['emdash', 'react', 'react-dom']
    .map(name => [name, lock.packages['node_modules/' + name].version]));
  const consumer = { name: 'synthetic-commerce-consumer', version: '0.0.0', private: true, type: 'module',
    dependencies: { '@dinkuskit/commerce': 'file:' + tarball, ...versions } };
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
  phase = 'exports';
  writeFileSync(join(external, 'smoke.mjs'), String.raw`
import assert from 'node:assert/strict';
import { readFileSync, realpathSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as commerce from '@dinkuskit/commerce';
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
 if (!['./sandbox', './descriptor'].includes(subpath)) {
  if (target.endsWith('.json')) await import(specifier, { with: { type: 'json' } });
  else await import(specifier);
 }
}
for (const path of Object.values(pkg.bin ?? {})) {
 assert(existsSync(resolve(packageRoot, path)));
 const help = spawnSync(process.execPath, [resolve(packageRoot, path), '--help'], { encoding: 'utf8' });
 assert.equal(help.status, 0); assert(help.stdout.includes('dinkus-commerce'));
}
// The package root is a library: no EmDash plugin entry (commerce-remove-native-entry-20261101).
for (const name of ['createPlugin', 'dinkusCommerce', 'default']) assert.equal(commerce[name], undefined, name);
for (const name of ['COMMERCE_PLUGIN_ID', 'CATALOG_API_ROUTE', 'createCatalogItem', 'resolveCatalogItemPrice',
 'resolveStorefrontAvailability', 'loadMerchantStoreSettings', 'PAID_ORDER_SCHEMA', 'lookUpOrder']) {
 assert.notEqual(commerce[name], undefined, name);
}
writeFileSync(resolve('package-result.json'), JSON.stringify({ entrypoints, packageRootInsideExternalNodeModules: true,
 noPluginEntry: true, cliHelp: true, version: pkg.version }));
`);
  const smoke = spawnSync(process.execPath, ['smoke.mjs'], { cwd: external, env, encoding: 'utf8', timeout: 240000 });
  if (smoke.status !== 0 || smoke.error || smoke.signal) {
    failure = { category: 'module-loader', errorCode: smoke.stderr?.match(/ERR_[A-Z_]+/)?.[0] ?? null, exitCode: smoke.status };
    throw new Error('Package consumer smoke failed');
  }
  const result = JSON.parse(readFileSync(join(external, 'package-result.json')));
  writeFileSync(resolve(evidence, 'digests.json'), JSON.stringify({ format: 'npm-package-consumer', package: manifest.name,
    version: manifest.version, tarballSha256: createHash('sha256').update(readFileSync(tarball)).digest('hex'),
    tarballBytes: packed.size, entrypoints: result.entrypoints, versions,
    lockfileSha256: createHash('sha256').update(readFileSync('package-lock.json')).digest('hex'),
    packageRootInsideExternalNodeModules: result.packageRootInsideExternalNodeModules }, null, 2));
  writeFileSync(resolve(evidence, 'outcomes.json'), JSON.stringify({ status: 'passed',
    noPluginEntry: result.noPluginEntry, cliHelp: result.cliHelp }, null, 2));
  console.log('npm_package_consumer=pass declared-exports library-root cli-help');
} catch {
  writeFileSync(resolve(evidence, 'outcomes.json'), JSON.stringify({ status: 'failed', phase, failure }, null, 2));
  console.error('npm_package_consumer=failed phase=' + phase);
  process.exitCode = 1;
}
