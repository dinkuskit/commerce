# Managed-SKU persisted-state compatibility repair review

## Review identity

Reviewed source identity:
`sha256:7c7e7170c8c86cfe02c0aa815ba86d2a1da55546507edc4787786de8df12b14e`.

This is the SHA-256 of
`proof/managed-sku-registration/compatibility-repair-source-manifest.sha256`.
Every entry passed `sha256sum -c` after full verification.

## Finding adjudication

The exact-head ClawSweeper findings were accepted as `required_fix`:

- identity-less pre-release active records lacked an explicit upgrade path;
- untyped malformed review candidates could bypass the identity-bearing active
  invariant.

The maintainer-directed repair uses ClawSweeper's recommended safe downgrade:
valid identity-bearing state remains valid; managed persisted state that cannot
satisfy the contract returns `setup-required`; malformed confirmation input is
rejected.

## Standards review

Result: clean.

- Storage normalization remains owned by `dinkus.inventory-provider`.
- Catalog reaches it only through the feature's public entry.
- The package root and feature export remain identical and typed.
- No quantity, location balance, credential, network client, provider fallback,
  dependency, or deployment surface was added.
- Public repository and feature-boundary audits pass.
- Typecheck, 37 unit/contract tests, 7 integration assertions, source-manifest
  verification, ledger validation, and `git diff --check` pass.

## Source-intent review

Result: clean.

- Commerce never invents an Inventory SKU identity.
- Valid active and review state is preserved.
- Legacy identity-less active state becomes `setup-required` on read.
- Other malformed managed state also fails safe to `setup-required`.
- Direct confirmation independently validates the complete candidate before
  returning active state.
- Existing pre-policy records with no stock-management field keep their
  established unmanaged compatibility behavior.
- No live Inventory mutation or write-back migration is claimed.

No remaining `required_fix`, rejected false positive, deferral, or human gate
exists inside this bounded repair. Merge remains a separate human gate.
