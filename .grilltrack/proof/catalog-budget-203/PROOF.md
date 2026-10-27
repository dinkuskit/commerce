# Commerce #203 — atomic catalog saves

## Result and source

The owner selected the Commerce-only storage repair on 2026-10-27. Price,
manual availability and submitted feed choices now share one product-record
compare-and-set. A weight form changes all submitted choice weights with one
compare-and-set. Refused writes leave the logical save unchanged. Stale forms
are refused. A completed write followed by a failed refresh says saved; a lost
write acknowledgement is reconciled once and otherwise reported as unknown.

Base: `e4da1218bc429d469442e5e6a807c7f46856e65b`.
See [the decision](../../../docs/decisions/catalog-atomic-saves.md) and
[artifact identity](artifact-identity.json). The candidate backend is
`662a95f7cd711bbee92454cec24530cd3d49ecb14a9a420243d57aa074ea0a27`,
130,993 bytes of the 131,072-byte Registry limit (79 bytes remaining).
The source fingerprint covers all TypeScript sources and named build inputs;
it can be recomputed from the checked-out commit. No host limit was raised.

## Verification

- Node 24.22.0; pinned EmDash and Cloudflare adapter 1.2.0.
- Typecheck, Registry build/size gate and repository/feature audits pass.
- All 701 unit tests pass on the candidate. The affected catalog/checkout
  suite has 172 passing tests, including fault, stale-form, clear, retry and
  fifty-choice cases.
- Integration suite: 104/105 passed in the concurrent run; the sole failure
  was workerd failing its 10-second startup deadline. The same shopper-account
  test passed in a serial retry. All 105 scenarios therefore have passing
  current-artifact evidence. The migration/reopen repair subset also passed
  all 88 cases.
- All 10 storefront/native browser tests pass, including real panel edits,
  stale forms, legacy-data editing and storage-failure recovery. Existing
  EmDash nested-form console warnings remain; the tested behavior passed.
- All 3 extracted Registry package tests pass. The independently installed
  native npm consumer passes exports, admin and foreign-origin checks.
- Settings validation is recorded in the PR checks and local run closeout.

The legacy assertions that read retired per-field storage were updated to
read the catalog authority. Concurrent-write tests now interfere at the single
product commit. No failure is converted into a passing test by skipping it.
A prior browser run found that its synthetic competing writer still updated
the retired price row; that injector was corrected and the full browser suite
rerun successfully.

## Real Cloudflare proof

[The sanitized results](live-results.json) bind the deployed backend to the
candidate hash. The test host loads the exact built candidate bytes on an
existing synthetic Registry installation, using the stock Cloudflare runner,
PluginBridge, real D1 and R2. The candidate is not a signed or published
Registry release. The 10-call run supplies no limits override; 32 overrides
only subrequests. CPU, outbound restrictions, authorization and collection
scoping remain stock. Independent host-side reads inspect committed records.

| Operation | Stock 10 | 32 | Persistence/recovery |
| --- | --- | --- | --- |
| Open product | pass | pass | unchanged |
| Price 10 to 12 dollars | pass | pass | 12 dollars; reopen agrees |
| Single weight 8 oz | pass | pass | 8 oz; reopen agrees |
| Two choice weights 4/6 oz | pass | pass | both weights together |
| Choice price 15 dollars | pass | pass | saved product data contains 15 dollars |
| Archive | pass | pass | archived |
| All 50 choice weights | pass | pass | all 50 stored and reopened |
| Same-revision concurrent prices | pass | — | one winner, one refusal |
| Price + stock status + feed choices | pass | — | all three stored together |

The identical 11-item fixture is reset before the main cases, with equality
of starting snapshots checked across budgets. The 50-choice case uses a
separate synthetic fixture. Repeated weight saves at 10 and then 32 all succeed
and retain both values. This is update-idempotence proof, not create-order or
create-product deduplication proof. Artifact identity is checked before and
after each main-matrix case. Raw evidence hashes are retained in the summary.

## Compatibility and limits

Legacy fields remain readable until saved into the new product value. Explicit
nulls prevent cleared legacy prices/weights from reappearing. Old rows are
retained without dual writes. Existing IDs, SKUs, Inventory ownership and
historic order snapshots are preserved. Older Commerce binaries must not run
concurrently or be installed as an unconverted downgrade. The reference
article and minor changeset document the direct-kernel reader argument change.

The Cloudflare proof is headless; it does not certify the complete remote
Astro login, browser middleware or normal discovery lifecycle. Separate local
browser and extracted-package tests cover their stated paths. No payments,
emails, customer data, production deployment, software release, resource
removal or permission change occurred. Only the dedicated synthetic test
Worker and its fixture rows changed; its private preview proxy is stopped.

## Review and media

Docs: up to date — the reference article changes in this PR, with release
placeholders intact. Native ClawSweeper and comprehensive OpenClaw review are
required against the PR's final base/head. Their published receipts and finding
adjudications belong to the PR and local closeout; this document does not claim
a review merely from submission.

Two selected synthetic screenshots were visually inspected: saved weight and
the explicit unknown-outcome panel. Their sizes/hashes are in
[artifact identity](artifact-identity.json). Retained media is linked from the
PR's immutable Dinkus PR Assets evidence release; no binary media is committed
here. Human merge remains the next promotion gate after clean checks/reviews.
