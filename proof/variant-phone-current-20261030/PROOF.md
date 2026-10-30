# Current variant editor: phone-sized price-save coverage

## Scope

**Test coverage, not a product repair.** Source **da00829491fee439e94d3531d1aa380439a134ec**,
initial parent accepted main **2a37c079c4fe86ad45fcdb4715a0f73322c931e7**.
Preserved original phone contribution281/73 and failed historical draft38 remain
unchanged; this is a fresh adaptation retaining current page-link ownership and
billing assertions, not restoration of an old complete spec or dependency stack.
No dependency on unmerged #218, no runtime/dependency/permission/schema/ledger change.
Empty `.changeset/variant-phone-coverage.md` satisfies the per-PR check without a
version bump. Product article: **Docs: not applicable**, test-only.

The old test passed both cases in native-variant2/2 and sandbox2/2 on parent2a
(**2026-10-30 00:18:56UTC**), but its final phone screenshot only resized the editor.
Reviewed native baseline capture shows a settings sheet without the price-save
controls exercised. This is a coverage gap, NOT a demonstrated product failure.

## What is added

At390x844, open the actual mounted Commerce panel, read28.00, fill29 and click
its existing Save once. Assert canonical stored regular minor2900, reload/reopen
and read29.00. On native, refresh the already-paid synthetic order and verify
API order, persisted order AND payment still2800. All prior desktop choices,
price/availability, stale-form refusal, billing/contact and frozen-order assertions
remain. The title no longer promises a bulk form that does not exist.

The host can close the phone sheet around a panel action. Durable readback uses
reload/reopen after verifying storage; it does NOT resubmit the write or assert
sheet/focus continuity. No SDK fix, cause attribution, hidden DOM workaround,
mutation retry, weakened assertion or timeout increase. The existing180s test
and120s host bounds remain.

## Fresh source checks

Finished **2026-10-30 00:29:59UTC**, Node24.22.0/Linux x64:

- **835/835 unit/workflow +110/110 integration**, no failures/skips.
- Builds/typecheck/repo+feature audit/ledger/actual changeset check/diff/clean and
  unchanged app/CLI/lock/host/helper/main-config comparisons passed.
- Full edited spec: **native-variant2/2 (2.0m)** and **sandbox2/2
  (2.2m)**, no retries, fresh source02 DBs; all original assertions.
- Backend **130676 bytes /396 headroom**, cap131072 unchanged,
  SHA256 **a630ca239b3573cd5943cb430fb8e26702c946ba6d7c38438fcc86ac01c98f92**,
  dist/extracted equal to accepted main. Test coverage consumes ZERO runtime bytes.

The manifest binds source files, local harness identity and three reviewed
unchanged admin PNGs: parent2a native phone baseline; source native/sandbox phone
readback29.00. Captures use only synthetic products/Dev Admin fixture state.
No raw DB/logs/request-response/merchant-details JSON/cookies/capabilities/traces
or shopper checkout screenshots published. Digests establish identity, not signed
attestation, correctness or approval.

## Diagnostic harness / reproduction

On a machine able to start the default three hosts, normal direct commands work:

```sh
npm run build
npx playwright test tests/sandbox/variant-checkout.spec.mjs --project=native-variant
npx playwright test tests/sandbox/variant-checkout.spec.mjs --project=sandbox
```

Our constrained synthetic host ran one existing project AND matching host at a
time using an **ignored local proof config**, independent of #218. Effective
config equality was asserted for both baseline lanes; only config-location path
normalization is added. Tests, flags, ports, isolated DBs, viewport, timeouts,
worker1 and reuseExistingServer:false remain unchanged. This is not a canonical
full-gate run or a new package configuration/API. To reproduce that harness, save
this as `.tmp/phone-current.playwright.config.mjs`:

```js
// Local proof harness only: select one existing host/project, never a full gate.
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import baseline from '../playwright.config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const profile = process.env.COMMERCE_PHONE_PROFILE;
if (!['sandbox', 'native-variant'].includes(profile)) throw new Error('select a phone-proof profile');
const index = baseline.projects.findIndex(project => project.name === profile);
if (index < 0 || !baseline.webServer[index]) throw new Error('missing matching baseline host');
export default defineConfig({
  ...baseline,
  testDir: resolve(root, 'tests/sandbox'),
  projects: [baseline.projects[index]],
  webServer: [{ ...baseline.webServer[index], cwd: resolve(root, baseline.webServer[index].cwd) }],
});
```

Then, sequentially, with working pinned dependencies/native bindings/Chromium:

```sh
mkdir -p .tmp/astro-config
ASTRO_TELEMETRY_DISABLED=1 XDG_CONFIG_HOME="$PWD/.tmp/astro-config" \
  COMMERCE_PHONE_PROFILE=native-variant COMMERCE_PROOF_PORT=65025 \
  COMMERCE_PROOF_RUN="phone-native-$(date +%s)" \
  npx playwright test tests/sandbox/variant-checkout.spec.mjs \
    --config=.tmp/phone-current.playwright.config.mjs --project=native-variant
```

Repeat with sandbox, a fresh run ID, unused ports, and no parallel build/profile.
No browser replay after a proof-only final commit is inferred: final-head checks
and any accepted-main merges are separately recorded in the PR, binding unchanged
source test bytes. Historical baseline/source media is not relabelled as a later
head's execution.

## Boundaries

Real local TCP, mounted native/compiled local sandbox SDK/admin controls and
on-disk SQLite checks. Sandbox is NOT an official Registry installation; no fresh
Registry selector, installer/provenance-signature/full installed-upgrade proof.
Native Payments facade is synthetic/in-memory, not real processor settlement.
The proof site's legacy CMS Commerce-product field is an existing unused fixture
helper field, not the current link authority or a new setup recommendation.

**Phone-sized desktop Chromium/mouse, not device/touch/Safari** or a complete
independent mobile journey. No canonical storefront/core/full gate, other browser
files/settings/orders/consumer aggregate, actual Inventory/Ship/provider/channel,
security/performance/whole-release or combined-pending-feature qualification.
This does not prove whole-operation catalog atomicity. Lock remainsDOMPurify3.4.16;
repo contract audit is not dependency vulnerability clearance. No upstream merge,
publication, deployment, maintainer-store invocation or controller change.

## Reviewed synthetic captures

[Native parent baseline](native/baseline-phone.png) · [Native29.00](native/phone.png) · [Local sandbox29.00](sandbox/phone.png). These are source/parent captures, not later-head executions.
