# Managed-stock foundation proof

## Source identity

- Base: `d186dc13b517832c8838d5f2dba570dc4ef0380e`
- EmDash API peer: exact `0.35.0`
- Node.js verification runtime: exact `22.23.2`
- Wrangler verification runtime: exact `4.127.0`
- Reviewed source inventory: `proof/managed-stock-foundation/source-manifest.sha256`
- Durable product decisions: `.grilltrack/ledger.json` and append-only
  `.grilltrack/events.jsonl`, delivered in the same pull request

The source manifest covers the complete implementation and test closure for
this slice. It excludes this explanatory proof and the GrillTrack files so
review evidence and decision history can be appended without changing the
reviewed implementation identity.

## Claims proved

- Catalog creation accepts an optional boolean `manageStock`. Omission is
  backward-compatible and persists an explicit `unmanaged` policy. Explicit
  `null`, `undefined`, and non-boolean values reject before storage.
- `manageStock: true` persists `managed` / `setup-required` in EmDash's real
  0.35 storage repository without a quantity or fallback stock counter.
- A catalog record retains immutable `creationIntent.manageStock` separately
  from mutable stock status. The original create command still replays after a
  managed product advances to `active`; changing the original intent conflicts.
- Existing pre-policy records replay as explicitly unmanaged without rewriting
  the stored catalog item.
- The public provider-neutral binding value retains only `providerRef`,
  `poolId`, and `defaultFulfillmentLocationId`. Missing or blank identities are
  rejected, and unrelated credential or quantity fields are discarded.
- Disabling management returns only the Commerce product to unmanaged state.
  It cannot mutate Inventory. Re-enabling enters fresh `setup-required` state.
- Package-root and feature-specific exports expose the same contracts, and the
  feature audit rejects cross-feature imports that bypass a public entry.
- Existing EmDash unique-index, competing-SKU, and idempotent-command proofs
  remain green.

## Blast-radius report

| Surface | Risk | Evidence |
| --- | --- | --- |
| `CreateCatalogItemInput` | Medium, additive public input | Omitted input remains unmanaged; non-boolean input rejects |
| `CatalogItemRecord` and route response | High, persisted public JSON | Real EmDash storage test, legacy-row replay, immutable-intent replay |
| `@dinkuskit/commerce/features/inventory-provider` | Medium, new public export | Root/feature export parity and package dry run |
| SmokyClub mounted pilot | Medium, pinned external consumer | Plugin descriptor and route names are unchanged; its request omits `manageStock` and its response checks are additive `toMatchObject` assertions |
| Inventory service | None in this slice | No network client, command, credential, quantity, or provider I/O exists |

Repository/workspace search found one internal route caller and one mounted
SmokyClub package consumer. The SmokyClub worktree remains pinned to its prior
packed proof artifact and was not mutated by this PR.

## Verification

```text
mise x node@22.23.2 -- npm ci
mise x node@22.23.2 -- npm rebuild better-sqlite3
CI=1 mise x node@22.23.2 -- bin/verify-commerce full
mise x node@22.23.2 -- npm pack --dry-run --json
mise x node@22.23.2 -- npm ls emdash wrangler typescript better-sqlite3 kysely --depth=0
git diff --check
```

The full verifier passed:

- 29 unit, public-contract, workflow, and repository tests;
- both feature and public-repository audits;
- 7 integration assertions against EmDash SQLite and local Wrangler/D1;
- managed setup-state persistence with no local quantity;
- missing-index fail-closed behavior;
- one winner for two processes claiming the same SKU; and
- one durable row for two processes retrying the same command.

The redacted runtime transcript at
`proof/managed-stock-foundation/live-runtime.txt` records the actual output of
the exact EmDash 0.35 `PluginStorageRepository` persistence path using only
synthetic data. It shows one durable managed record in `setup-required` state,
the immutable managed creation intent, and the absence of both quantity fields.

The first full invocation exposed only a local native-module mismatch because
the machine-wide Node 26 had installed `better-sqlite3` before verification
switched to the repository's pinned Node 22.23.2. Rebuilding that ignored
dependency under Node 22 fixed the environment; the unchanged source then
passed the complete verifier.

The package dry run reported 42 entries, 10,916 packed bytes, no bundled
dependencies, compiled output for both feature entries, and no source, tests,
proof, GrillTrack data, credentials, or local runtime files.

## Gates and exclusions

This proof does not claim or authorize package publication, deployment,
plugin activation, a new mounted-site result, production mutation, or merge.
It does not render the Configure Inventory prompt, persist a store binding,
call Inventory, discover pools, reconcile SKUs, implement checkout or order
states, choose a reservation duration, or perform fulfillment and shipping.

The complete GrillTrack ledger and event history are intentionally included in
the pull request so merger places the accepted decisions on `main`; they are
not left only in the originating Codex task.
