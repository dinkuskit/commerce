# Proof: sandbox bundle size reduction (commerce)

First non-empty changeset under the release process merged in #108; this
PR is the bounded dry-run vehicle for the first `ci: release` PR. It is
also required headroom work: the Registry backend was nearly full.

- Repository: `dinkuskit/commerce`
- Worktree: `~/Developer/worktrees/dinkuskit-commerce-bundle-size-20261013`
- Branch: `codex/commerce-bundle-size-20261013`
- Base: `origin/main` at `075e54873afb26163dddaab3d75d4735bb8b1fc9`
- Node: v22.23.1

## Baseline and result (official packager, scripts/check-registry-bundle.mjs)

Registry per-file limit: 131,072 bytes (`backend.js`).

| Build | backend_bytes | headroom_bytes | backend_sha256 |
| --- | ---: | ---: | --- |
| Base `075e548` | 130,990 | 82 | `cb61336de27ccf6fd6176a10be717b3f31b68ae7524f0710c82539a3c56c33d9` |
| This PR | 114,334 | 16,738 | `8605b0b1daafb8cbed451599c2e532ca2601bb64b235a9b167bcb6fc954f19fa` |

Delta: −16,656 bytes (−12.7%). Two consecutive builds produced the
identical sha256 (deterministic).

## Change

`scripts/share-literals.mjs` already hoisted repeated string literals
and object keys into shared bindings that the packager's minifier then
renames. It now also records frequent member-access names
(`obj.someLongName`, `obj?.someLongName`) and rewrites them to computed
access through the same bindings (`obj[binding]`, `obj?.[binding]`)
when the existing profitability estimate is positive. Property names
are never mangled by minifiers, so repeated names such as
`catalogItemId` (84 accesses) and `revision` (69) previously paid full
price at every use. Estimated upper bound before implementing was
about 12 KB on the final backend; the measured saving is larger
because shared bindings also shorten uses that were previously just
under the profitability bar.

Semantics: dot and computed access are identical for identifier-named
properties, including optional chains, method-call `this`, compound
assignment, increment, and `delete`. Private names are a different AST
node kind and are never rewritten; `__proto__` stays excluded; import
and export declarations remain untouched. One deliberate fail-closed
edge: an access whose dot cannot be located in the source text is
skipped rather than rewritten.

## Alternatives measured and rejected

- Rolldown `inlineConst: true` made the prebundle larger
  (146,452 -> 147,369 bytes); `treeshake.moduleSideEffects: false`
  changed nothing (everything in the graph is genuinely referenced).
- Consolidating the three copy-pasted unique-index probe
  implementations also lost: two of the three copies
  (inventory-provider claim storage, inventory-setup store
  configuration) are not reachable from the sandbox entry at all, so
  sharing saved 1,679 rendered bytes in the catalog copy while the
  shared module cost 2,879 (final backend grew to 131,224 and failed
  validation). Reverted; recorded here so it is not retried blindly.

## Commands and results

- `npm run build` — `registry_bundle=pass backend_bytes=114334
  headroom_bytes=16738` (twice, identical sha256).
- `node --test tests/build-literal-sharing.test.mjs` — 5 pass,
  including a new member-access equivalence test (method `this`,
  optional chains, assignment, `delete`, private field untouched),
  evaluated with `node:vm` against the untransformed source.
- `npm test` — 551 pass, 0 fail.
- `npm run audit:repo` — clean. `npm run typecheck` — clean.
- `bin/verify-commerce core` — passed locally (packaged Registry and
  native consumer paths), same gate CI runs as `public-contract`.

## Human gates honored

No merge, tag, publish, or workflow dispatch was performed. Merging
this PR is the separately approved step that should make the release
bot open the first `ci: release` PR (0.2.1); merging that release PR
is the publish action and needs its own approval plus the first-run
workflow-connection approval in the release dashboard.
