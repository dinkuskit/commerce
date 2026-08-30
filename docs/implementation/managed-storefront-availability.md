# Managed storefront availability

This slice is the Commerce backend contract between one active managed catalog
item, its configured Inventory provider, and a customer-facing storefront. It
does not add a visual admin screen, public HTTP route, live cross-plugin
transport, cart reservation, order enforcement, or storefront rendering.

## Commerce policy

Commerce persists one store-wide display policy in the dedicated
`storefrontAvailabilitySettings` collection:

```ts
type StorefrontAvailabilityDisplayPolicy =
  | { mode: "status" }
  | { mode: "exact" }
  | { mode: "threshold"; threshold: number };
```

`status` is the new-store and legacy-record default. `threshold` requires a
positive integer. The authenticated `settings/storefront-availability` action
changes only this singleton policy record.

Each product may have one record in the dedicated `catalogBackorderPolicies`
collection. A missing record means `allowBackorders: false`; opting in writes
the explicit boolean policy. The authenticated `catalog-items/set-backorders`
action accepts only the catalog item ID and the new boolean value.

These policies do not rewrite the catalog item or store Inventory binding.
That isolation prevents a display or backorder setting from overwriting a
simultaneous SKU-setup transition or fulfillment-location update.

## Inventory read boundary

`InventoryAvailabilityProviderPort.readSkuStock` mirrors DinkusKit Inventory's
versioned `dinkuskit.inventory.sku-stock-read-result/v1` query. Commerce always
supplies:

```ts
{
  poolId: configuration.binding.poolId,
  skuId: item.stockManagement.inventorySkuId,
  scope: {
    kind: "location",
    locationId: configuration.binding.defaultFulfillmentLocationId,
  },
}
```

Commerce never requests the all-locations aggregate for storefront
availability. Stock at another location must be transferred into the store's
default fulfillment location before it can make the product sellable.

The adapter boundary is aligned to DinkusKit Inventory commit
`86da623e0a21f174636cd833f8faf932ba219721`. Commerce does not depend on the
Inventory package or embed transport, service discovery, credentials, or a
second stock ledger.

## Structured result

`resolveManagedStorefrontAvailability` returns
`dinkuskit.commerce.storefront-availability-result/v1`:

```ts
type StorefrontAvailabilityResult = {
  schema: "dinkuskit.commerce.storefront-availability-result/v1";
  catalogItemId: string;
  status:
    | "in-stock"
    | "low-stock"
    | "out-of-stock"
    | "available-on-backorder"
    | "availability-unavailable";
  sellable: boolean;
  displayQuantity?: { value: string; unit: string };
};
```

The resolver uses Inventory's exact `available` quantity:

| Condition | Status | Sellable | Quantity exposed |
| --- | --- | --- | --- |
| Positive, status mode | `in-stock` | yes | no |
| Positive, exact mode | `in-stock` | yes | yes |
| Positive, threshold mode at or below threshold | `low-stock` | yes | yes |
| Positive, threshold mode above threshold | `in-stock` | yes | no |
| Zero or negative, backorders disabled | `out-of-stock` | no | no |
| Zero or negative, backorders enabled | `available-on-backorder` | yes | no |

Blocks or a storefront translates these structured facts into customer-facing
wording. It does not recalculate status or decide whether a hidden quantity may
be exposed.

## Fail-closed behavior

A managed product returns `availability-unavailable` with `sellable: false`
when its setup is not active, its store configuration is absent or invalid,
the provider cannot be resolved or read, the configured SKU or location is not
found, or the provider result is malformed or does not match the requested
pool, SKU, and location. Backorder permission never overrides this state.

An unmanaged product is outside this resolver and receives
`MANAGE_STOCK_REQUIRED`. Manual unmanaged sellability remains a later Commerce
slice.
