# Authorize.net sandbox checkout provider: proof on the current head

Head under test: `efc2bf0` (PR #72), up to date with `main` at `6c54ee5` (after #71).
Measured 2026-10-09. This supersedes the size and test counts in the PR's original body (95,843 bytes, 360 unit tests), which predate #68 and #69.

## Commands and results

| Command | Result |
|---|---|
| `bin/verify-commerce quick` (typecheck, unit, audits) | pass; unit 421/421 |
| `npm run test:integration` | pass; 43/43 |
| `npm run test:sandbox` | pass; 10/10 (run on `c14a60e`; `efc2bf0` differs only in `.grilltrack/` ledger files) |
| `npm run test:sandbox:native-local-stock` | pass; 1/1 (same) |
| `npm run test:sandbox:orders` | pass; 1/1 (same) |
| `npm run build:sandbox` | `registry_bundle=pass backend_bytes=109350 headroom_bytes=21722` |

CI (`public-contract`, `bind`) is green on `efc2bf0`.

## Locked terms and the tests that prove them

Decision `checkout-authorize-net-provider-20261008` (locked, https://github.com/dinkuskit/commerce/pull/71#issuecomment-6067094917).

1. **Keep registry-checkout/v1; old configs load unchanged.**
   - `tests/features/checkout/registry-provider-admission.test.mjs`: "legacy enabled v1 stripe config without mode or authorize fields still admits"
   - `tests/integration/registry-checkout-services.test.mjs`: "predecessor v1 enabled config without mode still uses TEST Payments binding", "legacy enabled v1 stripe config without new fields still starts checkout"
2. **`authorizeNetMerchantId` only; `stripeAccountId` stays Stripe-only; cross-provider fields fail closed.**
   - `registry-provider-admission.test.mjs`: "authorize_net is admitted beside stripe with optional merchant field", "unknown providers, live mode, and overloaded stripeAccountId fail closed"
   - `tests/features/checkout/test-payments-reconciliation.test.mjs`: "authorize_net binding rejects stripeAccountId wire field with no fallback"
3. **Sandbox only.**
   - `registry-provider-admission.test.mjs`: "optional mode test is admitted for both providers"; live mode rejected in the fail-closed test above
   - `test-payments-reconciliation.test.mjs`: "authorize_net TEST adapter admits sandbox bindings and rejects live or stripe overload"
4. **Paid only after an authoritative lookup whose amount and currency match.**
   - `test-payments-reconciliation.test.mjs`: "authorize_net wake alone never marks paid; amount or currency mismatch stays unpaid"
   - `registry-checkout-services.test.mjs`: "authorize_net installed config admits beside stripe and creates a sandbox session"

## Bundle factoring

The catalog and inventory module moves in this PR are behavior-preserving size work. The full unit, integration and browser suites above pass unchanged against them, and the compiled Registry backend is 1,134 bytes smaller than `main` (110,484).
