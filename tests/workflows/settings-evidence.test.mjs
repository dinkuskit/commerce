import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectSettingsEvidence } from '../../scripts/settings-evidence.mjs';

test('collector publishes only named screenshots and sanitized outcomes, never raw state', () => {
  const root = mkdtempSync(join(tmpdir(), 'settings-evidence-'));
  const source = join(root, 'source'); mkdirSync(source);
  writeFileSync(join(source, 'registry-failure.png'), Buffer.from([137,80,78,71,13,10,26,10]));
  for (const name of ['trace.zip', 'state.json', 'content.db', 'arbitrary.png']) writeFileSync(join(source, name), 'SYNTHETIC-DO-NOT-COPY');
  writeFileSync(join(source, 'outcomes.json'), JSON.stringify({ status: 'failed', secret: 'SYNTHETIC-DO-NOT-COPY',
    outcomes: [{ project: 'registry', status: 'failed', expectedStatus: 'passed', durationMs: 10, retry: 0,
      error: 'SYNTHETIC-DO-NOT-COPY', stdout: 'SYNTHETIC-DO-NOT-COPY' }] }));
  const target = join(root, 'safe');
  assert.equal(collectSettingsEvidence(source, target, root).status, 'failed');
  assert.doesNotMatch(readFileSync(join(target, 'outcomes.json'), 'utf8'), /SYNTHETIC-DO-NOT-COPY/);
  assert.deepEqual(JSON.parse(readFileSync(join(target, 'digests.json'))).screenshots, ['registry-failure.png']);
  assert.deepEqual(readdirSync(target).sort(), ['digests.json', 'outcomes.json', 'registry-failure.png']);
});


test('collector refuses allowlisted symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'settings-evidence-'));
  const source = join(root, 'source'); mkdirSync(source);
  const outside = join(root, 'outside.png'); writeFileSync(outside, 'synthetic');
  symlinkSync(outside, join(source, 'native-failure.png'));
  assert.throws(() => collectSettingsEvidence(source, join(root, 'safe'), root), /Unsafe evidence/);
});

test('collector refuses malformed outcomes and reused evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'settings-evidence-'));
  const source = join(root, 'source'); mkdirSync(source);
  writeFileSync(join(source, 'outcomes.json'), JSON.stringify({ status: 'passed', outcomes: [
    { project: 'unknown', status: 'passed', expectedStatus: 'passed', durationMs: 1, retry: 0 }
  ] }));
  assert.throws(() => collectSettingsEvidence(source, join(root, 'safe'), root), /Invalid outcome/);
  const stale = join(root, 'stale'); mkdirSync(stale);
  writeFileSync(join(stale, 'old.png'), 'synthetic');
  assert.throws(() => collectSettingsEvidence(source, stale, root), /must be empty/);
});

test('CI retains original verification plus a failing settings gate and narrow fourteen-day evidence', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/repo-contract.yml', import.meta.url), 'utf8');
  const verifier = readFileSync(new URL('../../bin/verify-commerce', import.meta.url), 'utf8');
  assert.match(workflow, /run: bin\/verify-commerce core/);
  assert.match(workflow, /merchant-settings:[\s\S]*run: npm run test:settings/);
  assert.doesNotMatch(workflow, /continue-on-error/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /retention-days: 14/);
  assert.doesNotMatch(workflow, /path:\s*\|[\s\S]*trace\.zip/);
  assert.match(verifier, /full\)[\s\S]*"\$script_dir\/verify-commerce" core[\s\S]*npm run test:settings/);
});
