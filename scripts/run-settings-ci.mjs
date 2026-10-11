import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectSettingsEvidence } from './settings-evidence.mjs';

const run = process.env.COMMERCE_SETTINGS_PROOF_RUN ?? String(Date.now());
if (!/^[a-zA-Z0-9_-]+$/.test(run)) throw new Error('Invalid settings proof run');
const directory = resolve('.tmp/settings-ci', run);
const evidence = resolve('.tmp/settings-evidence', run);
if (existsSync(directory)) throw new Error("Settings proof run must be fresh");
mkdirSync(directory, { recursive: true });
const result = spawnSync(resolve('node_modules/.bin/playwright'),
  ['test', '--config=tests/merchant-settings.playwright.config.mjs'], {
    stdio: 'inherit', env: { ...process.env, COMMERCE_SETTINGS_PROOF_RUN: run },
  });
let collectionFailed = false;
try {
  const summary = collectSettingsEvidence(directory, evidence);
  if (summary.status !== "passed" || !["native", "registry"].every(project =>
    summary.outcomes.some(row => row.project === project && row.status === "passed" && row.expectedStatus === "passed"))) {
    collectionFailed = true;
  }
}
catch { console.error('Settings evidence collection failed'); collectionFailed = true; }
console.log(`Settings evidence: ${evidence}`);
// Collection is never allowed to turn a failed or signalled test into success.
process.exitCode = result.status === 0 && !result.error && !result.signal && !collectionFailed ? 0 : (result.status || 1);
