# Merchant settings CI evidence

`bin/verify-commerce full` retains all existing checks and adds the existing
merchant settings browser scenario on native and Registry-format local hosts.
CI runs the retained `core` path and settings as two independent gating jobs;
neither uses `continue-on-error`. Each keeps a ten-minute timeout.

The baseline main CI run 38107331167 completed in 4m06s; its full verification
step took 3m22s. The settings baseline took 45.1s (Registry 9.4s, native 11.8s).
The evidence-enabled local run passed both hosts in 39.2s. Separate jobs leave
failure/startup headroom and avoid adding settings latency to existing checks.
Dependencies are installed from the existing lockfile; builds are local to each
job so there is no stale artifact reuse across candidate revisions.

## Reproduce

Use Node 22.23.2, `npm ci`, and the lockfile's Chromium installation.

- `npm run test:settings`: build, both hosts, stage sanitized evidence.
- `node --test tests/workflows/settings-evidence.test.mjs`: allowlist and CI contracts.
- `COMMERCE_SETTINGS_CONTROLLED_FAILURE=1 node scripts/run-settings-ci.mjs`:
  intentionally fails both tests after the existing persistence/denial scenario.
  This controlled run returned exit 1 and staged two failure screenshots plus
  sanitized failed outcomes and package/runtime digests.
- `bin/verify-commerce full`: all retained checks and settings.

Each run uses a fresh directory. The collector copies only eight explicitly
named PNG screenshots and reconstructs status/project/duration/retry fields.
It rejects symlinks, invalid outcomes, and reused evidence destinations.
CI uploads only those staged PNGs, `outcomes.json`, and `digests.json`, retained
for 14 days even when tests fail. Screenshot inspection showed only the built-in
Dev Admin and synthetic country settings. No media is committed here.

Traces, HAR, cookies, storage state, databases, raw errors/logs and arbitrary
attachments are omitted because they can contain authenticated session state.
This is compiled local-plugin fixture proof; it is not an installed tarball,
Registry-published release, hosted/live checkout or merchant-to-label journey.
