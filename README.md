# DinkusKit Commerce

DinkusKit Commerce is the open-source commerce layer for EmDash sites. It is
being built in public for stores whose humans want to orchestrate the business
through EmDash while agents handle repeatable operations through the same
explicit contracts.

## Status

Pilot stage. The package name is reserved in source as
`@dinkuskit/commerce`, but the manifest remains private at `0.0.0`: there is
no installable package, release, deployment, or compatibility promise yet.

Development and the private package's runtime peer are pinned to exact
`emdash@0.35.0`. The first feature is the `dinkus.catalog` draft-item creation
pilot, registered under the EmDash runtime slug `dinkus-commerce`. It refuses
writes unless the live EmDash storage collection proves unique `commandId`
and site-wide canonical `skuKey` constraints.

The `dinkus.inventory-provider` foundation now gives Commerce one opaque
store-binding value—provider reference, pool ID, and default fulfillment
location ID—and pure managed-stock state transitions. A catalog item created
with `manageStock: true` is persisted as `managed` and `setup-required`, with
no Commerce-local quantity. Its provider-neutral registration contract then
builds a pool-scoped identity request from the canonical Commerce SKU and uses
the current Commerce title once as the new Inventory display-name default,
falling back to the SKU when the title is absent. Commerce persists one hidden
registration operation before calling its provider port. Ambiguous failures
remain `setup-pending` and are retried only through an explicit action with the
same operation identity; terminal provider rejection becomes
`setup-needs-attention`, and corrected submission requires a new identity. A
newly registered SKU stores only its permanent Inventory identity; an existing
pooled SKU remains `needs-review` until explicit confirmation. Legacy or
malformed managed records fail safe to `setup-required` on read. Live Inventory
transport, current-stock review, pool discovery, and admin UI remain later
slices.

The `dinkus.inventory-setup` slice persists one store-level provider binding
with a permanent Commerce-generated site ID. Its private Configure Inventory
route accepts only a catalog item ID, loads the canonical product and binding
server-side, and starts the existing atomic registration flow through an
injected `InventoryProviderPort`. Missing store setup returns a structured
Configure Inventory action without contacting a provider or creating a claim.
Provider or pool changes require a future explicit migration; they never
silently repoint managed products.

The `dinkus.storefront-availability` backend resolves an active managed
product into stable `status`, `sellable`, and optional `displayQuantity`
facts. Commerce reads only Inventory's authoritative `available` quantity at
the store's configured default fulfillment location. Status-only display is
the compatibility default; store owners may opt into exact quantities or a
positive low-stock threshold. Backorders are a separate per-product policy
that defaults off. Missing setup, missing stock, malformed provider output, or
an unavailable provider returns `availability-unavailable` and is never
treated as zero stock or a backorder. The package stores no fallback quantity.

Products with Manage Stock disabled use a separate Commerce-owned manual
availability value: `in-stock`, `out-of-stock`, or
`available-on-backorder`. A missing value defaults to `in-stock` for new and
legacy products. The private `catalog-items/set-manual-availability` action
can change it only while the product is unmanaged. The value remains dormant
while Inventory manages the product and returns if management is later
disabled. `resolveStorefrontAvailability` selects the managed or unmanaged
authority and always returns the same structured storefront contract;
unmanaged products never expose an invented quantity or contact Inventory.

Mounted-site work is currently a private pilot backed by the public
[`saariuslystoned/emdash`](https://github.com/saariuslystoned/emdash) fork, not
a stock 0.35.0 compatibility claim. It requires exact commit
`dbf11d1138dbd5c6e4e00195e9c99b0904c90799`, the public head of
[EmDash PR #2768](https://github.com/emdash-cms/emdash/pull/2768). Stock
`emdash@0.35.0` cannot materialize the required indexes through the mounted
Cloudflare development runtime, so Commerce fails writes closed there. After
the fix reaches a stable EmDash release, Commerce must repin and rerun the
SmokyClub mounted-site proof before expanding its compatibility claim.

The current product boundary is recorded in [docs/CHARTER.md](docs/CHARTER.md).

## Direction

- Commerce owns sellable product and variant identity, price, sellability,
  cart, checkout orchestration, receipts, and orders.
- A product may opt into managed stock. Commerce then uses one configured
  inventory provider and never stores a fallback quantity.
- Storefront display and backorder behavior are Commerce policy. Inventory
  remains the only authority for the quantity those rules evaluate.
- DinkusKit Inventory is the default first-party inventory system; it remains
  the authority for physical quantities, locations, reservations, and stock
  movements.
- Stripe-first checkout comes before additional payment or reward systems.
- Humans remain in charge. The EmDash admin and agent surfaces must expose the
  same durable operations and understandable recovery states.

## Development

```bash
npm ci
bin/verify-commerce quick
bin/verify-commerce full
```

The quick verifier covers types, unit contracts, feature boundaries, public
repository hygiene, the exact EmDash API peer, and the exact private-pilot fork
contract. The full verifier additionally runs cross-process SQLite atomicity
proof against EmDash's real 0.35 storage repository and a two-process local
Wrangler/D1 expression-index proof.

Under construction. MIT licensed.
