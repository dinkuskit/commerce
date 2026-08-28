# First managed SKU pilot proof

## Source identity

- Base: `c35f611909309dd8d461d99c1d28c563a90d1a0a`
- EmDash API peer: exact `0.35.0`
- Mounted-site pilot runtime: private pilot backed by the public
  [`saariuslystoned/emdash`](https://github.com/saariuslystoned/emdash) fork at
  exact commit `dbf11d1138dbd5c6e4e00195e9c99b0904c90799`, tracked by [upstream
  PR #2768](https://github.com/emdash-cms/emdash/pull/2768)
- Runtime packaging: exact `emdash@0.35.0` peer; publishable implementation
  code is limited to `dist/` alongside npm's package metadata, README, and
  license files
- Node.js verification runtime: exact `22.23.2`
- Local D1 verifier: exact Wrangler `4.127.0`
- Reviewed implementation inventory: `proof/catalog-first-managed-sku/source-manifest.sha256`

The source manifest covers the implementation, tests, repository contracts, dependency lock, and CI definition. It excludes this explanatory proof document and GrillTrack's decision ledger so review evidence can evolve without changing the reviewed implementation identity.

The API peer and mounted-site runtime are intentionally separate. The public
package contract remains exact `emdash@0.35.0`; the private pilot additionally
pins the public fork source identity above. Stock 0.35.0 cannot materialize the
declared storage indexes through the mounted Cloudflare development runtime,
so it is unsupported for live pilot writes and Commerce fails closed. A future
stable EmDash release must be repinned and pass a fresh SmokyClub mounted-site
proof before this restriction can be removed.

## Claims proved

- `dinkus.catalog` owns the first catalog-item creation boundary. The scoped npm package `@dinkuskit/commerce` exports the EmDash 0.35 native descriptor plus `createPlugin` runtime factory, registers with the EmDash-safe runtime slug `dinkus-commerce`, and exposes one private route requiring `content:create`.
- SKU input is trimmed, Unicode NFKC-normalized, uppercased from ASCII, and accepted only as 1-64 uppercase alphanumeric segments separated by single hyphens.
- One accepted command writes one complete draft simple-product row. The live-constraint guard uses invocation-owned internal sentinel writes and removes every attempted sentinel on success and failure paths; it does not create a SKU registry or split the user item across multiple writes.
- The `catalogItems` row carries both unique `commandId` and unique site-wide `skuKey` values.
- Same-command/same-normalized-payload retries return the original row; changed input returns `COMMAND_CONFLICT`.
- Two independent server processes claiming the same SKU produce one catalog record, one success, one `SKU_CONFLICT`, and no integrity-probe residue.
- If either declared unique index is absent, a probe cannot be cleaned up, or a storage error cannot be bound to the exact expected unique index, product creation fails closed before the product row is written. Missing-index paths leave no probe records behind.
- Local Wrangler/D1 reproduces the exact EmDash JSON-expression SKU index violation, and the application classifier recognizes that observed failure as `skuKey` authority.
- The D1 process harness retries only transient `SQLITE_BUSY` emulator
  contention. A terminal losing contender must still name the exact SKU unique
  index; a busy lock is never accepted as atomicity proof.
- The feature map, import boundary audit, public-repository audit, quick/full verifier, pinned Node runtime, and read-only CI workflow form a deterministic conductor-compatible entry point.

## Commands and results

```text
mise x node@22.23.2 -- npm ci
mise x node@22.23.2 -- bin/verify-commerce full
npm ls emdash wrangler typescript better-sqlite3 kysely --depth=0
git diff --check
```

The exact Node runtime completed installation with zero audit vulnerabilities. The full verifier passed typechecking, 19 unit/contract tests, both repository audits, the two-local-process Wrangler/D1 proof, both real EmDash 0.35 missing-index cases, the two-process competing-SKU proof, and the two-process idempotent-retry proof. The EmDash SQLite proofs inspect all raw catalog records rather than filtering out integrity probes.

After the full verifier, the exact SQLite integration file passed five
additional consecutive runs. Every run retained exactly one raw catalog record
for both the competing-SKU and idempotent-replay races.

`npm pack --dry-run --json` reported 27 entries, 8,927 packed bytes, and no
bundled dependencies. The archive contains only compiled `dist/` output plus
`package.json`, `README.md`, and `LICENSE`; source, tests, proof, and local
fixtures are excluded.

The first GitHub Actions run exposed a harness-only `SQLITE_BUSY` race between
the two Wrangler CLI processes. The bounded retry repair preserved both
independent processes and tightened the terminal assertion to require one
success and one exact `skuKey` unique-index failure.

ClawSweeper then identified that the successful integrity checks retained each
left sentinel. The repair began with failing raw-storage assertions, assigns a
fresh identity to each probe invocation so concurrent servers cannot clean up
one another's records, deletes every owned attempted probe in a `finally` path,
and fails closed if cleanup itself errors.

## Inspectable live runtime transcript

This post-repair run used the installed `emdash@0.35.0`
`PluginStorageRepository`, a real SQLite database, and two independent Node.js
server processes. The emitted records contain aggregate outcomes only: no
credentials, customer data, persistent identifiers, or temporary paths.

```text
$ CI=1 mise x node@22.23.2 -- npm run build --silent && CI=1 mise x node@22.23.2 -- node --test --test-reporter=spec tests/integration/sqlite-atomicity.test.mjs
▶ exact EmDash 0.35 storage fails closed when either declared unique index is not live
  ✔ only commandId is active
  ✔ only skuKey is active
✔ exact EmDash 0.35 storage fails closed when either declared unique index is not live
LIVE_PROOF {"case":"competing-sku","emdash":"0.35.0","processes":2,"created":1,"rejected":1,"rejectionCode":"SKU_CONFLICT","persistedRecords":1,"persistedRows":1}
✔ two server processes claiming one SKU produce one row and one SKU_CONFLICT
LIVE_PROOF {"case":"idempotent-replay","emdash":"0.35.0","processes":2,"created":1,"replayed":1,"sameItem":true,"persistedRecords":1,"persistedRows":1}
✔ two server processes retrying one command converge on the original row
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

The first live record proves one successful creation plus one competing-SKU
rejection, with exactly one raw persisted record and one catalog item. The
second proves that one creation and one same-command replay converge on exactly
one raw persisted record and one catalog item. Because the raw count equals the
catalog-item count in both cases, neither race leaves an integrity probe behind.
The public CI job runs this same verifier on the exact pull-request head,
providing the linked independent transcript for review.

## Gates and exclusions

This proof does not authorize or claim package publication, plugin activation,
deployment, production mutation, merge, or a Commerce-to-Inventory call.
Commit, push, and pull-request delivery were authorized separately after this
local result was verified. Price, currency, stock policy, provider binding,
update/delete, admin UI, MCP exposure, checkout, and publication remain outside
this slice.

The private pilot's public fork pin is an explicit maintainer acceptance of the
compatibility gate raised on Commerce PR #7. It does not claim that stock
`emdash@0.35.0` is mounted-site compatible, and it does not authorize weakening
package-manager dependency guards to consume preview packages. The local
SmokyClub proof is kept in its own worktree and is not delivered by this
Commerce PR.
