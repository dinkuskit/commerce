import assert from 'node:assert/strict';
import test from 'node:test';
import { needsBrowser } from '../../.github/scripts/browser-plan.mjs';

test('record-only changes skip the browser tests', () => {
  assert.equal(needsBrowser(['.grilltrack/ledger.json', '.grilltrack/proof/x/PROOF.md', '.changeset/a.md', 'docs/contracts/commerce-handoffs.md', 'README.md', '']), false);
});

test('any other change, or no readable change, runs the browser tests', () => {
  assert.equal(needsBrowser(['README.md', 'src/plugin.ts']), true);
  assert.equal(needsBrowser(['skills/commerce-verification/SKILL.md']), true);
  assert.equal(needsBrowser(['.github/workflows/repo-contract.yml']), true);
  assert.equal(needsBrowser(['']), true);
  assert.equal(needsBrowser([]), true);
});
