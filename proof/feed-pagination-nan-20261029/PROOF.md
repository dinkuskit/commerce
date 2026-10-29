# Reject non-progressing NaN feed page sizes

## Scope

Source/test commit: `29c20de47290ff942f734fa35124aed72a1e15a6`.
Independent parent: upstream `04dcf5e1ef296cc9ca8d719a11fec731d6961660`.
This branch does not stack any of the other published repairs.

`pageProductFeedRows` is a pure host-side export. Its existing page-size clamp
bounds ordinary numbers, but `Math.min/max` propagate `NaN`. `Array.slice`
then converts the end index to zero. A nonterminal request returns no rows
and a continuation cursor equal to its input cursor. A caller following that
cursor can loop without progressing. Empty/exhausted input silently returns
an empty terminal page for the same invalid size.

The locked `feeds-generation-serving-060` decision already requires bounded
pure host-side paging; this is an argument-validation repair, not a new paging
protocol or product decision. No ledger lock is reopened.

## Reproduction

The original compiled helper produced this bounded three-call observation
with three input rows and numeric `pageSize: NaN`:

```text
cursor=0  rows=0  nextCursor=0
cursor=0  rows=0  nextCursor=0
cursor=0  rows=0  nextCursor=0
```

The same result occurs at a nonzero nonterminal cursor and for
`Number.parseInt("not-a-page-size", 10)`. Both are JavaScript numeric `NaN`
values. No infinite loop or large workload is needed to reproduce it.

The new regression file uses fully formed synthetic `ProductFeedFacts`, not
malformed rows. On a fresh parent build:

```sh
node --test tests/features/feeds/feed-pagination.test.mjs
# 18 tests: 13 pass / 5 fail; exit 1; no skips
```

The five failures cover invalid sizes with empty input, an initial page, a
continuation, a terminal cursor, and a cursor beyond the input. Assertions
require `RangeError("invalid feed page size")`; the original never threw it.

To repeat the before/after comparison, copy that regression file from the
source commit into a separate checkout of the parent, install its locked
dependencies and build before running it. Do not reuse a repaired `dist` for
the baseline. The same command on this repair passes **18/18**.

## Repair and compatibility controls

One runtime line rejects a computed `NaN` page size before slicing, after the
existing cursor validation. It does not silently substitute a different size.
Type comments, implementation documentation, the website reference and a patch
changeset document the error and distinguish this numeric array offset from
the separate opaque `catalog/public` cursor.

The control matrix traverses 503 ordered rows using frozen input arrays,
records and options. It checks row counts, exact order and original object
references, strictly advancing continuation cursors, complete coverage without
duplicates, and termination. Preserved behavior includes:

- Default page size **100**, lower bound **1**, upper bound **500**.
- Zero/negative sizes clamped to one, oversized sizes clamped to 500.
- Positive/negative infinity retaining their existing upper/lower clamping.
- Fractional sizes retaining `Array.slice` truncation.
- Empty/exhausted pages omitting `nextCursor`.
- Nonnegative safe-integer cursors; invalid cursors still raising
  `RangeError("invalid feed cursor")`.

No serializer output, feed eligibility, availability mapping, catalog read,
HTTP route, permission, storage declaration, or dependency changes. In
particular, the separate low-stock repair is not included in this branch.

## Verification

Node **24.22.0**, Linux x64, upstream package manifest and lockfile unchanged.

| Check | Result |
| --- | --- |
| New pagination regression/control file | **18/18 pass**, no skips |
| All feed feature tests, including public entry contracts | **37/37 pass**, no skips |
| Complete unit/workflow suite | **726/726 pass**, no skips |
| Complete SQLite/D1 integration suite | **106/106 pass**, no skips |
| Typecheck, repository/feature audits, ledger validation, diff check | **Pass** |

Commands (run sequentially):

```sh
npm test
npm run test:integration
npm run typecheck
npm run audit:repo
./scripts/grilltrack --project . validate
git diff --check
```

Both baseline and repaired builds produce the identical Registry backend:

```text
bytes:        131033
headroom:     39 bytes below 131072
SHA-256:      29e86beb6d40af0050ea8e2582113aa5dc65417d355c535ac765bab0ea1ecf68
```

The changed feed helper is not imported by `src/plugin.ts`; its validation
adds no Registry backend bytes. The separately compiled host-side
`dist/features/feeds/builder.js` after this repair has SHA-256
`99956220be40a17b8272fbfd3e5f29653a1c112851035f17298c873cc5516001`.

## Limits

This is a host configuration/programmatic-input correctness issue, **not a
demonstrated deployed denial-of-service vulnerability**. Repository call sites
found were tests and exports; no affected deployed host was established.
`NaN` is not a JSON numeric value. This does not change the public catalog's
HTTP pagination protocol or prove external Google/Meta ingestion compatibility.

All inputs are synthetic. No browser, deployed site, real provider, payment,
stock or shipping operation was used. No publication, release, merge or
production mutation occurred. Existing upstream dependency findings remain;
this branch keeps the original lock and is not security remediation.
