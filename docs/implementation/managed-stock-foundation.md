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

The later provider-neutral registration contract advances that foundation with
two identity-bearing states:

```ts
type ManagedStockManagement =
  | { mode: "managed"; status: "setup-required" }
  | {
      mode: "managed";
      status: "needs-review";
      candidate: InventorySkuIdentity;
    }
  | {
      mode: "managed";
      status: "active";
      inventorySkuId: string;
    };
```

An active managed item therefore cannot exist without its permanent Inventory
SKU identity. See [managed-sku-registration-contract.md](managed-sku-registration-contract.md)
for the registration and existing-SKU confirmation transitions.

## Store binding value

The public provider-neutral value contains exactly:

- `providerRef`
- `poolId`
- `defaultFulfillmentLocationId`

These are opaque non-empty identities. Normalization returns only those three
fields, so credentials, quantities, or unrelated provider payload cannot enter
the normalized Commerce binding value through this contract.

## Deferred integration

These foundation slices do not render the Configure Inventory UI, persist the
store binding, call an Inventory service, discover pools, register an actual
Inventory record, read or mutate stock, implement checkout or order states,
choose a reservation duration, or perform fulfillment and shipping work. Those
behaviors depend on later, separately verified adapters and do not change this
product-state contract.
