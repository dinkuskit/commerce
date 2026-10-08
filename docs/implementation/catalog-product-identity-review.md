# Review re-proof for the catalog identity slice

This note records the interim-review evidence without changing the GrillTrack
ledger. The GrillTrack CLI was not installed in the implementation
environment, so no ledger entry, event, or decision status was hand-authored.
The source decisions are the maintainer's
[identity/page-link decision](https://github.com/dinkuskit/commerce/issues/58#issuecomment-6059015959)
and [lookup/concurrency clarification](https://github.com/dinkuskit/commerce/issues/58#issuecomment-6059044194).

## Catalog regression

The failed candidate run
[37772027802](https://github.com/dinkuskit/commerce/actions/runs/37772027802)
reported:

```text
Plugin ... route catalog/public failed: Catalog unavailable
tests/sandbox/coupon-blocks.spec.mjs:198
TypeError: Cannot read properties of undefined (reading 'products')
```

The cause was confirmed in `readPublicCatalog`: the candidate validated
`row.id === item.itemId` before skipping non-catalog rows. The fix restores the
`recordKind === "catalog-item"` filter first. A unit regression now supplies an
integrity-probe row before a valid product, and the full unit suite exercises
that path.

The same repository workflow on current `main` succeeded in
[37712405344](https://github.com/dinkuskit/commerce/actions/runs/37712405344),
including the coupon browser test. This is retained CI evidence under the
workflow's pinned Node/dependency/browser setup.

## SKU-write safety

`setCatalogItemSku` now:

- proves both catalog unique indexes with the existing fail-closed integrity
  preflight;
- reads a versioned catalog row;
- updates with `compareAndSet`; and
- retries from the latest row after a revision conflict.

Tests cover missing unique indexes and a concurrent edit that changes both
stock-management state and another catalog field. The SKU update preserves
those changes rather than writing a stale full row.

The catalog row also retains the normalized creation payload separately from
the editable SKU fields. Create-command replay compares that immutable
snapshot, so a SKU-only different command is rejected both before and after a
SKU edit, while the original command still replays the existing item after
the edit. Unique-violation classification receives the trusted custom
collection and plugin namespace used by the preflight.

## Browser/migration comparison

The local comparison used the same Node `v22.14.0`, npm `10.9.7`,
`package-lock.json` SHA-256
`865ece395c6ead0ffa60825343780f12c5690d4e27fb38a48674659453705b1f`,
fixture, and command:

```text
COMMERCE_COUPON_INSTALLED_PROFILE=1 npm run test:sandbox:coupons
```

On candidate `b64585c`, the build produced a 129,266-byte backend and the
browser server reached the EmDash runtime, which reported:

```text
MigrationFailedError: Migration failed: statement.columns is not a function
```

The detached `main` checkout under the same local runtime and command rebuilt
to 210,216 bytes and stopped earlier at the official 131,072-byte bundle
validator, so it did not reach the browser migration stage. Therefore this
local pair does not support calling the migration error pre-existing. The
independent same-workflow main CI run above passed the coupon browser test
without that error; the candidate CI failure was the catalog regression
instead. Both outcomes are retained here rather than conflated.

## Backend-size reconciliation

Two prior main proofs report different official-build measurements:

- `128,485` bytes in `product-media-20261007/PROOF.md`;
- `128,497` bytes in `product-media-rebase-20261007/PROOF.md`.

They are retained as distinct measurements from their respective official
build records, not treated as interchangeable. The current local candidate
build under the reproducibility metadata above is `129,266 / 131,072` bytes.

## Page-proof boundary

The duplicate, unpublish, and republish tests use a serialized in-memory
`Map` stand-in. They prove the documented host contract's deterministic
behavior only. They do not prove real Template Store publication enforcement;
that belongs to the explicit host resolver work in template-store #34.
