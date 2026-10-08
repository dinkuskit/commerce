# Review re-proof for the catalog identity slice

The five locked `catalog-product-*-058` decisions are recorded in the GrillTrack
ledger. The maintainer approved their initial direct recording. A later repair
moved the external Template issue from internal dependencies to context using
GrillTrack's validated writer, preserving all decisions and appending an event.
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

## Browser/migration comparison and backend size

The [matched installed proof](../../.grilltrack/proof/catalog-identity-pr62-finish/PROOF.md)
uses the repository-pinned Node 22.23.2, npm 10.9.8, identical locked dependencies,
physical dependency trees, the same fixture and fresh disposable databases.
Both main at `e5a9189` and the candidate runtime at `e45e9bd` pass the build and
installed coupon browser scenario, including migration, conflicts, reload and
forbidden actions. The ledger/docs repair does not change runtime or test sources.

The extracted backend measures 128,497 bytes on main and 129,476 on the
candidate (+979 bytes), below the 131,072-byte cap with 1,596 bytes remaining.
The prior 128,485-byte artifact is historical, not the matched baseline.

The earlier local comparison used Node 22.14.0 and a main dependency layout
that rebuilt to 210,216 bytes, stopping before migration. That pair could not
establish whether the candidate migration failure was pre-existing. Node's
`statement.columns()` API was added in 22.16.0, above that old runtime; the
repository-pinned pair now completes migration successfully on both revisions.

## Page-proof boundary

The duplicate, unpublish, and republish tests use a serialized in-memory
`Map` stand-in. They prove the documented host contract's deterministic
behavior only. They do not prove real Template Store publication enforcement;
that belongs to the explicit host resolver work in template-store #34.
