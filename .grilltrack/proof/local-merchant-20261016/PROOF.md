# Local merchant journey — 2026-10-16

Result: **PASS_LOCAL_FIXTURE twice**. The full hosted merchant contract remains
**UNVERIFIED**. This packet contains synthetic test data only.

Owner/lane: local-merchant-journey-20261016; test-harness writer, local mutate
mode. Closer: maintainer at review/human merge gate. No companion source changed.

Commerce base: `93af4fec2f33f43463d5917972cce574180446d1` (fresh origin/main).
Both acceptance runs used the clean committed harness revision
`54764d9b3f68efc80225f7a66237880efeb7e0f2`, branch
`codex/local-merchant-journey-20261016`. The later proof-only commit changes no
harness, assertions, plugin source or dependencies. Payments source:
`922e0de9d86ca935bdca852f44552c6c34c50203` in its own clean isolated checkout.

Command, run once to perform both executions:

```sh
npm run test:merchant:local -- --payments <isolated-payments-checkout-at-the-recorded-SHA>
```

Node22.23.2; EmDash1.2.0; Playwright1.61.1; Chromium149.0.7827.55;
workerd2026-08-26; sandbox SDK0.9.3. Commerce0.3.0-beta.0 and Payments0.2.8
ran as sandboxed descriptor builds in actual WorkerdSandboxRunner instances.
[Build identities and hashes](identities.json) and per-run loaded-bundle receipts
bind those claims. Commerce retained its existing custom build. Payments used
its supported build-time localhost `testOnly` configuration, with unchanged
implementation source; this is explicitly a fixture build profile.

| Run | UTC interval | Playwright | Observable result |
| --- | --- | --- | --- |
| [Run1](run1/PROOF.md) | 14:37:10–14:37:29 | 1 passed, zero retries | One USD12 paid fixture order, receipt, wake acknowledgment, matching Payments saved-order status |
| [Run2](run2/PROOF.md) | 14:37:29–14:37:49 | 1 passed, zero retries | Same assertions/builds, a new checkout attempt and independent order/store state |

The command creates fresh separate databases, media directories, host processes,
browser contexts, site/binding/connection/run/fixture/event IDs and checkout
attempts. Run2 is not a retry or a reused paid order. Both isolated databases
naturally assign local order number1001; their distinct attempt/receipt/site
identities are recorded in each observable-state.json. No hosted order was used.
The command validates loaded build hashes and refuses missing or reused terminal
journey evidence even if a test process were to exit zero.

The UI saves US merchant settings and a physical USD12 parcel, then performs
Payments connection/exchange and guest checkout. Before Commerce reconciliation,
Payments explicitly shows payment received but awaiting Commerce. After guest
status reconciliation, Commerce shows exactly one provider-paid TEST order in
Processing. Reopening preserves its receipt and does not duplicate it. A wake is
delivered through EmDash's exported hook pipeline; its acknowledgment makes the
same Payments status show Commerce saved the order. Anonymous requests to both
private admin routes are denied. Runtime assertions never import product
internals or repair database state. Bootstrap uses normal host index setup and
prepares initial synthetic checkout settings only.

Boundaries: issuer/authorization, Payments service and Stripe outcome are
synthetic. Plugin outbound HTTP terminates at the injected SDK fixture transport;
unexpected routes fail closed. Free shipping is configuration only. There is no
real Stripe/PB transaction, hosted Ship handoff, label, provider PDF, tracking,
email, deployed authentication, Registry install/update, practice-label or full
returning-merchant certification. The explicit hook delivery does not certify
timed/platform scheduling. Supported dev bypass is localhost development only.
The required next provider boundary is the same addressed paid order entering
hosted Ship and then PB sandbox label/PDF/tracking; that cannot be certified by
these local fixtures and needs its separately authorized hosted environment.

Validation: production build and registry bundle checks PASS (Commerce backend
117650bytes, 13422bytes below the 131072byte per-file cap); `npm run typecheck`,
`npm run audit:repo` and `git diff --check` PASS. These checks are source/build
proof, not runtime provider evidence. Development failures were preserved in the
ignored owner run root and fixed: host binary paths, consumed fixture body,
disposable encryption setup, configured-plugin index initialization, fixture
account-reference format, and current public response/Orders markup selectors.
None is counted as either acceptance run. No product implementation changed.

Six selected screenshots were visually inspected and published under one unique
[proof release](https://github.com/dinkuskit/dinkus-pr-assets/releases/tag/commerce-local-merchant-20261016-54764d9).
[Media manifest](media.json) records immutable URLs, source head, sizes, SHA256,
provenance and redaction assessment. Raw databases, credentials, sessions, traces,
HAR, browser storage and authenticated raw logs are omitted. Local fixture PNGs
need no redaction; all identities/addresses are generated test fixtures.

Retention owner: this local test lane/maintainer; preserve evidence for at least
14days from2026-10-16. No automatic deletion or cleanup. Review/merge status is
reported in the PR; source/proof preparation grants no merge/deploy authority.
