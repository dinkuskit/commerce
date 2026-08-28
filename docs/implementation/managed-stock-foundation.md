# Managed-stock foundation

This slice implements the Commerce-owned state required before a live
DinkusKit Inventory adapter can be connected.

## Product state

Catalog creation accepts an optional boolean `manageStock`. Omission preserves
the pre-feature behavior as explicitly unmanaged. `true` persists:

```json
{
  "mode": "managed",
  "status": "setup-required"
}
```

The record contains no quantity. Commerce cannot authorize managed
availability until a later slice completes Inventory setup and SKU
reconciliation.

The record separately retains the normalized `creationIntent.manageStock`
value used by create-command idempotency. Later stock-status transitions do
not change that immutable creation input, so retrying the original create
command still returns the existing product after setup advances.

Disabling management returns only the Commerce product to `unmanaged`; it has
no Inventory side effect. Enabling it again after that transition creates a
fresh `setup-required` state. Enabling an already-managed product is
idempotent and preserves its current status.

## Store binding value

The public provider-neutral value contains exactly:

- `providerRef`
- `poolId`
- `defaultFulfillmentLocationId`

These are opaque non-empty identities. Normalization returns only those three
fields, so credentials, quantities, or unrelated provider payload cannot enter
the normalized Commerce binding value through this contract.

## Deferred integration

This slice does not render the Configure Inventory UI, persist the store
binding, call an Inventory service, discover pools, reconcile SKUs, reserve
stock, implement checkout or order states, choose a reservation duration, or
perform fulfillment and shipping work. Those behaviors depend on later,
separately verified adapters and do not change this product-state contract.
