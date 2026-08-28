# Managed-SKU persisted-state compatibility repair proof

## Scope and decision

This repair addresses the two accepted exact-head ClawSweeper findings on
Commerce PR #9 and implements GrillTrack decision
`legacy-managed-state-upgrade-023`:

- preserve valid identity-bearing managed state on read;
- downgrade legacy or malformed managed state that cannot satisfy the current
  contract to `managed` / `setup-required`; and
- reject malformed `needs-review` candidates before activation.

This is an on-read fail-safe compatibility path. It does not invent an
Inventory identity, mutate Inventory, write a migration, deploy, or merge.

Baseline before repair:
`8198a59524f384cdd69a6de0b0e9e22801edaae0`.

## TDD receipt

The regressions were added before implementation and executed with:

```text
mise x node@22.23.2 -- node --test \
  tests/features/inventory-provider/inventory-provider.test.mjs \
  tests/features/catalog/catalog.test.mjs
```

Observed red result: exit `1`; 24 passed and 2 failed.

- A legacy `{ mode: "managed", status: "active" }` replay remained active
  instead of returning `setup-required`.
- Confirming a missing review candidate threw an untyped `TypeError` instead
  of the public `ManagedSkuRegistrationError` with
  `INVALID_REGISTRATION`.

After the minimal implementation and feature-boundary-preserving export, the
same focused command passed 26 tests with 0 failures.

## Implementation

- The inventory-provider feature normalizes stored stock-management values.
- Valid unmanaged, setup-required, needs-review, and identity-bearing active
  states are retained with normalized identity strings.
- Invalid managed values return `setup-required`; absent pre-policy state keeps
  the existing unmanaged default.
- Explicit existing-SKU confirmation reuses the strict identity normalizer and
  cannot produce active state from malformed input.
- Catalog reads call the inventory-provider public entry rather than bypassing
  the feature boundary.

## Full verification

Command:

```text
CI=1 mise x node@22.23.2 -- bin/verify-commerce full
```

Result: exit `0`.

- TypeScript typecheck passed.
- Unit and contract suite: 37 passed, 0 failed.
- Public repository contract: clean.
- Feature boundary contract: clean.
- Integration suite: 7 assertions passed, 0 failed.
- Exact EmDash 0.35 managed setup persistence still passes.
- Cross-process SQLite and Wrangler/D1 uniqueness proof remains green.

Built public-entry runtime proof:
`proof/managed-sku-registration/COMPATIBILITY_REPAIR_RUNTIME.txt`.

- bytes: `2275`
- SHA-256:
  `012f8bcece3e0fcb8963d443ff3672cbac8dec6f1d69482b05d9ce8f848b9481`
- valid identity-bearing active state stayed active;
- legacy identity-less active state returned `setup-required`; and
- malformed confirmation returned typed `INVALID_REGISTRATION`.

The repair source manifest is
`proof/managed-sku-registration/compatibility-repair-source-manifest.sha256`.
Its SHA-256 source identity is
`7c7e7170c8c86cfe02c0aa815ba86d2a1da55546507edc4787786de8df12b14e`.
The local standards and source-intent review is retained in
`COMPATIBILITY_REPAIR_REVIEW.md`. Independent Git-head review follows the
repair commit.

## Remaining boundary

This proves Commerce's local persisted-state compatibility behavior. Live
Inventory transport, current-stock revalidation, admin UI, and a write-back
migration remain outside this repair.
