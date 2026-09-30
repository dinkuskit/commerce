# Checkout payment window

Public Commerce timing contract for `checkout-payment-window-004`.
Entry: `@dinkuskit/commerce/features/checkout`.
USD, card, positive totals, hosted-first checkout, stock-hold ownership, and
the immutable Payments binding stay locked. This document does not authorize
guest-auth repair, shipping, contact, coupons, deployment, or an actual
Stripe run.

## Exported types and helpers

Current construction uses only this immutable policy:

```ts
paymentWindow:{minSeconds:1800;maxSeconds:1860}
```

Exact exports:

| Export | Role |
| --- | --- |
| `CURRENT_PAYMENT_WINDOW` | `{ minSeconds: 1800, maxSeconds: 1860 }` |
| `CURRENT_PAYMENT_WINDOW_MIN_SECONDS` | `1800` |
| `CURRENT_PAYMENT_WINDOW_MAX_SECONDS` | `1860` |
| `LEGACY_EXACT_PAYMENT_WINDOW_SECONDS` | `1800` |
| `PAYMENTS_CREATE_RETRY_BOUND_HOURS` | conservative `23` |
| `PAYMENTS_SAFE_PROVIDER_DELAY_SECONDS` | `60` |
| `CurrentPaymentWindow` | current policy object type |
| `CurrentPaymentRequest` | new durable request shape |
| `LegacyExact1800PaymentRequest` | frozen historical original |
| `PaymentRequest` | `CurrentPaymentRequest \| LegacyExact1800PaymentRequest` |
| `PaymentRequestHandoff` | `{ kind, request }` discriminated union |
| `PaymentWindowPolicyKind` | `"current-bounded-1800-1860"` or `"legacy-exact-1800"` |
| `PaymentWindowBounds` | kind plus inclusive min/max seconds |
| `createCurrentPaymentRequest` | Commerce constructor for new attempts |
| `isCurrentPaymentRequest` | field-presence guard |
| `isLegacyExact1800PaymentRequest` | field-presence guard |
| `paymentRequestHandoff` | precise discriminated handoff for Payments |
| `readFrozenPaymentWindowBounds` | validate and read the frozen policy |
| `providerSessionWindowIsValid` | real provider timestamp bounds check |

Discriminant is field presence, not a rewritten stored tag:

- current: `paymentWindow` present and `paymentWindowSeconds` absent
- legacy: `paymentWindowSeconds` present and `paymentWindow` absent
- both or neither: invalid; do not coerce

`startCheckout` persists `createCurrentPaymentRequest(...)` before payment
contact. Retries pass `structuredClone(attempt.payment)` and never convert a
legacy original into the current shape.

## Outcome validation

For every non-unknown outcome with a session, Commerce requires:

- real safe-integer `createdAt` and `expiresAt`
- real session id
- inclusive `1800 <= expiresAt - createdAt <= 1860` for current requests
- exact `expiresAt - createdAt === 1800` for frozen `paymentWindowSeconds:1800`
- later outcomes compare `sessionId`, `redirectUrl`, `createdAt`, and
  `expiresAt` by value

Never manufacture `createdAt` from expiry. Never omit `expiresAt` or accept a
24-hour default. Unsafe integers, non-integers, and missing timestamps fail
closed. A local clock may hide an old redirect; it cannot authorize release or
declare `not-created` / `expired-unpaid`.

## Payments adapter obligations

Payments consumes the public handoff. Before any provider contact it must
persist one original claim, request, deadline, and idempotency key.

Pin:

```text
requestedExpiresAtSeconds = floor(original claimedAtMs / 1000) + 1860
```

Then validate the exact requested expiry plus the actual provider-reported
bounds. Never reset the deadline or parameters, send an altered retry, mint a
new key, or lookup-create. Preserve the conservative 23-hour create retry
bound. More than 60 seconds of delay or clock skew can still fail safely.

Unknown outcomes and an expired local timer never establish `not-created` or
unpaid and never release a managed hold. Release requires authoritative
`expired-unpaid` or the existing terminal `not-created` creation fence.
A known session can never become `not-created`.

## Legacy exact-1800 behavior

Already-frozen durable records may still contain
`paymentWindowSeconds: 1800` and no `paymentWindow`. Replay them exactly.
Compatible validation uses that attempt's frozen policy: the old exact-1800
equality. A 1859-second provider duration that is valid for a new request is
invalid for a frozen old1800 original. Type support is the public union
above so Payments can consume the current shape while replaying old originals
safely. Do not silently convert old durable records.

Historical proof that documented exact 1800 remains history. This file is the
current public contract.

## Proof limits

Synthetic Commerce tests prove construction, bounds, clone invariance, session
equality, and legacy replay. They are not an actual Stripe run.
