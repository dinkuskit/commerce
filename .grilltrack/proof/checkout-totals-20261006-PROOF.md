# Positive-payable checkout totals proof

## Accepted behavior

Commerce combines its authoritative catalog price with the existing basic coupon evaluator and trusted merchant free/flat shipping configuration. A frozen versioned snapshot conserves integer USD amounts and is reused by payment requests and the canonical paid order. Historical merchandise/window requests remain unchanged. No browser total is authority.

A synthetic 250-cent merchandise basket, 100-cent fixed discount and 50-cent shipping charge freezes 200 cents. A 33.33% coupon preserves whole-line cent allocations and original quantities. A fully discounted basket with positive shipping still uses payment; zero final totals are explicitly rejected by this slice.

## Verification

Pinned Node 22.23.1 and unchanged package lock:

- `npm run typecheck`, build and repository/feature audits: pass.
- Full unit suite: 295 pass. Integration suite: 22 passed on the preceding repaired candidate; current Mac limitation is recorded below.
- `npm run test:sandbox`: 5 pass.
- `npm run test:sandbox:native-local-stock`: 1 pass.
- `npm run test:sandbox:coupons`: 1 pass, including official Registry packaging and existing role/forbidden-action checks.
- Focused pricing suite: 20 pass, included in the unit total.

The initial complete-command attempt used a borrowed dependency symlink. Unit/integration checks passed, but Vite rejected the external dependency paths. That task-owned browser run was interrupted; a local locked install fixed the fixture boundary. Rebuilding with local dependencies restored the existing audited auth purity transform. The preceding repaired Registry backend was 119,954 bytes, below the official 128 KiB limit. No validation limit or auth policy was relaxed.

## Recovery and source review

Parent review rejected five measured draft failures before acceptance: final-zero payment creation, schema-support-loss release, missing order pricing, premature wake acknowledgment, and non-string coupon input. Regression tests now pass. The parent also verifies concurrent cart/cap claims, an expiry race against delayed coupon reservation, lost coupon reserve/consume/release replies, lost order-write replies, immutable replay after merchant edits, explicit adapter schema gates before credentials/transport, exact synthetic transport payload, and canonical owner storage binding.

A durable Commerce pre-payment phase fence precedes the trusted coupon `releaseUnstarted` operation. Late reserve attempts remain terminal; payment-bound/consumed coupon records cannot be treated as unstarted. Paid order storage precedes coupon consume; terminal replay and retained wakes finish interrupted effects without another order/session.

Guest summaries expose amounts and shipping mode only. Provider/configuration/quote/redemption identities remain server-side. Default installed routes retain unavailable Payments and empty manifest capabilities/hosts.

## Limits and next owner

This is source, synthetic port/storage and installed fixture evidence. It does not attest a real Stripe TEST purchase, merchant/provider activation, production configuration, publication or deployment. The trusted shipping reader has no new merchant UI in this slice. Payments must adopt the exact pricing version explicitly; existing merchandise-only adapters remain blocked for new pricing requests.

The accepted canonical zero-payable order writer and trusted free-order coupon reconciliation remain required for v1 and are the next separate Commerce slice. Positive-only proof is not full-v1 coupon acceptance. New source remains subject to exact-head CI, comprehensive OpenClaw/P3 and native ClawSweeper adjudication before any human-authorized merge.

## Accepted review repair

Comprehensive OpenClaw/P3 review of `6e6a4bc43cca8dd56af0c52556bf6d4a48a457a5` found one P2: the TEST payment adapter could forward valid-schema pricing with divergent total/snapshot arithmetic. Classified `required_fix`. A regression first reproduced the missing validation. Both create and lookup now reject 19 divergent total, shipping, line, coupon quote and canonical-money cases before any credential or transport operation. The adapter reuses the Coupons public quote-snapshot validator and checks its equality to the frozen payment snapshot; historical requests remain unchanged.

Parent source-intent and standards review accepts this repair: frozen originals are validated without reevaluating prices/rules, no provider or second order writer was introduced, and all 323 required checks (294 unit, 22 integration, seven installed browser tests) pass. This parent acceptance does not substitute for fresh exact-head CI, comprehensive OpenClaw/P3 and native ClawSweeper review of the pushed candidate. Prior external reviews remain evidence only for their original commit.

## Core malformed-input repair and local limitation

Comprehensive OpenClaw/P3 review of `d1313b09983f96b16b4bb49bed5492a82a253e04` found one P3: nullish direct core cart payloads dereferenced `lines` before validation. Classified `required_fix`. A regression reproduced the TypeError instead of the expected Invalid cart rejection; an object/array guard now rejects nullish and primitive inputs before storage reads, coupon reservation or payment resolution. The 20 focused pricing tests and 295 unit tests pass; repository/feature audits pass.

The current local full-check attempt and two bounded integration diagnostics preserve a Wrangler/D1 limitation: the unchanged concurrent uniqueness test intermittently returns a generic internal-error reference rather than its expected constraint identity. One attempt passed 21/22 integration cases, another 20/22; serialized test files passed 21/22. The test's concurrent two-process contention remains unchanged; its source, D1 fixture and package lock are unchanged from the base. This is an unresolved local verification limitation, not a passing integration claim. Fresh exact-head CI must supply its own full result; previous CI/native reviews are not reused. No broad dependency, test-policy or D1 repair is included in the checkout slice.

The final guard repair also passes all seven installed browser tests. Its freshly built Registry backend is 120,017 bytes, below 128 KiB. Parent source-intent review accepts the guard with no new payment/order behavior; exact-head CI and both external reviews remain required.
