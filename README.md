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

Mounted-site work is currently a private fork-backed pilot, not a stock 0.35.0
compatibility claim. It requires `saariuslystoned/emdash` at exact commit
`dbf11d1138dbd5c6e4e00195e9c99b0904c90799`, the head of
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
