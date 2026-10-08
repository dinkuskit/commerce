# Product/variant architecture decision proof

Decision `product-variant-model-20261008` is **locked**, not implemented.
Base: `938cb06cc6c0a1e7f457e514076d608219e38c65`.
Branch: `codex/commerce-product-model-decision-20261008`.

## Recording and preservation

Read current AGENTS/CHARTER and the active same-repository ledger. Created a fresh
isolated branch from fetched origin/main. Used the installed GrillTrack CLI:
resume, focus, propose, lock, confirm, pause; then resume, recommend, pause.
`validate` returns `valid`. No direct ledger/event edits or script changes.
All 50 prior decisions compare equal to the base; the original event bytes are
an exact prefix of the updated append-only log. The new 51st decision has
implementation/verification refs null. Dependencies are existing permanent-item
and host-page-boundary decisions. No unresolved issue33 policy was locked.

The CLI rejected an unsupported activation string and a recommendation attempted
while paused; successful recording used the supported transitions, with no
hand-edit bypass. No reconciliation or history deletion was required.

## Verification

Repository-pinned Node 22.23.2 / npm 10.9.8; unchanged npm lockfile.
`npm ci --include=optional` and `bin/verify-commerce full` exited 0.
Full gate: 333 unit/workflow tests, 39 integration tests, sandbox/native 6 tests,
native-local-stock 1 test, installed coupons 1 test; typecheck, sandbox build,
repository/feature audits pass. Terminal marker: `verify-commerce: full passed`.
These are existing local/synthetic runtime profiles, not new variant/tool behavior
or live provider/Registry authority evidence.
Full-output SHA-256: `69617f46a07054f240b0a6417f263aef11d0fc3a19ae5a79682adcee94870c61`.
`git diff --check` passed; final audit and ledger validation rerun after doc edits.

## Two-axis owner review

Immutable reviewed content-set identity: `sha256:906c0d679c9b05c46660de35e3d4762daef79da9317d84c289bb1fc49d62234f`.
It hashes sorted compact JSON mapping the three content paths below to SHA-256.

- `.grilltrack/ledger.json`: `f1aea06e377e3cb20d870f28dbdc8784295dad269df5cbecdbb2f8e770b69393`
- `.grilltrack/events.jsonl`: `d53381c52ec817dc1577a5a36f25f56460f2743803f5d001c34ca59f224ee5da`
- `docs/contracts/product-variant-model.md`: `d5e776fce911b9341504873ecb9467e52ef2dc223b2051278864db5e7f0d6dd5`

Standards inspection: focused public-safe docs/CLI lineage only; source,
dependencies, AGENTS, scripts and unrelated worktrees are unchanged.
Source-intent inspection: exact five-point lock; stable itemId/editable SKU,
independent fulfillment, shared authority and explicit deferrals preserved.
The tool foundation is conditional on a real consumer and narrow catalog path
release; typed/exported readers are already present. It does not enforce host
publication, create a storefront/Registry endpoint or implement a protocol.
No required fixes found. This is owner review, not an independent/native review
claim. Forge review remains advisory and merge remains the maintainer gate.

## Handoff limits

Only decision/document/proof work is delivered. Real identity migration/defaults,
fulfillment inheritance/mixed behavior and variant price/stock semantics remain
future decisions. Product-model confirmation does not complete issue33.
The coordinator may route the bounded catalog tool contract only after confirming
its consumer and the existing Grok reservation's narrow path release. Bootstrap63,
Template34 and Inventory ownership remain intact. No merge, release or deploy.
