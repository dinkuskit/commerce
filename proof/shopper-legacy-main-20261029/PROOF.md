# Keep historical contact from poisoning new shopper defaults

## Source and relevance

Source **b75fe5a2297f211e963a33a194661b117944a527**, parent/current accepted main
**4e4ca758bb28edee691a948353c046e1a2357faf** (includes billing213 and settings215).
This is a new standalone selection/adaptation of frozen9801909's repair, not its
old DOMPurify/settings stack. No dependency, manifest, schema, auth, OTP, checkout
eligibility, shipping/provider or billing change. Existing orderFacts/billTo/
owner corrections remain intact. Original branches/proofs remain preserved.

Orders deliberately accepts kept contact objects that modern new-order admission
rejects. This is current supported compatibility, not a proposed new malformed
input path: **853f9a674eed518e39cc41b8a4186b1b07a4f899** introduced the kept-versus-
new admission distinction so older objects still list rather than making Orders
unavailable; the current reader retains it.

A concrete source producer also exists. The first Orders receiver at
**8823272c92a619463effbb4d339a910f1810e921** (2026-10-10) accepts these contact
objects and stores them through its actual `createPaidOrderReceiver`. The probe
executes that unmodified source with its pinned paid-order-schema module, using
real EmDash SQLite repositories. It does **not** claim an official old Registry
release or first-party checkout ever generated these exact contacts, an affected
production store, or a complete installed-store upgrade. Relevance is the
explicit kept-record compatibility contract plus a historical accepted writer.

## Reproduction and repair

Before repair, a valid verified-email sign-in seeds the new customer record from
an admitted historical order with a blank phone or incomplete delivery. Sign-in
succeeds, but the very next profile GET returns `UNAVAILABLE`: the saved customer
record fails its own reader's validation.

`projectShopperOrder` now normalizes phone and effective delivery **independently**
with existing contact normalizers. Invalid/missing fields project as null; usable
fields normalize, and the existing seeder can select an older usable field. The
phone check uses the same placeholder-email pattern as profile edits rather than
coupling phone validity to historical email formatting. Verified-email filtering,
owner-correction precedence, stored/cleared defaults and paid snapshots are not
changed. The shared address normalizer is structural here: current checkout
shipping countries or new US-region eligibility are not applied retroactively.

**This only prevents new invalid seeds. Already malformed customer records remain
fail-closed and are not repaired, migrated or overwritten.** A separate owner-
reviewed recovery scope would be needed for existing poisoned profiles. Neither
a paid snapshot nor a delivery correction is rewritten.

## Fresh evidence (Node24.22.0/Linuxx64, own synthetic host)

| Phase | Result |
| --- | --- |
| Current parent4e + selected customer regressions |18 tests:10pass/8fail, expected exit1, no skips |
| Parent compiled-workerd account module |4 tests:2pass/2fail, expected exit1, no skips |
| Historical source writer -> current native SDK/SQLite -> account handlers, before |2/2 expected counterexamples: old writer stored, current kept reader admitted, sign-in succeeded, next profile UNAVAILABLE |
| Repaired source canonical unit/workflow |**833/833**, no failures/skips |
| Repaired source canonical integration |**112/112**, no failures/skips |
| Historical writer/current account probe, after |**2/2** profile reads now succeed, modern receiver still refuses invalid new inputs, kept rows unchanged |
| Source builds/typecheck/repository audit/ledger/diff/clean/artifact gates |Passed **2026-10-29T22:11:56Z** |

Baseline suites completed22:01:44UTC; negative exits were asserted as reproduction,
not labelled passing qualifications. The customer regression set covers blank,
wrong-type, oversized and noncanonical contact, bad sibling independence,
corrected delivery, older usable fallback, repeat reads and durable explicit
clears. An additional control keeps already corrupt saved customer records
unavailable rather than silently repairing them. The workerd suite uses the
compiled backend and actual EmDash SQLite repositories. Two new cases reproduce
unreadable next-profile state in the parent; four total cases pass after repair.

`legacy-writer-probe.mjs` complements the workerd fixtures with actual historical
producer provenance, not direct raw-row insertion. It bundles exactly two pinned
same-repository runtime source modules (store and schema; type-only imports erase),
then executes the historical receiver against native EmDash SQLite repositories
and the current account handlers. `before.json`/`after.json` contain only reviewed
synthetic outcome flags, not sessions, codes, raw records or logs. Its isolated
temporary databases are closed and removed; cleanup failures propagate.

Native handler calls in that diagnostic do not establish an HTTP/Registry
installation. Compiled workerd cases seed known historical records as fixtures;
they are not running an old plugin installer. Authentication uses an injected
synthetic email sink/code, not real SMTP. No Payments charge, real checkout,
Inventory, browser/mobile or full-release qualification. No mutation retry,
forced suite exit, weakened assertion, hidden cleanup failure or fresh security
clearance. Builds and suites were sequential and exited naturally.

## Standalone budget and final-head scope

Source backend **130729bytes /343headroom**, cap131072, SHA256
`e84273302ff37c769af1d73310b0ed1e1fbd245acec0e7186739e2ef8807735f`.
Parent backend130676/396, so this measured slice adds53bytes. Dist/extracted
backend equality passed. This supersedes only the old standalone applicability
question, not its historical failed-over-cap evidence, and does not qualify any
other combined proposal.

The manifest binds sourceb75's code and completed gates. Final proof-only head
qualification is reported separately in the PR; this report's presence is not a
claim that a subsequent head already passed. No open216 SIGINT delta is included.

## Reproduce

Use full public Commerce history (or fetch the two pinned historical commits),
Node24.22.0 and project dependencies. In a disposable current-parent checkout,
select only the two test files from sourceb75, build, then run each test command;
expect customer10pass/8fail and runtime2pass/2fail with exit1. The actual baseline
ran exactly that setup. The probe itself is standalone proof material:

```sh
npm run build
node proof/shopper-legacy-main-20261029/legacy-writer-probe.mjs before
# At repaired source/qualified submission:
node proof/shopper-legacy-main-20261029/legacy-writer-probe.mjs after
node --test tests/features/customers/shopper-accounts.test.mjs
node --test tests/integration/shopper-accounts-runtime-cases.mjs
npm test
npm run test:integration
npm run typecheck
npm run audit:repo
./scripts/grilltrack --project . validate
```

The before mode must run against the unchanged parent build with the selected
probe/tests, not repaired dist. No implicit downloads, arbitrary source execution
or installed-release/provenance claims: the probe only reads its named public
same-repository commit with Git and imports the two reviewed bundled modules.
