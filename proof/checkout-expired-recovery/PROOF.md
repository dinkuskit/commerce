# Recovered expired session repair

Accepted P2 at PR #29 candidate `e60674e02fd8eab4112f51162624ad7e34254c82`,
based on `51ab023b14490e3bff821e5310dd1c323092df30`.
Repair candidate source identity: `sha256:b671164c5804c65e9dab2690953a8f9909b6367a429385145e81eef9e870151c` (SHA-256 of the adjacent
`source-manifest.sha256`). Branch: `codex/checkout-experience`.

## Finding and disposition

Disposition: **required_fix — repaired and locally verified**. After ambiguous
payment-session creation at time 1000, recovery first observes an open session
at time 2801, past its original expiry at 2800. Previously the local-deadline
return discarded the validated session before CAS. A later contradictory
`not-created` could then bypass the known-session guard and release inventory.

The fix moves redirect suppression after a successful CAS. The original
session identity and deadline are stored first; the returned expired session
is omitted. CAS conflicts re-read current state, preserving the existing paid
short-circuit. A local deadline never authorizes release.

## Regression-first evidence

Added `a recovered expired open session persists so restart cannot release on
contradictory not-created` beside the existing known-session protection test.

- Before source modification, the targeted test exited 1: persisted session
  was `undefined` instead of the processor's original session.
  See [failing output](regression-before.txt).
- After the bounded fix, the same test exited 0. It confirms no actionable
  expired session is returned, the original session ID/createdAt/expiry persist,
  a fresh SQLite storage connection retains them, contradictory non-creation
  rejects with the known-session error, phase stays paying, stock stays reserved
  and releaseCalls stays zero. See [passing output](regression-after.txt).
- Focused checkout suite: **14/14 pass**; typecheck and exact EmDash checkout
  storage integration pass.
- Parent independently ran `bin/verify-commerce full` under Node 22.23.1:
  **136 unit and 20 integration tests pass**, typecheck and public repository/
  feature audits pass, command exit 0. All existing tests are preserved.
- Source diff and source-manifest checks passed. GrillTrack changes use its CLI
  only; the accepted product decisions and prior history are preserved.

The contradictory provider response intentionally violates the payment contract
and exercises Commerce's explicit fail-closed guard. These are synthetic
provider/storage checks, not Stripe integration or storefront UI evidence.

## Reproduction

With Node 22 and a compatible better-sqlite3 build:

```sh
npm run build
node --test --test-name-pattern 'recovered expired open session persists' tests/features/checkout/checkout.test.mjs
bin/verify-commerce full
```

## Integration and review boundaries

Formal review remains pending with its assigned trigger owner; this repair
neither dispatches another review nor claims official clean status. Real
Registry/Inventory/Payments adapter work remains outside this repair.

The independent native-continuity branch also changes `.grilltrack/ledger.json`,
`.grilltrack/events.jsonl`, `FEATURE_MAP.md`, `package.json`, and `src/index.ts`.
These are known composition overlaps for one coordinated integration owner.
No merge was attempted and no ledger/event history was manually merged.

Operational command receipts and ACP completion/cleanup proof stay in the
ignored checkout repair run. No private operating artifacts were imported.
