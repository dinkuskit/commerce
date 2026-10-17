import { spawnSync } from 'node:child_process';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rolldown } from 'rolldown';
import { buildPlugin } from '@emdash-cms/plugin-cli';

if (process.versions.node !== '22.23.2') throw new Error('Use repository Node 22.23.2');
const paymentIndex = process.argv.indexOf('--payments');
if (paymentIndex < 0 || !process.argv[paymentIndex + 1]) throw new Error('Supply --payments <isolated Payments checkout>');
const payments = resolve(process.argv[paymentIndex + 1]);
function exec(cmd, args, cwd = process.cwd(), env = process.env) {
  const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('Local merchant command failed: ' + cmd + ' ' + args.join(' '));
}
function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status) throw new Error('Unable to verify source'); return r.stdout.trim();
}
const paymentHead = git(payments, 'rev-parse', 'HEAD');
if (paymentHead !== '922e0de9d86ca935bdca852f44552c6c34c50203') throw new Error('Payments source differs from qualified fixture revision');
if (git(payments, 'status', '--porcelain', '--untracked-files=no')) throw new Error('Payments tracked source must be clean');
const batch = 'local-' + Date.now() + '-' + randomUUID().slice(0, 8);
mkdirSync(resolve('.tmp/local-merchant'), { recursive: true });
const root = resolve('.tmp/local-merchant', batch); mkdirSync(root, { recursive: false });
function event(name) {
  const at = new Date().toISOString(); writeFileSync(resolve(root, 'heartbeat'), at + '\n');
  appendFileSync(resolve(root, 'events.jsonl'), JSON.stringify({ at, event: name }) + '\n');
  writeFileSync(resolve(root, 'STATE.md'), `Status: ${name}\nSource: ${git(process.cwd(), 'rev-parse', 'HEAD')}\nLocal fixture only. Hosted boundaries unverified.\n`);
}
event('preparing');
writeFileSync(resolve(root, 'PROOF.md'), '# Local merchant execution\n\nPreparing local fixture builds. No hosted certification.\n');
if (!existsSync(resolve(payments, 'node_modules'))) exec('npm', ['ci'], payments);
exec('npm', ['run', 'build']);
exec(resolve('node_modules/.bin/playwright'), ['install', 'chromium']);
const port = Number(process.env.LOCAL_MERCHANT_PORT ?? 64751);
const origin = 'http://127.0.0.1:' + port;
const stage = resolve(root, 'payments-source'); mkdirSync(resolve(stage, 'src'), { recursive: true });
const bundle = await rolldown({ input: resolve(payments, 'src/plugin.ts'), platform: 'browser' });
await bundle.write({ file: resolve(stage, 'src/factory.js'), format: 'esm' }); await bundle.close();
writeFileSync(resolve(stage, 'src/plugin.ts'), `import { createPaymentsPlugin } from './factory.js';\nexport default createPaymentsPlugin({ endpoint: { status: 'https://payments.dinkuskit.com/v1/status' }, testOnly: { storeOrigin: ${JSON.stringify(origin)}, verificationOrigin: ${JSON.stringify(origin)} } });\n`);
for (const file of ['package.json', 'emdash-plugin.jsonc']) writeFileSync(resolve(stage, file), readFileSync(resolve(payments, file)));
const paymentBuild = resolve(root, 'payments-build');
await buildPlugin({ dir: stage, outDir: paymentBuild });
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const identities = { commerceHead: git(process.cwd(), 'rev-parse', 'HEAD'), paymentsHead: paymentHead,
  sourceDirty: Boolean(git(process.cwd(), 'status', '--porcelain', '--untracked-files=no')),
  node: process.version, emdash: '1.2.0', runner: '@emdash-cms/sandbox-workerd@0.9.3 (WorkerdSandboxRunner)',
  playwright: JSON.parse(readFileSync('node_modules/@playwright/test/package.json')).version,
  commerceVersion: JSON.parse(readFileSync('package.json')).version, paymentsVersion: '0.2.8',
  commerceBackend: hash('dist/sandbox/plugin.mjs'), paymentsBackend: hash(resolve(paymentBuild, 'plugin.mjs')),
  commerceDescriptor: hash('dist/sandbox/index.mjs'), paymentsDescriptor: hash(resolve(paymentBuild, 'index.mjs')),
  workerd: spawnSync(resolve('node_modules/.bin/workerd'), ['--version'], { encoding: 'utf8' }).stdout?.trim() || 'see resolved sandbox package for platform binary',
  commerceLock: hash('package-lock.json'), paymentsLock: hash(resolve(payments, 'package-lock.json')),
  assertions: hash('tests/local-merchant/journey.spec.mjs'), paymentsProfile: 'supported createPaymentsPlugin testOnly localhost config; unchanged plugin implementation',
  registration: 'local sandboxed descriptor builds; not Registry installation or hosted authentication' };
writeFileSync(resolve(root, 'identities.json'), JSON.stringify(identities, null, 2));
let previousAttempt;
try {
  for (const ordinal of [1, 2]) {
    const id = batch + '-run' + ordinal, directory = resolve(root, 'run' + ordinal); mkdirSync(directory);
    event('running-' + ordinal); const started = new Date().toISOString();
    exec(resolve('node_modules/.bin/playwright'), ['test', '--config=tests/local-merchant.playwright.config.mjs'], process.cwd(), {
      ...process.env, LOCAL_MERCHANT_RUN: id, LOCAL_MERCHANT_DIRECTORY: directory,
      LOCAL_PAYMENTS_DESCRIPTOR: resolve(paymentBuild, 'index.mjs'), LOCAL_PAYMENTS_BACKEND: resolve(paymentBuild, 'plugin.mjs'),
      // Disposable per-run encryption material stays in the child process environment.
      LOCAL_MERCHANT_PORT: String(port), EMDASH_ENCRYPTION_KEY: 'emdash_enc_v1_' + randomBytes(32).toString('base64url'),
    });
    // A skipped/empty test run cannot become PASS simply through exit code zero.
    const observed = JSON.parse(readFileSync(resolve(directory, 'observable-state.json')));
    if (observed.result !== 'PASS_LOCAL_FIXTURE' || observed.run !== id || observed.sessions.length !== 1 ||
        !observed.acknowledged || observed.sessions[0].attemptId === previousAttempt) throw new Error('Missing or reused observable journey evidence');
    previousAttempt = observed.sessions[0].attemptId;
    for (const [plugin, expected] of [['dinkus-commerce', identities.commerceBackend], ['r_3brsc2on3bu673rn', identities.paymentsBackend]]) {
      const loaded = JSON.parse(readFileSync(resolve(directory, 'loaded-' + plugin + '.json')));
      if (!loaded.loaded || loaded.backendSha256 !== expected || loaded.runner !== 'WorkerdSandboxRunner') throw new Error('Loaded build identity mismatch');
    }
    if (hash('tests/local-merchant/journey.spec.mjs') !== identities.assertions) throw new Error('Assertions changed during execution');
    writeFileSync(resolve(directory, 'result.json'), JSON.stringify({ result: 'PASS_LOCAL_FIXTURE', id, started, finished: new Date().toISOString(), ...identities }, null, 2));
    writeFileSync(resolve(directory, 'PROOF.md'), `# Run ${ordinal}\n\nPASS_LOCAL_FIXTURE. Fresh database/storage/browser context, unique run identity.\nSee result.json and observable-state.json. Screenshots contain only generated fixture data.\nNo real Stripe/PB/Ship/PDF/tracking, Registry install/update, deployed auth or hosted E2E certification.\n`);
  }
  event('passed-twice');
  writeFileSync(resolve(root, 'PROOF.md'), '# Two local fixture runs passed\n\nSame builds and assertions; independent data and browser contexts. See run1/ and run2/.\n');
} catch (e) { event('failed'); writeFileSync(resolve(root, 'PROOF.md'), '# Local fixture blocked\n\nSee command output and last state; no hosted claims.\n'); throw e; }
console.log('Local merchant evidence: ' + root);
