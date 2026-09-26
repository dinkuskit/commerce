# Commerce-owned product price

This slice persists Regular and optional Sale Money on existing draft simple
products. It does not add visual EmDash UI, checkout, Inventory transport,
coupons, payments, sale schedules, a Manage Stock toggle, or a template-store
catch-up.

## Money

Commerce stores one USD Money value as `{ currency: "USD", minor }`. `minor`
is a string of integer currency subunits (`"1200"` is $12.00). Floats,
implied-currency cents, and non-USD currencies are rejected.

## Isolated records

Each priced product has one `catalogPrices` row keyed by catalog item ID:

- `regular` is required on the row
- `sale` is omitted unless a valid Sale exists
- missing row means missing Regular: not listable, never `$0`

Price writes do not rewrite the catalog item, Inventory binding, backorder
policy, or manual availability.

## Guards

- Sale cannot be set until Regular exists.
- Sale must be strictly lower than Regular in the same currency. Equal or
  higher Sale is refused; Regular is unchanged.
- Sale cannot exist on a `$0` Regular.
- Lowering Regular below an existing Sale is refused.
- Clearing Sale keeps Regular. The product stays listable.
- Clearing Regular while Sale exists is refused. End Sale first, then unprice.
- After Regular is gone the product is not sellable and not listable.

`$0` Regular is a free product and remains listable.

## Actions and resolution

Private POST routes require `content:edit_any`:

- `catalog-items/set-regular-price`
- `catalog-items/set-sale-price`
- `catalog-items/clear-sale-price`
- `catalog-items/clear-regular-price`

`resolveCatalogItemPrice` returns `listable` plus Regular, optional Sale, and
`customerPays` (Sale when set, otherwise Regular).

`resolveStorefrontAvailability` and `resolveManagedStorefrontAvailability`
read that contract first. Missing Regular returns `listable: false` and
`sellable: false` without contacting Inventory or manual availability.

## Upgrade

Existing catalog drafts have no `catalogPrices` row. After this slice they
remain in the catalog and stay off the storefront until a clerk sets Regular.
That is the locked shop-owner contract, not a silent wipe. Operator
remediation is `catalog-items/set-regular-price`. Callers must pass the
`prices` collection; a missing collection fails closed as not listable.
