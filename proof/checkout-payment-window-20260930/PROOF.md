# Checkout payment window 1800..1860

Decision: `checkout-payment-window-004`.
Branch: `codex/commerce-guest-checkout-mount`.
Base: `e3d398bde103d23417c7c1a954834dadf419ec4b`.
Node: mise `v22.23.1`. Actual Stripe: **NOT_RUN**.

Human-approved inclusive provider-reported 1800..1860-second hosted card
session window. This proof is synthetic Commerce construction, validation,
legacy replay, and public-contract documentation. It does not claim guest
verification, shipping/contact/coupons, or provider acceptance.

## Contract implemented

- New attempts persist only
  `paymentWindow: { minSeconds: 1800, maxSeconds: 1860 }`.
- Public union handoff:
  `CurrentPaymentRequest | LegacyExact1800PaymentRequest` via
  `paymentRequestHandoff`.
- Outcome validation requires real safe-integer `createdAt`/`expiresAt`.
  Inclusive `1800 <= expiresAt - createdAt <= 1860` for current requests.
  Exact `1800` for frozen `paymentWindowSeconds: 1800`.
- Session `sessionId`, `redirectUrl`, `createdAt`, and `expiresAt` compare
  by value on later outcomes.
- Frozen old1800 originals are not rewritten on retry or restart.
- Unknown and elapsed local timer cannot release a managed hold or create a
  replacement session.

Payments obligations are documented, not executed here: persist one original
claim/request/deadline/idempotency key before provider contact;
`requestedExpiresAtSeconds = floor(original claimedAtMs / 1000) + 1860`;
validate exact requested expiry plus actual bounds; never reset deadline or
parameters, send altered retries or new keys, or lookup-create; keep the
conservative 23-hour create retry bound.

## Verification

Focused commands, Node 22 via mise, no browser:

```sh
mise exec -- npm run build
mise exec -- npm run typecheck
mise exec -- node --test tests/features/checkout/payment-window.test.mjs \
  tests/features/checkout/checkout.test.mjs \
  tests/features/checkout/public-contract.test.mjs
mise exec -- npm run audit:repo
```

Results: build pass, typecheck pass, 30/30 focused checkout tests pass,
guest-mount unit 9/9 ran only as a no-claim regression, repository/feature
audits clean. Raw logs are in the ignored work trail
`.grilltrack/work/guest-checkout-mount-20260930/logs/11-build.txt` through
`15-audit-repo.txt`.

Covered timing cases: endpoints 1800/1860 and interior 1859; reject
1799/1861, non-integers, omitted and unsafe timestamps; later altered
immutable session fields reject; old frozen request remains exact across
retry/restart; legacy rejects 1859; unknown/local timer cannot release or
replace; new request shape is cloned.

## Historical proof

Earlier exact-1800 proof remains history:
`proof/checkout-experience/`, `proof/checkout-expired-recovery/`,
`proof/checkout-session-equality/`. Those committed artifacts were not rewritten.
The current guest-mount candidate has separate required authorization/retention
repairs; passing timing checks do not qualify that candidate.

## Scope and review

Author verification only. No commit, push, merge, deploy, or provider call.
Parent independently passed 29 timing/kernel checks plus one public-contract
check, typecheck, and public repository/feature audits. Full source inventory
contains 354 files, including current CLI ledger/events and prior public proof;
both current proof metadata directories are excluded to prevent circular hashes.
Manifest SHA-256: `909d768b38d20bca679d78e751afd2398491886b57dc33406419d678abb82f88`.
Existing UI host/support gaps remain. Guest authorization/retention repairs are
required before guest mount admission; actual Stripe is not run.
