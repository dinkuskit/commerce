# Vision

DinkusKit Commerce makes an agent-built EmDash store genuinely operable by a
human after scaffolding. The human controls products, presentation,
sellability, inventory policy, checkout, and recovery through understandable
admin surfaces; agents use the same explicit application contracts.

## In scope

- Sellable products, variants, SKUs, prices, and manual sellability.
- Per-product managed-stock choice with one fail-closed provider.
- Cart, Stripe-first checkout orchestration, Commerce receipts, and orders.
- EmDash admin and agent-oriented application surfaces.
- Open conformance seams for advanced third-party inventory providers.

## Out of scope

- Physical stock balances, locations, receiving, transfers, and adjustments.
- Brand-specific storefront content or design.
- Shipping-label systems, manufacturing/MRP, and production business data.
- Cryptocurrency acceptance or rewards before the Stripe-first path works.

## Guardrails

- One public product identity: DinkusKit Commerce at `dinkuskit/commerce`.
- No hidden local stock ledger, provider fan-out, or automatic fallback.
- No legacy history import. Useful behavior is re-proven in this repository.
- Package publication follows working end-to-end proof; it does not precede it.
