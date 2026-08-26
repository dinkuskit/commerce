# DinkusKit Commerce Charter

## Public clean-room origin

DinkusKit Commerce starts public with a new, independent Git history. A prior
private implementation may inform later research, but its repository history,
artifacts, private rationale, and files are not imported. Useful behavior is
ported one bounded slice at a time, reviewed with its complete dependency
closure, and committed here as new public work with fresh proof.

## Product boundary

DinkusKit Commerce is the reusable EmDash commerce layer:

- sellable product, variant, and SKU identity;
- authoritative price, currency, and sellability;
- a per-product `Manage stock?` choice and one configured inventory provider;
- cart, Stripe-first checkout orchestration, Commerce receipts, and orders;
- human-operable EmDash admin and agent-oriented application surfaces.

Commerce does not own physical stock truth. Managed products fail closed when
their configured inventory provider is unavailable; there is no local quantity
or silent fallback. DinkusKit Inventory is the default first-party provider.

## Initial delivery boundary

This repository begins at charter stage. The package manifest is private at
`0.0.0`, and the first commit contains no installable commerce implementation.
Implementation starts only after a focused product slice is grilled and locked.
