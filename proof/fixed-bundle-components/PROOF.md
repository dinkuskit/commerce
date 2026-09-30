# Fixed bundle component snapshot proof

NONBLOCKING Commerce v1. This proof covers the exported/unmounted fulfillment
projection only. It does not prove a shopper sale, order write, Inventory
reservation, or provider success.

## Decision statuses

| ID | Status | Scope |
| --- | --- | --- |
| `fixed-bundle-shape-001` | DEFERRED | Selling delivery. Choice and history preserved. Authoritative bundle catalog, set price, and order+provider adoption are still missing. |
| `fixed-bundle-nonblocking-002` | verified | Boundary only: this lane does not gate Commerce v1. |
| `fixed-bundle-component-snapshot-003` | verified | Module only: detached fulfillment projection. |

Marking the shape goal verified would claim more than this component-only
slice. The required lifecycle/proof correction is accepted: the full selling
goal is deferred. Component projection remains verified separately.

Base: `git:8a04c0b16b381b89531c88d1a655aad6c0c461c3` (`main`).
Source identity: `sha256:160c8c513770cc2e04054ce14ed6c95e20304c3e9e2a67bae480ed46d25c1e79`
(SHA-256 of `proof/fixed-bundle-components/source-manifest.sha256`).
The manifest hashes the module, public docs, shared composition entries, and
tests. GrillTrack ledger/event state and this proof directory are excluded to
avoid a circular hash. The source identity is unchanged; this correction is
lifecycle/proof scope only.

At local verification time no commit, push, PR, merge, or formal review
dispatch had been performed.

## Source closure

| Path | Role |
| --- | --- |
| `src/features/fixed-bundles/{types,errors,project,index}.ts` | Public projection API |
| `docs/implementation/fixed-bundle-components.md` | Contract, trusted-caller boundary, deferred adoption seam |
| `src/index.ts` | Root `export *` only; `createPlugin` unchanged |
| `package.json` | `./features/fixed-bundles` export + unit glob only |
| `FEATURE_MAP.md` | Feature row + public boundary |
| `tests/features/fixed-bundles/*.test.mjs` | Public built-feature behavior |

Native `./admin`, `./sandbox`, `./descriptor`, sandbox build, lockfile,
dependencies, checkout, catalog, Inventory, payments, and template files were
not edited.

## Evidence

Runtime: Node `v22.23.1` from
`/Users/bobbybones/.local/share/mise/installs/node/22.23.1/bin`.
Dependencies installed in this worktree with `npm ci --ignore-scripts`
(exit `0`). Lockfile unchanged. `better-sqlite3` was not rebuilt; no check
required the native addon.

| Command | Exit | Result |
| --- | --- | --- |
| `npm run build` | `0` | TypeScript emit + sandbox plugin build |
| `npx tsc --noEmit` | `0` | clean |
| `node --test tests/features/fixed-bundles/*.test.mjs` | `0` | 9 passed, 0 failed |
| `npm run test:unit` | `0` | 155 passed, 0 failed |
| `npm run audit:repo` | `0` | `public_repository_contract=clean`; `feature_contract=clean` |
| GrillTrack `validate` | `0` | `valid` |

Focused tests cover: canonical catalog IDs/SKU/name/quantities; scale for
multiple bundle units; membership and order fidelity including repeated
lines; snapshot stability after catalog/definition mutation and JSON
roundtrip; missing/mismatched/internal-record refusal; non-positive, unsafe,
and multiply-overflow quantities; no Inventory or price fields on the
snapshot.

Raw command transcripts remain under ignored
`.grilltrack/work/fixed-bundles-20260930/worker/`. Lifecycle-correction
receipts are under
`.grilltrack/work/fixed-bundles-20260930/worker/lifecycle-correction/`.

## Limits

This module reads catalog identity/SKU/name and multiplies fulfillment
quantities. It does not price, declare sellability, contact Inventory,
reserve or release, own stock, or create orders. Catalog still has only
`simple-product`. Checkout/order still lack a component snapshot. Inventory-off
is unchanged.

Fixed-bundle SKU representation, authoritative Commerce-owned set price, and
the order freeze/provider adoption seam remain the required next interface.
This slice does not supply that selling delivery.

## Author adjudication

Author review against the unchanged source identity above. This is not an
independent or formal review, and no review dispatch was made.

The accepted lifecycle/proof finding is that verifying `fixed-bundle-shape-001`
as a completed selling goal overclaimed a component-only slice. That finding
is classified `required_fix` against the original source identity and proof
ref. The selling goal is then deferred; source, tests, and docs were not
changed.

| Finding | Classification | Resulting state |
| --- | --- | --- |
| Verifying the full shape/selling goal overclaimed this component-only slice | `required_fix` | `fixed-bundle-shape-001` deferred |
| Catalog still has no bundle kind or Commerce-owned set-price record | `defer` | remains outside this slice |
| Checkout/order still do not freeze this snapshot beside a commercial line | `defer` | remains outside this slice |
| Managed combined-basket reservation via the existing Inventory port is not adopted | `defer` | remains outside this slice |
| Runtime mount, draft publication, and merge remain parent-owned | `human_gate` | parent-owned |

Rejected findings: none. Independent/formal review is not claimed.

## Reproduction

```sh
export PATH="/Users/bobbybones/.local/share/mise/installs/node/22.23.1/bin:$PATH"
npm ci --ignore-scripts
npm run build
npx tsc --noEmit
node --test tests/features/fixed-bundles/*.test.mjs
npm run test:unit
npm run audit:repo
sha256sum -c proof/fixed-bundle-components/source-manifest.sha256
```
