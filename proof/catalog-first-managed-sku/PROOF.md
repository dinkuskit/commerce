# First managed SKU pilot proof

## Source identity

- Base: `c35f611909309dd8d461d99c1d28c563a90d1a0a`
- EmDash: exact `0.35.0`
- Runtime packaging: exact `emdash@0.35.0` peer; publishable implementation
  code is limited to `dist/` alongside npm's package metadata, README, and
  license files
- Node.js verification runtime: exact `22.23.2`
- Local D1 verifier: exact Wrangler `4.127.0`
- Reviewed implementation inventory: `proof/catalog-first-managed-sku/source-manifest.sha256`

The source manifest covers the implementation, tests, repository contracts, dependency lock, and CI definition. It excludes this explanatory proof document and GrillTrack's decision ledger so review evidence can evolve without changing the reviewed implementation identity.

## Claims proved

- `dinkus.catalog` owns the first catalog-item creation boundary. The scoped npm package `@dinkuskit/commerce` exports the EmDash 0.35 native descriptor plus `createPlugin` runtime factory, registers with the EmDash-safe runtime slug `dinkus-commerce`, and exposes one private route requiring `content:create`.
- SKU input is trimmed, Unicode NFKC-normalized, uppercased from ASCII, and accepted only as 1-64 uppercase alphanumeric segments separated by single hyphens.
- One accepted command writes one complete draft simple-product row. The live-constraint guard uses internal sentinel writes, but it does not create a SKU registry or split the user item across multiple writes.
- The `catalogItems` row carries both unique `commandId` and unique site-wide `skuKey` values.
- Same-command/same-normalized-payload retries return the original row; changed input returns `COMMAND_CONFLICT`.
- Two independent server processes claiming the same SKU produce one row, one success, and one `SKU_CONFLICT`.
- If either declared unique index is absent, or a storage error cannot be bound to the exact expected unique index, product creation fails closed before the product row is written.
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

The exact Node runtime completed installation with zero audit vulnerabilities. The full verifier passed typechecking, 18 unit/contract tests, both repository audits, the two local Wrangler/D1 process proof, both real EmDash 0.35 missing-index cases, the two-process competing-SKU proof, and the two-process idempotent-retry proof.

`npm pack --dry-run --json` reported 27 entries, 8,169 packed bytes, and no
bundled dependencies. The archive contains only compiled `dist/` output plus
`package.json`, `README.md`, and `LICENSE`; source, tests, proof, and local
fixtures are excluded.

The first GitHub Actions run exposed a harness-only `SQLITE_BUSY` race between
the two Wrangler CLI processes. The bounded retry repair preserved both
independent processes and tightened the terminal assertion to require one
success and one exact `skuKey` unique-index failure.

## Gates and exclusions

This proof does not authorize or claim package publication, plugin activation,
deployment, production mutation, merge, or a Commerce-to-Inventory call.
Commit, push, and pull-request delivery were authorized separately after this
local result was verified. Price, currency, stock policy, provider binding,
update/delete, admin UI, MCP exposure, checkout, and publication remain outside
this slice.
