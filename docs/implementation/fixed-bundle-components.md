# Fixed bundle component snapshot

NONBLOCKING Commerce v1. This slice exports an unmounted fulfillment
projection. It does not gate catalog, checkout, Inventory, payments, or a
shopper purchase.

Accepted decisions: `fixed-bundle-shape-001`, `fixed-bundle-nonblocking-002`,
`fixed-bundle-component-snapshot-003`.

The public entry is `@dinkuskit/commerce/features/fixed-bundles`. The package
root re-exports the same contract. `createPlugin` does not register routes,
storage, or admin for this module.

## Trusted caller boundary

A trusted server-side caller owns the definition. The definition is not a
shopper-chosen membership, not a browser cart payload, and not money.

This module:

- reads catalog identity, display SKU, and name through the catalog public
  read type `CatalogItemReadStorage`;
- multiplies component quantities for a purchased bundle count;
- returns a detached JSON-serializable fulfillment snapshot.

This module does not:

- price a bundle or its components;
- declare a bundle or component sellable;
- contact Inventory, reserve, release, or own stock;
- create or mutate checkout attempts, orders, or receipts;
- accept shopper-configurable or mix-and-match membership.

A passing projection is not proof that a bundle can be sold, fulfilled, or
reserved with a provider. Inventory-off remains the catalog default.

## Current catalog and checkout gap

On the current main catalog, `kind` is only `"simple-product"`. There is no
bundle catalog kind, no bundle parent record, and no component membership
stored on a catalog item.

Checkout `CommerceOrder` and `CheckoutLine` freeze product ID, name, quantity,
and unit price. They do not carry a component snapshot. This module does not
invent a bundle catalog representation or an order price policy that would
pretend a simple-product can already be sold as a bundle.

## Public API

```ts
import type { CatalogItemReadStorage } from "@dinkuskit/commerce/features/catalog";
import {
  projectFixedBundleFulfillment,
  type FixedBundleDefinition,
  type FixedBundleFulfillmentSnapshot,
} from "@dinkuskit/commerce/features/fixed-bundles";

const definition: FixedBundleDefinition = {
  definitionId: "def:starter-kit",
  components: [
    { catalogItemId: "item-tongs", quantityPerBundle: 1 },
    { catalogItemId: "item-cover", quantityPerBundle: 2 },
  ],
};

const snapshot: FixedBundleFulfillmentSnapshot =
  await projectFixedBundleFulfillment(definition, catalog, 3);
```

`catalog` is the existing catalog public read type (`CatalogItemReadStorage`,
`get` only). Callers supply already-trusted definition identity and component
lines. Component order is the definition order. Repeated component lines are
preserved. The function does not dedupe, nest, or treat a component as another
bundle.

### Definition

| Field | Meaning |
| --- | --- |
| `definitionId` | Trusted server-owned identity for this fixed set |
| `components[].catalogItemId` | Existing catalog item ID |
| `components[].quantityPerBundle` | Positive safe integer of that item per one bundle |

### Fulfillment snapshot

| Field | Meaning |
| --- | --- |
| `definitionId` | Copied definition identity |
| `purchasedBundleQuantity` | Positive safe integer of bundles purchased |
| `components[].catalogItemId` | Resolved catalog item ID |
| `components[].sku` | Display SKU copied from the catalog item at projection time |
| `components[].name` | Display name copied from the catalog item at projection time |
| `components[].quantityPerBundle` | Per-bundle quantity from the definition |
| `components[].totalQuantity` | `quantityPerBundle * purchasedBundleQuantity` |

The snapshot is a detached plain object. Later catalog or definition mutations
do not change a returned snapshot. `JSON.stringify` / `JSON.parse` round-trips
the same values. The snapshot does not copy stock quantities, provider
bindings, prices, or other catalog/provider records.

### Fail-closed errors

`FixedBundleError` uses these codes:

| Code | When |
| --- | --- |
| `INVALID_DEFINITION` | Missing/blank definition identity, empty components, or a bad component identity |
| `INVALID_QUANTITY` | Non-positive or unsafe `quantityPerBundle` or `purchasedBundleQuantity` |
| `QUANTITY_OVERFLOW` | Component total is not a safe integer |
| `CATALOG_ITEM_NOT_FOUND` | No catalog record for a component ID |
| `CATALOG_RECORD_MISMATCH` | Internal integrity-probe, non-item record, or stored `itemId` ≠ lookup key |
| `STORAGE_UNAVAILABLE` | Catalog `get` threw |

## Authoritative set price and order adoption are missing

Commerce already owns authoritative price on simple-products and checkout
already freezes a commercial order line. Neither surface can represent a
fixed bundle today:

- there is no catalog kind or price record for a predefined bundle set price;
- checkout does not freeze component membership beside an order line;
- checkout's Inventory port is still the future whole-basket reservation, and
  this module does not call it.

Fixed set price remains the existing Commerce price engine and checkout
owner. Component lines are fulfillment quantities, not separately charged
cart lines.

## Proposed future interface to the sole checkout owner

No implementation here. When checkout adopts this slice, the intended seam is:

1. Trusted caller supplies the same server-owned definition used here.
2. Checkout reads the authoritative bundle set price once from the existing
   Commerce price engine. Components are not priced as their own cart lines.
3. Checkout calls `projectFixedBundleFulfillment` and freezes that detached
   component snapshot with the commercial order line.
4. If the order later uses managed stock, checkout reserves the combined
   managed component quantities through the existing Inventory port. This
   module still does not reserve, release, or own stock.

Unresolved integration dependencies, not invented product policy:

- catalog representation for a bundle parent and its Commerce-owned set price;
- checkout/order persistence of the frozen component snapshot;
- runtime mount of any shopper or clerk surface;
- explicit adoption of managed-provider combined-basket reservation;
- independent review, draft publication, and merge.

Tax, refund, discount, UI, and customer-configurable membership are not
named by this slice.

## Shared-file integration overlaps

This slice edits only these already-shared composition files:

- `src/index.ts` — public `export *` of the feature entry; `createPlugin`
  storage and routes are unchanged;
- `package.json` — `./features/fixed-bundles` export and unit-test glob;
  native/sandbox/descriptor exports, build scripts, dependencies, and lockfile
  are unchanged;
- `FEATURE_MAP.md` — feature row and public boundary.

Do not treat those overlaps as checkout, catalog, or Inventory ownership
changes.

## Verification limit

Unit tests prove public projection behavior. They do not prove an end-to-end
shopper purchase, provider reservation, or fulfillment success.
