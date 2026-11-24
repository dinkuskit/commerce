# Guest checkout orchestration contract

Accepted decisions: `checkout-guest-001`, `checkout-hosted-first-002`,
`checkout-stock-hold-003`, `checkout-payment-window-004`. Commerce owns the
attempt, frozen USD minor-unit string amounts, order and receipt. Payments
owns processor transport, verified webhook ingress, authoritative outcome
normalization and durable processor-operation identity. Inventory owns stock.

The public checkout entry is `@dinkuskit/commerce/features/checkout`.
`startCheckout(execution, cartId, lines, retryAfter?)` accepts only product IDs
and positive integer quantities, coalesces duplicate lines and reads the existing
catalog price and sellability rules. No shopper account is required.
The caller must derive a tenant-scoped cart capability server-side, authorize
access to it, and keep it stable across guest retries. This library is not a
public unauthenticated route. Browser cart IDs, totals, success URLs and event
payloads cannot confer payment authority.

## Durable state and recovery

`createCheckoutStore` uses EmDash `getVersioned` and atomic `compareAndSet`.
The `checkoutCarts` collection stores one aggregate per cart, containing its
attempt history and the order/receipt of each paid attempt. The same atomic
write changes an attempt to paid and materializes its order and receipt IDs.
There is no second order writer. Consumers can read the durable order from
this aggregate; this slice does not implement receipt delivery or fulfillment.

Before contacting a provider, Commerce persists the frozen request and a
server-created attempt UUID. Conflicting requests for an active cart fail;
identical retries reuse the winner. Injected identity generators must provide
globally unique IDs. A paid cart continues returning its existing order; a
subsequent purchase uses a new server-owned cart capability.

Transitions are `reserving -> paying -> paid` or
`reserving/paying -> releasing -> released`. A terminal, no-holds Inventory
rejection goes directly to `released`. Provider throws, partial outcomes and
unknown results preserve the recoverable phase. Retries and reconcilers do
not use process-local locks. CAS conflicts re-read current state with a bounded
retry budget. A restart repeats external calls with the same immutable identity.

Only `released` admits a fresh attempt, with `retryAfter` equal to the released
attempt ID. That attempt revalidates the current cart, prices and availability.
Old-event reconciliation targets its old attempt; it cannot mutate a successor.
Inventory and payment bindings are frozen, including the fulfillment location.
A missing old binding preserves uncertainty; configuration changes cannot
silently substitute an account, provider or location.

## Inventory adapter obligations

Checkout needs a new whole-basket reservation operation, separate from the
existing SKU-registration and stock-read ports. Managed quantities sharing an
Inventory SKU are combined. Backorders use the existing per-product policy;
a shared SKU permits backorders only when all contributing products do.
Unmanaged lines never invoke Inventory.

`reserve(StockRequest)` must be durably idempotent for the exact operation ID,
binding and complete requirements. It reports `reserved` only when every
requirement is held. A shortage reports `rejected` only after any partial holds
are absent and the operation is permanently unable to succeed. Partial commits,
transport loss and unresolved compensation report `unknown` or throw; retry
must reconcile the same operation rather than create another reservation.
`release` must fence late/in-flight reservation requests, be durably idempotent,
and report success only after every hold is absent. A released operation must
never reacquire stock. There is no TTL release: paid holds remain through
fulfillment, which is outside this slice.

These are required Inventory capabilities, not capabilities established by a
stock read or SKU registration. No production adapter exists in this patch.

## Payments adapter obligations

Each immutable payment binding must route to the same processor merchant
account. `ensureSession` owns a persistent attempt-to-session mapping and request
fingerprint. It must resolve ambiguous transport outcomes before ever trying
another creation. Stripe's finite idempotency-key retention alone is insufficient
for indefinite retry safety. `lookup` must never create a payment session.

The bounded harness uses Stripe-hosted, one-time, immediate card payments and
positive USD totals. Canonical zero totals use the
[Commerce zero-payable order writer](checkout-zero-payable-orders.md).
Delayed payment methods remain unavailable pending their settlement policy. No shipping, tax, discount,
subscription, live merchant connection or customer-account behavior is implied.
An adapter must disable processor changes to frozen Commerce totals.

Set a provider-reported inclusive 1800..1860-second window at first processor
session creation and preserve that session's original deadline forever. New
Commerce requests use immutable `paymentWindow: { minSeconds: 1800, maxSeconds:
1860 }`. Commerce validates real safe-integer provider `createdAt`/`expiresAt`
and accepts `1800 <= expiresAt - createdAt <= 1860`. It never manufactures
creation time or omits expiry. Frozen historical `paymentWindowSeconds: 1800`
originals stay exact and keep exact-1800 validation; retries do not rewrite
them. See [checkout-payment-window.md](checkout-payment-window.md) for the
public types, Payments persist-before-contact obligation, 23-hour create retry
bound, and `requestedExpiresAtSeconds=floor(original claimedAtMs/1000)+1860`.
Time spent reserving does not reduce the shopper's processor payment window. A
local deadline suppresses an old redirect but never releases stock. Session
creation and expiration semantics are documented in
[Stripe's creation API](https://docs.stripe.com/api/checkout/sessions/create)
and [session API](https://docs.stripe.com/api/checkout/sessions/object).

`paid` requires authoritative settlement, matching attempt, original session,
frozen amount/currency and processor payment identity. A completion callback or
an unverified event is insufficient. `expired-unpaid` must be terminal and
exclude any successful or pending payment that could later settle: if the adapter
cannot establish that exclusion it must return `unknown`. `not-created` is a
terminal durable creation fence, including concurrent in-flight creation; an
empty search, transient failure or idempotency cache miss is insufficient.
Terminal paid and non-payment outcomes must be mutually exclusive and stable.
This terminal guarantee is essential to safe payment-versus-release races.

Only trusted provider code returns these normalized outcomes. An authenticated
Payments webhook consumer uses an event as a wakeup and calls
`reconcileCheckout(execution, cartId, attemptId)`; Commerce ignores event body
state and looks up authoritative current outcome. Duplicate/out-of-order hints
produce the same durable order and cannot override a terminal paid attempt.

## Integration dependencies and proof limits

Registry/native continuity has a separate owner. This base exports the service
and collection adapter but does not mount checkout routes or declare the
collection in the plugin. The registry owner must declare `checkoutCarts`, bind
trusted guest cart authority, and resolve immutable Inventory/Payments bindings
before exposing shopper checkout. No storefront UI was changed or claimed.

The separately owned Inventory implementation must satisfy the complete-basket
reservation and terminal-release contract. Payments is still a scaffold; its
first adapter must implement this Commerce-owned contract before an actual
Stripe test-mode proof can run. The fake providers demonstrate orchestration,
not those production adapter guarantees. No secure Stripe credential route was
used, no credentials inspected, and no processor purchase or deployment occurred.

Reproduce the synthetic proof with `npm run build` followed by
`node --test tests/features/checkout/*.test.mjs`. The tests use real persisted
SQLite CAS, separate connections/processes, and persisted fake external
operations; an additional integration test exercises the exact EmDash storage repository after reopening its connections. Neither establishes runtime mounting or actual Stripe behavior.
