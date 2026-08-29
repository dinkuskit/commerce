# Retry-safe managed-SKU registration review

Result: repair verified locally; exact-head external re-review pending

Source identity:
`sha256:71fb97b4613ac8e39921c139bf92e50bebf0b0a32911064c0f3ca0d0397134d0`

Manifest: [`source-manifest.sha256`](source-manifest.sha256)

## Standards review

- The change remains inside `dinkus.inventory-provider`; it does not introduce
  brand, live-service, credential, or production configuration dependencies.
- Commerce still stores no stock quantity, receipt, or fallback inventory.
- New runtime input and stored-state shapes are normalized fail-closed.
- Provider extras are stripped from success and rejection results.
- Public exports are identical from the package root and feature entry.
- Existing managed-state compatibility and genuine-existing confirmation are
  preserved.
- Repository, feature, TypeScript, unit, and integration verifiers pass against
  the exact manifest.

## Source-intent review

- `registration-retry-identity-024`: the operation snapshot is awaited through
  `persist` before the provider call, survives normalization/reload, and the
  retry API resends its exact operation ID and request.
- `registration-retry-trigger-025`: only explicit start/retry functions invoke
  the provider; stored-state normalization makes no call and no scheduler or
  page-load behavior was added.
- `registration-definitive-rejection-026`: terminal rejection becomes
  setup-needs-attention; resubmission must use a different operation ID before
  any persistence or provider call.
- Registered results activate only a validated permanent Inventory identity.
  Existing results still require explicit confirmation. Malformed or wrong-SKU
  results cannot activate.

## Adjudication

ClawSweeper's exact-head review of
`f1c3645cd01e07bf1b05e6fabee7190d35024531` produced two findings.

- `required_fix`: accepted. The original runtime receipt proved orchestration
  only with an in-memory provider. `REAL_RUNTIME.txt` now proves the changed
  path with EmDash 0.35.0's real `PluginStorageRepository`, Inventory PR #12's
  exact durable SQLite implementation, full close/reopen, one automatic reload
  with zero provider calls, and explicit same-command replay to active state.
- `reject_false_positive`: the archive-removal request conflates an imported
  private ledger with GrillTrack's same-repository public lineage. The named
  archive was generated from already-public Commerce state by the required
  GrillTrack transition and supports the contract's source-priority ledger. It
  contains no prohibited private data or rationale, so deleting it would erase
  authoritative public product history without repairing a security boundary.

The persistence function remains an application seam, not a proven
cross-process compare-and-set adapter. That limitation is disclosed in the
contract and proof and remains the next recommended grill; this review does not
claim simultaneous first-submission atomicity, live Inventory network
transport, or admin UI fidelity.
