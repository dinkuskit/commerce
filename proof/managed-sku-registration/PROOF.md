# Managed-SKU registration proof

## Scope

This proof covers GrillTrack decisions:

- `managed-sku-pool-registration-020`
- `managed-sku-stable-identity-021`
- `managed-sku-display-name-022`

The verified slice is a provider-neutral Commerce contract and pure state
machine. It does not claim a live DinkusKit Inventory registration, transport,
stock read, stock mutation, admin UI, or deployed runtime.

Commerce baseline: `efd4832aac20080bd983028ad9dd4b2220e2ad9b`.

Inventory reference baseline (read only):
`e32ac165cae5efd78390bee1f0306754aa7fabbb`. That source accepts opaque
`skuId` values for its existing stock operations and intentionally has no SKU
registration API yet.

## Architecture result

- Commerce sends only `poolId`, its canonical `sku`, and
  `displayNameIfNew`.
- A non-blank Commerce Product Title supplies the one-time new-record display
  name. Missing or blank title falls back to the SKU.
- Registration has no location, quantity, balance, unit, receipt, or mutation.
- A new Inventory SKU becomes active with only its permanent opaque
  `inventorySkuId` persisted in Commerce state.
- An existing pooled SKU enters `needs-review` with a normalized candidate.
  Explicit confirmation is required before its permanent identity becomes
  active.
- A wrong-SKU response or out-of-order transition fails closed.
- Provider extras are discarded by result normalization.
- Disabling Manage Stock discards the Commerce link only; re-enabling returns
  to `setup-required`.

The full boundary and type signatures are in
`docs/implementation/managed-sku-registration-contract.md`.

## TDD receipt

Baseline before source changes:

```text
CI=1 mise x node@22.23.2 -- bin/verify-commerce quick
29 tests passed; public_repository_contract=clean; feature_contract=clean
```

Red command:

```text
mise x node@22.23.2 -- node --test \
  tests/features/inventory-provider/inventory-provider.test.mjs \
  tests/features/inventory-provider/public-entry.test.mjs \
  tests/features/catalog/catalog.test.mjs
```

Observed red result: exit `1`. The new test module failed to instantiate with:

```text
SyntaxError: The requested module
'../../../dist/features/inventory-provider/index.js' does not provide an
export named 'ManagedSkuRegistrationError'
```

This was the expected missing-contract failure before implementation.

Focused green result after the minimal implementation:

```text
25 tests passed; 0 failed
```

## Verification receipt

Command:

```text
CI=1 mise x node@22.23.2 -- bin/verify-commerce full
```

Result: exit `0`.

- TypeScript typecheck passed.
- Unit suite: 35 passed, 0 failed.
- Public repository contract: clean.
- Feature boundary contract: clean.
- Integration suite: 7 assertions passed, 0 failed.
- Exact EmDash 0.35 storage still persists managed `setup-required` state
  without a local quantity.
- Two-process SQLite SKU conflict and idempotent replay proofs still pass.
- Two local Wrangler/D1 processes still enforce the EmDash JSON-expression SKU
  index.

Manifest command:

```text
sha256sum -c proof/managed-sku-registration/source-manifest.sha256
```

The manifest covers every changed implementation, test, and product-document
file in this slice. GrillTrack projection/event files and this proof are
excluded because they are durable workflow evidence rather than reviewed
runtime source.

Immutable reviewed-source identity:
`sha256:4292f3e2743809cfa81867292a49a0a5f43a283ad51f29294c3a686ba8f05725`.

## Blast radius

| Surface | Risk | Evidence and regression proof |
| --- | --- | --- |
| Persisted `StockManagement` union | High | `active` now requires `inventorySkuId`; catalog advanced-state replay fixture passes |
| Package root and feature entry | Medium | export-parity test passes for every new runtime function |
| Catalog creation | Medium | unchanged unmanaged and `setup-required` creation tests pass |
| Inventory adapter boundary | High, deferred | type-only `InventoryProviderPort`; no network implementation or compatibility claim |
| DinkusKit Inventory and SmokyClub | None in this slice | no source changes and no existing checked-out caller of the new symbols |

## Fidelity limits and remaining risk

This proves the Commerce contract, input/output normalization, and state
transitions only. It does not prove that Inventory can atomically create or
return the pool-wide SKU record. Inventory must implement that operation before
Commerce can run a cross-repository handshake.

The `needs-review` candidate deliberately contains no copied stock amount. A
future adapter/UI must obtain Inventory's current stock read, present it to the
user, and revalidate it immediately before calling the explicit confirmation
transition. Commerce remains fail-closed until that work exists.

No commit, push, pull request, merge, deployment, package publication, account
change, or production mutation was performed for this slice.
