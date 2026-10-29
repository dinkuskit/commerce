# Merchant country guidance: current-main revalidation

This changes **one displayed context string**, not checkout policy. The settings
screen currently says that checkout does not enforce country eligibility;
physical checkout already checks its destination against `shippingCountries`.
The replacement distinguishes that check from the persisted but unenforced
selling/customer list. See the updated implementation note and release article.

## Identities and independence

- Base: upstream `19b25b2878803f85db94c6c4853df1d7d1e4f448`.
- Tested source: `2370818b0c5d6b50eb4160ad5cd2933e9b8f1dd4`.
- Source patch selected from original `11693367844de707d34a6bf450baa7f876e04f87`;
  original contribution `9b0284dffa76461be17fbb29c218bf2ce920fa9c` remains unchanged.
  The old branch happened to include the development DOMPurify update. **This
  current-main branch does not:** package/lock/installed DOMPurify3.4.16 are
  unchanged from main. No dependency on that update or another open PR.
- The evidence commit is a proof-only child of the tested source. Capture/test
  digests, exact backend identities and run outcomes are in `manifest.json`.
  These are transparent records, not signed runner attestation.

## Red/green and full gates

On a fresh base19b build with only the regression file added: **13 pass /3 fail**
(exit1). The failures are the enclosing test and its configured/unconfigured
children, not three independent defects. Both rendered SDK block responses still
contained the old misleading sentence. After the one-string change, the complete
source run passed **759/759 unit/workflow +110/110 integration**, no skips,
failures or retries. Build, typecheck, repository audit, GrillTrack validation,
diff/clean and Registry bundle checks passed. This is not a fresh dependency
security assessment.

Source backend: **131007 bytes /65 bytes headroom**, SHA256
`ae50fc8beb73af5cc05d1f8f17be631b8251c0ed8cc5444e2abaf6034dd118fa`.
`dist/sandbox/plugin.mjs` exactly equals extracted Registry `backend.js`.
Against base19b (131044/28), this patch saves37 bytes. Measurements are specific
to this branch, not a promise about combining arbitrary contributions.

## Actual mounted form: published before, proposed after

Before testing the published plugin, fresh official Registry approved-release
listing and a complete public publisher scan found **eight stable versions and
no beta** (19:04–19:07UTC2026-10-29). Selected stable0.6.0. The observed current
release record matches the previously downloaded Registry package's size and
checksum; its untouched manifest/backend were used. Exact metadata and scope are
in `registry-selection.json`. This is not a tag/npm inference or independent
provenance-signature certification.

The published0.6 backend is131050 bytes, SHA256
`f292f09c1c360f828a0c96614fd69342327b23374150088c6c151ff1b61ed471`.
It is **not** the base19b or proposed backend even though all manifest versions
say0.6.0. Version strings alone do not identify tested bytes.

Ran on our own loopback HTTP EmDash/Astro site with actual admin, SQLite and SDK
workerd, using a descriptor directly projected from the downloaded manifest:
its id/version/capabilities/allowedHosts/storage/hooks/routes and admin settings,
pages and panels. No grant or route was added, and the official backend was not
patched. This is an explicit sandbox mount, **not the full Registry installer**.
The native proposed run uses the repo's separate real native EmDash integration.
Both use synthetic dev-bypass admin/site data, not production authentication.

The same merchant-settings journey was used for all three lanes. For the
published lane only, an ignored copy changes the guidance assertion to the
expected **old** string; all persistence/validation/CAS/authorization assertions
and bounded reload readiness remain identical. This is a before-control pass,
not a claim that the regression is fixed in0.6.0. Proposed runs execute the
committed test without that replacement and require the **new** string.

| Lane | Run | Result | Retries |
|---|---|---|---|
| Published0.6, real SDK sandbox | `settings-country-official-20261029-01` | 1/1,63.438s | 0 |
| Proposed237, local SDK sandbox | `settings-country-proposed-registry-20261029-01` | 1/1,62.287s | 0 |
| Proposed237, native mount | `settings-country-proposed-native-20261029-01` | 1/1,57.323s | 0 |

Source checks completed19:16:59UTC. Node24.22.0, EmDash1.2.0,
SDK sandbox-workerd0.9.3/workerd1.20260826.1, Playwright1.61.1 /
Chromium149.0.7827.55, Linux desktop1440×1100. No mobile/touch claim.

The journey saves the phone flag before a country exists, applies first-country
list defaults, independently edits/preserves lists, reloads saved values,
refuses a stale CAS replay, refuses invalid country input without changing saved
values, and rejects an anonymous write. The only readiness change waits for the
form after each document reload with the existing initial60s bound; all saved
value assertions and the overall180s test/120s server timeouts remain intact.
No mutation retry. One worker/host per diagnostic lane, fresh databases/run IDs.

Reviewed screenshots show the same synthetic saved form: countryGB, customer
listCA/MX, shippingGB, phone flagoff. No credentials, customer details, database,
cookies, trace/HAR or raw logs are included. The screenshots prove the actual
visible message before/after, not just block JSON or mocked HTTP responses.

These form journeys are **not** physical checkout, actual payment/provider,
external channel, mobile/device or complete release journeys. Existing unit and
compiled-workerd integration suites separately cover destination rejection and
recovery; this patch does not change that behavior or claim a new real-provider
qualification. No maintainer store/live-journey workflow was touched.

## Reproduce

Use Node24.22.0 and installed pinned dependencies. For a new published-plugin
qualification, query the official Registry first and choose its latest beta
when present, otherwise stable. The metadata above describes the dated0.6.0
baseline, not a perpetual assertion that no beta exists.

For proposed source, the normal commands are:

```sh
npm test
npm run test:integration
npm run typecheck
npm run audit:repo
./scripts/grilltrack --project . validate
# Sequential, not alongside another build/browser host. Fresh names each time.
ASTRO_TELEMETRY_DISABLED=1 XDG_CONFIG_HOME="$PWD/.tmp/astro-config" \
 COMMERCE_SETTINGS_PROOF_PROFILE=registry \
 COMMERCE_SETTINGS_PROOF_RUN=your-fresh-registry-run \
 node_modules/.bin/playwright test \
 --config=tests/merchant-settings.playwright.config.mjs --project=registry
# Repeat separately with PROFILE=native, --project=native and a fresh run name.
```

The published lane uses the sandbox site's existing `COMMERCE_SANDBOX_DESCRIPTOR`
and `COMMERCE_SANDBOX_ARTIFACT` overrides with the untouched downloaded artifact.
Its descriptor projection and copied journey can be reproduced without changing
product code: see `baseline-setup.mjs`, which writes a fresh ignored directory
containing only the adapter/test/config. It does not download, install, start a
server or alter permissions. Supply the freshly selected official manifest and
backend. For example, from the Commerce root:

```sh
node proof/settings-country-guidance-current-20261029/baseline-setup.mjs \
 /absolute/verified-official-package .tmp/your-fresh-baseline
ASTRO_TELEMETRY_DISABLED=1 XDG_CONFIG_HOME="$PWD/.tmp/astro-config" \
 COMMERCE_SETTINGS_PROOF_PROFILE=registry \
 COMMERCE_SETTINGS_PROOF_RUN=your-fresh-published-run \
 COMMERCE_SANDBOX_DESCRIPTOR="$PWD/.tmp/your-fresh-baseline/descriptor.mjs" \
 COMMERCE_SANDBOX_ARTIFACT=/absolute/verified-official-package/backend.js \
 node_modules/.bin/playwright test \
 --config=.tmp/your-fresh-baseline/playwright.config.mjs --project=registry
```

The helper-generated descriptor and journey were compared with the ones used by
the captured baseline: descriptor objects deep-equal, journey bytes identical.
Its baseline assertion intentionally expects the old sentence, so a later
release with corrected guidance must not be relabelled as the old baseline.
