import { writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';

// No errors, stdout, headers, storage, capabilities or arbitrary attachments.
export default class ConsumerEvidenceReporter {
  outcomes = [];
  onTestEnd(test, result) {
    this.outcomes.push({ testFile: basename(test.location.file), status: result.status,
      expectedStatus: test.expectedStatus, durationMs: result.duration, retry: result.retry });
  }
  onEnd(result) {
    writeFileSync(resolve(process.env.COMMERCE_CONSUMER_EVIDENCE, 'outcomes.json'),
      JSON.stringify({ format: 'registry-installed-local', status: result.status, outcomes: this.outcomes }, null, 2));
  }
}
