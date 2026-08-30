# Unmanaged product sellability exact-source review

## Review identity

Reviewed source manifest:
`proof/unmanaged-product-sellability/source-manifest.sha256`.

Immutable source identity:
`sha256:dd8da6adba088acd8faafc05d6d2768dd35019eb596bda8947d7d37f38853d37`.

The manifest was verified with `sha256sum -c` before the independent review
and after final full verification. Its file list exactly matches all changed
runtime source, tests, verifier, feature map, and product documentation after
excluding GrillTrack and proof artifacts.

## Independent review

Result: clean; no required code finding.

The read-only reviewer inspected the exact diff against `origin/main`, checked
the collection and route registration, strict input and permission boundary,
legacy default, managed/unmanaged dispatch, dormant-state behavior, public
exports, tests, documentation, and proof manifest. Focused catalog and
storefront suites passed and every manifest entry verified.

The reviewer's default Node 26 shell could not load the reused Node 22
`better-sqlite3` binary. This was an environment mismatch, not a source
finding. The repository's exact Node 22.23.2 command passed the focused real
storage proof and the complete 18-test integration suite.

## Standards review

Result: clean; no open findings.

- The new private action remains non-public, POST-only, and protected by
  `content:edit_any`.
- Input accepts only server-resolved catalog item ID and one of three supported
  manual statuses. A managed catalog state returns conflict before any manual
  write.
- Manual status is isolated from the catalog row, Inventory binding,
  registration state, and managed backorder policy.
- Missing state is the deliberate compatibility default; corrupt or
  unavailable state fails closed.
- The unified resolver loads the catalog item once and selects one authority.
  Unmanaged resolution cannot contact Inventory or expose quantity; managed
  resolution cannot read or fall back to manual status.
- The prior managed-only public resolver remains exported with its original
  behavior.
- No credential, customer data, provider transport, fallback stock ledger, or
  production mutation was introduced.
- Typecheck, unit and integration suites, repository and feature audits,
  manifest verification, and `git diff --check` are clean.

## Source-intent review

Result: clean; all five locked decisions are represented.

- Manual status is exactly In stock, Out of stock, or Available on backorder.
- New and legacy products default to In stock.
- A saved manual value remains dormant while managed and returns after
  disabling management; Inventory state is never copied.
- Manual mutation is rejected while Manage Stock is enabled. The distinct
  managed backorder policy remains untouched.
- Unmanaged output is status-only even when the store uses exact or threshold
  display for managed products.

## Deferred boundary

There is no persisted Manage Stock toggle action in the current repository.
The pure transition and unified resolver prove dormant-state restoration, but
a future authenticated toggle must define cross-record concurrency before it
can claim live mutation proof. That work is outside this slice and does not
weaken the shipped authority boundary: manual state is never consulted while
the catalog item is managed.
