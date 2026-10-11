import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Deliberately omit errors, stdout, requests, attachments and account state.
export default class SettingsEvidenceReporter {
  outcomes = [];
  onTestEnd(test, result) {
    this.outcomes.push({ project: test.parent.project()?.name,
      status: result.status, expectedStatus: test.expectedStatus,
      durationMs: result.duration, retry: result.retry });
  }
  onEnd(result) {
    writeFileSync(resolve(process.env.COMMERCE_SETTINGS_ARTIFACTS, 'outcomes.json'),
      JSON.stringify({ status: result.status, outcomes: this.outcomes }, null, 2));
  }
}
