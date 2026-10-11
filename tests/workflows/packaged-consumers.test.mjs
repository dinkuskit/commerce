import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ConsumerEvidenceReporter from '../consumer-evidence-reporter.mjs';

test('installed consumer reporter retains failure status without logs, errors, attachments or paths', () => {
  const directory = mkdtempSync(join(tmpdir(), 'commerce-consumer-outcomes-'));
  const previous = process.env.COMMERCE_CONSUMER_EVIDENCE;
  process.env.COMMERCE_CONSUMER_EVIDENCE = directory;
  try {
    const reporter = new ConsumerEvidenceReporter();
    reporter.onTestEnd({ location: { file: '/synthetic/packaged-consumers.spec.mjs' }, expectedStatus: 'passed' },
      { status: 'failed', duration: 10, retry: 0, error: 'SYNTHETIC-EXCLUDED', stdout: 'SYNTHETIC-EXCLUDED', attachments: ['SYNTHETIC-EXCLUDED'] });
    reporter.onEnd({ status: 'failed', error: 'SYNTHETIC-EXCLUDED' });
    const raw = readFileSync(join(directory, 'outcomes.json'), 'utf8');
    assert.doesNotMatch(raw, /SYNTHETIC-EXCLUDED|\/synthetic\//);
    const summary = JSON.parse(raw);
    assert.equal(summary.status, 'failed');
    assert.equal(summary.outcomes[0].status, 'failed');
  } finally {
    if (previous === undefined) delete process.env.COMMERCE_CONSUMER_EVIDENCE;
    else process.env.COMMERCE_CONSUMER_EVIDENCE = previous;
  }
});

test('consumer CI keeps failure propagation and uploads only explicit synthetic receipts and screenshots', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/repo-contract.yml', import.meta.url), 'utf8');
  const verifier = readFileSync(new URL('../../bin/verify-commerce', import.meta.url), 'utf8');
  assert.match(verifier, /npm run test:sandbox:orders[\s\S]*npm run test:consumer:native/);
  assert.match(workflow, /run: bin\/verify-commerce full/);
  assert.doesNotMatch(workflow, /continue-on-error/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /retention-days: 14/);
  assert.doesNotMatch(workflow, /evidence\/\*|trace\.zip|storage-state|\.db/);
});
