# Persisted Manage Stock toggle exact-source review

## Review identity

Reviewed source manifest:
`proof/manage-stock-toggle/source-manifest.sha256`.

Immutable source identity:
`sha256:c9a03e9dc27f76ab2a2b073664febf9f1d0d4b9656dd427c0cf69bf75c06b700`.

The manifest was verified with `sha256sum -c` before the independent review
and after final full verification. Its file list exactly matches all changed
runtime source, tests, verifier, feature map, and product documentation after
excluding GrillTrack and proof artifacts.

## Independent review

Result: clean; no required code finding.

The read-only reviewer inspected the exact diff against `origin/main`, checked
the new private route and collection wiring, strict input and permission
boundary, enable/disable transitions, revision increment, reconstructable claim
release, Configure Inventory persist re-read, isolated manual availability and
backorder records, public exports, tests, documentation, and proof manifest.
Focused catalog and inventory-setup suites passed and every manifest entry
verified. `CI=1 bin/verify-commerce full` passed 97 unit tests and 19
integration tests.

## Standards review

Result: clean; no open findings.

- The new private action remains non-public, POST-only, and protected by
  `content:edit_any`.
- Input accepts only server-resolved catalog item ID and a boolean
  `manageStock`.
- `creationIntent.manageStock` is not rewritten.
- Toggle writes are limited to catalog `stockManagement` and
  `manageStockRevision`, plus reconstructable claim deletes on disable.
- Manual availability, managed backorder policy, and store binding are not
  rewritten by the toggle.
- Configure Inventory persist re-reads the catalog row and refuses unmanaged
  or revision-changed state before putting registration progress.
- No credential, customer data, provider transport, fallback stock ledger, or
  production mutation was introduced.
- Typecheck, unit and integration suites, repository and feature audits,
  manifest verification, and `git diff --check` are clean.
- EmDash 0.40.1 pin and mounted-site fork contract are unchanged.

## Source-intent review

Result: clean; all four locked decisions are represented.

- Authenticated `catalog-items/set-manage-stock` persists the choice after
  create.
- Enable writes `setup-required`, increments revision, and does not auto-run
  Configure Inventory.
- Disable writes unmanaged with no Inventory mutation, restores dormant manual
  availability, and releases reconstructable registration claims.
- Configure Inventory cannot resurrect a concurrent disable or disable-then-enable.

## Deferred boundary

Visual EmDash UI, template-store catch-up, live Inventory transport, cart,
checkout, payments, npm publish, and EmDash PR 2768 remain outside this slice.
Merge remains a human gate.
