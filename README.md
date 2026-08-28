# DinkusKit Commerce

DinkusKit Commerce is the open-source commerce layer for EmDash sites. It is
being built in public for stores whose humans want to orchestrate the business
through EmDash while agents handle repeatable operations through the same
explicit contracts.

## Status

Charter stage. The package name is reserved in source as
`@dinkuskit/commerce`, but the manifest is private at `0.0.0`: there is no
installable package, release, deployment, or compatibility promise yet.

Scaffold development is pinned to exact `emdash@0.35.0` with a lockfile. This
is a build target, not a runtime compatibility claim; that claim starts only
with a real Commerce adapter and fixture.

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
npm test
npm run audit:repo
npm ls emdash --depth=0
```

Under construction. MIT licensed.
