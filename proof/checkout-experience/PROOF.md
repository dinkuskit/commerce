# Checkout orchestration proof

Candidate: `codex/checkout-experience`, based on
`51ab023b14490e3bff821e5310dd1c323092df30`.
Source identity:
`sha256:44948ab7d57614e6f6c11d9987250b80952b774eadf8b764aa36eca84cccb578`
(the SHA-256 of `source-manifest.sha256`). At local verification time no commit, push or PR had been performed.
Accepted decision history was preserved and updated only through GrillTrack CLI.

## Evidence

- Final `bin/verify-commerce full` under installed Node 22.23.1: typecheck,
  135 unit tests (including 13 checkout cases), public repository audit and
  feature audit passed. Integration: 18/20 passed; two pre-existing local D1
  checks received Wrangler internal-error responses rather than expected
  constraint errors. Targeted rerun of `tests/integration/d1-atomicity.test.mjs`
  passed all 3 cases. Thus all 20 integration cases have passing evidence,
  with the transient full-run failure retained, not omitted.
- An earlier full run under the same runtime passed all then-existing 19
  integration cases. The additional checkout integration also passed alone.
- The initially selected Node 24 application runtime refused the native
  better-sqlite3 module due to macOS code-signing Team ID mismatch. Rebuilding
  the dependency and running with the already-installed Node 22 resolved it;
  no repository dependency or package lock was changed.
- Checkout tests exercise authoritative regular/sale price, duplicate-line
  aggregation, complete managed basket, unmanaged Inventory isolation,
  shortage/outage, partial reservation and ambiguous commits, lost processor
  creation response, durable terminal creation fence, unknown settlement,
  expiry release and repriced retries, release failure recovery, identity/total/
  window mismatches, frozen payment binding and contradictory non-creation.
- Concurrent starts and independent processes using a real SQLite CAS aggregate
  with persisted fake provider operations converge on one hold and session.
  Fresh processes reconcile one durable order/receipt and preserve paid holds.
- A stale open lookup racing confirmed payment cannot overwrite the paid order.
  Duplicate/out-of-order event hints only trigger authoritative lookups.
- Exact EmDash `PluginStorageRepository` CAS, concurrent connection behavior,
  paid order/receipt persistence and connection reopen pass in
  `tests/integration/checkout-storage.test.mjs`.
- `git diff --check` and GrillTrack validation passed.

Raw run logs and sustained worker state remain under ignored
`.grilltrack/work/checkout-run/`: `final-verification.txt`, `d1-rerun.txt`,
`full-node22.txt`, `full-verification.txt`, `emdash-checkout.txt`,
`checkout-tests.txt`, `STATE.md`, `events.jsonl`, `heartbeat`, `PROOF.md`.

## Reproduction

Use Node 22.23.1 with a compatible better-sqlite3 build for the existing suite:

```sh
npm ci --ignore-scripts
npm rebuild better-sqlite3
bin/verify-commerce full
```

The isolated checkout harness requires no credentials or native addon:

```sh
npm run build
node --test tests/features/checkout/*.test.mjs
```

## Limits and handoff

This is a reviewed local contract/orchestration candidate, not a mounted
shopper experience or complete Stripe integration. Fake providers establish
Commerce behavior only. No actual Stripe test-mode proof, hosted Inventory
reservation, storefront UI evidence, merchant connection, real purchase,
shipping/tax implementation, deployment or package publication occurred.

Integration contract: `docs/implementation/checkout-experience.md`.
Local adjudication and official review gates: `REVIEW.md`. Formal review is pending. Draft PR publication is now explicitly authorized;
that authorization does not confer a clean review, merge or deployment approval. Real adapters must establish durable idempotency and terminal
outcome exclusion before any shopper route can be enabled.
