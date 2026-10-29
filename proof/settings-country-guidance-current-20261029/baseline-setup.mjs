import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('From the Commerce root: node baseline-setup.mjs OFFICIAL_ARTIFACT_DIR .tmp/FRESH_OUTPUT_DIR');
} else if (args.length !== 2 || args.some(arg => arg.startsWith('--'))) {
  console.error('Expected artifact directory and a fresh output directory under .tmp; --help for usage.');
  process.exitCode = 2;
} else {
  const root = resolve('.');
  assert.equal(JSON.parse(readFileSync('package.json', 'utf8')).name, '@dinkuskit/commerce');
  const artifact = resolve(args[0]);
  const output = resolve(args[1]);
  assert.ok(output.startsWith(resolve('.tmp') + sep), 'output must be a fresh directory under .tmp');
  const manifestBytes = readFileSync(resolve(artifact, 'manifest.json'));
  const backend = readFileSync(resolve(artifact, 'backend.js'));
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.id, 'dinkus-commerce');
  assert.equal(typeof manifest.version, 'string');
  for (const key of ['capabilities', 'allowedHosts', 'routes']) assert.ok(Array.isArray(manifest[key]));
  assert.ok(Array.isArray(manifest.admin.pages));
  const descriptor = {
    id: manifest.id, version: manifest.version, format: 'standard',
    entrypoint: '@dinkuskit/commerce/sandbox', capabilities: manifest.capabilities,
    allowedHosts: manifest.allowedHosts, storage: manifest.storage, hooks: manifest.hooks,
    routes: manifest.routes, adminPages: manifest.admin.pages,
    settingsSchema: manifest.admin.settingsSchema, editorPanels: manifest.admin.editorPanels,
  };
  const source = readFileSync('tests/sandbox/merchant-settings.spec.mjs', 'utf8');
  const current = 'Checkout checks physical shipping destinations; selling/customer countries are not enforced.';
  const previous = 'Checkout does not enforce country eligibility yet. Selling/customer countries and physical shipping destinations are independent.';
  assert.equal(source.split(current).length, 2, 'expected one guidance assertion');
  const baseline = source.replace(current, previous);
  // Exclusive creation: never reuse a database/run directory or overwrite files.
  mkdirSync(output);
  writeFileSync(resolve(output, 'descriptor.mjs'), 'export default ' + JSON.stringify(descriptor, null, 2) + ';\n', { flag: 'wx' });
  writeFileSync(resolve(output, 'merchant-settings.spec.mjs'), baseline, { flag: 'wx' });
  writeFileSync(resolve(output, 'playwright.config.mjs'),
    'import config from ' + JSON.stringify(pathToFileURL(resolve(root, 'tests/merchant-settings.playwright.config.mjs')).href) + ';\n' +
    'export default { ...config, testDir: ' + JSON.stringify(output) +
    ', reporter: [["list"], [' + JSON.stringify(resolve(root, 'tests/settings-evidence-reporter.mjs')) + ']] };\n', { flag: 'wx' });
  const sha = value => createHash('sha256').update(value).digest('hex');
  console.log(JSON.stringify({ version: manifest.version, backendBytes: backend.length,
    backendSha256: sha(backend), manifestSha256: sha(manifestBytes),
    sourceJourneySha256: sha(source), baselineJourneySha256: sha(baseline),
    scope: 'Explicit manifest projection; does not verify publisher/provenance or use the Registry installer. Query Registry and verify downloaded bytes separately.' }, null, 2));
}
