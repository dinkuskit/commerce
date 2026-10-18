# Isolated Ship TEST profile retired (isolated-ship-cohort-retired-001)

Owner approval: Ronald, 18 Oct 2026 21:21 UTC in the project thread, "lock this", and asked that the
leftover pin code come out now rather than after go-live.

- `bin/verify-commerce full` steps run on the branch head with Node 22.23.2: typecheck, unit 591 pass,
  repo and feature audits clean, integration 99 pass, sandbox browser 10 pass, native local-stock 1 pass,
  Orders browser 3 pass, native consumer pass, settings 2 pass.
- `scripts/check-registry-bundle.mjs`: backend.js 117,064 bytes (14,008 under the 131,072 cap).
- Manifest allowedHosts: payments.dinkuskit.com, coupons.dinkuskit.com, ship.dinkuskit.com, dinkuskit.com.
- Saved beta settings: `tests/features/checkout/registry-provider-admission.test.mjs` (exact retired tuple
  admits with no Ship, every other form refused) and the compiled integration test "a store still saving
  the retired isolated Ship TEST profile keeps checkout and sends nothing to Ship" (checkout starts, no
  request to Ship or ship.sm0ky.dev, pinned order unchanged, no label link).
- Pinned orders: `tests/features/orders/ship.test.mjs` shows a pinned order is neither sent nor completed
  and its label event is not acknowledged.
