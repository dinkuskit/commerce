# Coupons at Registry checkout through the hosted coupon service

Coupons left the Registry artifact on 2026-10-08 to keep the backend under
EmDash's 128 KiB per-file limit
([registry-coupons-deferred](registry-coupons-deferred.md)). They come back
through the hosted DinkusKit coupon service in `dinkuskit/coupons`, which runs
Commerce's own coupon core behind its HTTP contract v1
(`docs/hosted-coupon-service.md` there). GrillTrack:
`registry-checkout-hosted-coupons-001` and
`commerce-allowed-hosts-coupons-dinkuskit-com`.

The Registry artifact still has no `coupons` storage, `/coupons` admin page,
evaluator or redemption code. Creating coupons for a Registry store is the
coupon service's admin side (a Coupons admin plugin or CLI in
`dinkuskit/coupons`), not part of Commerce.

## Configuration

The owner's `installedCheckout` configuration
(`dinkuskit.commerce.registry-checkout/v1`) takes an optional `coupons` object
with exactly two fields:

```json
{ "coupons": { "origin": "https://coupons.dinkuskit.com", "audience": "<coupon service audience>" } }
```

`origin` is a bare HTTPS origin. The service is called with a separate secret,
`installedCheckoutCouponsCredential`: a `coupons:checkout` pass for the site
from the same issuer as the Payments pass (same `iss` and `site_id`, at most an
hour old, audience equal to `coupons.audience`). Commerce reads it only when a
checkout uses a coupon, so a missing or stale coupon pass never blocks
checkout without a coupon. The Payments pass is never sent to the coupon
service.

Without `coupons`, or without a valid coupon pass, a coupon code makes start
return `UNAVAILABLE` before any attempt write, coupon request or Payments call,
as before.

The manifest declares `network:request` with exactly
`payments.dinkuskit.com` and `coupons.dinkuskit.com`. Declaring a host does not
activate it on any site; activation stays a host and owner step. The native
entry keeps its own coupon storage and does not declare the coupon host.

## What checkout sends

`createHostedCouponPort` (`src/features/checkout/registry-coupons.ts`)
implements checkout's existing `CheckoutCouponPort`, so pricing, the attempt
lifecycle and wake recovery are unchanged:

| Checkout step | Request under `/v1/stores/{siteId}` |
| --- | --- |
| price the cart with a code | `POST /quotes` with `{ quoteId, code, lines }` |
| hold the coupon before payment | `POST /redemptions` |
| release a hold that never reached payment | `POST /redemptions/{attemptId}/release-unstarted` |
| link the payment session | `POST /redemptions/{attemptId}/provider-session` |
| settle after payment, or release | `POST /redemptions/{attemptId}/reconcile` |
| settle a zero-total order | `POST /redemptions/{attemptId}/free-order` |

Each line carries Commerce's own catalog price for the product (`regular`, and
`sale` when set), so the service evaluates exactly the prices Commerce
charges. Commerce sends no clock and no totals of its own for the quote; the
service uses its own clock. A hold carries the quote exactly as the service
issued it: checkout's frozen snapshot adds the overall payable total, which is
sent beside the quote, not inside it. Responses are read with the same bounded
reader as Payments responses.

## When the service fails

Checkout keeps the accepted total (issue 34):

- A quote that fails makes start return `COUPON_UNAVAILABLE` with a reason
  ([guest contract](guest-checkout-public.md#coupons-that-cant-be-used)):
  `NOT_FOUND` is `not-found`; `NOT_APPLICABLE` passes on the service's
  `reason` (and `minimum`) when it is one Commerce knows, else
  `not-applicable`; network errors, timeouts, 5xx and other refusals are
  `try-later`. No attempt is written and no payment starts, so checkout never
  continues at full price on its own; the shopper removes the coupon to accept
  the full price.
- A quote whose arithmetic disagrees with Commerce's own prices (a line total
  that is not price times quantity, a discount above its line, totals that do
  not add up) is refused the same way before anything is frozen. Commerce
  checks the service's quote with the same validator the Payments request
  uses.
- A hold that fails or whose answer is lost keeps the attempt in `reserving`
  without a payment session. The next start or status call retries with the
  same attempt identity and the same amount; the service answers retries of an
  existing attempt from its frozen quote.
- A hold the service refuses for good (`CAPACITY_EXHAUSTED`, `INVALID_INPUT`,
  `CONFLICTING_ATTEMPT`, `TERMINAL_CONFLICT`) releases the attempt before any
  payment, exactly as the in-process owner's refusals do. The attempt records
  `coupon.refused` (`used-up` for capacity, `not-applicable` for a rule that
  stopped applying between quote and hold, else `try-later`), and the guest
  projection shows `COUPON_UNAVAILABLE` with that reason so a storefront never
  keeps showing the coupon as applied.
- The service keeps issued quotes for 24 hours. A hold first attempted after
  that is refused (`QUOTE_NOT_ISSUED`); no use is held for that attempt and none
  can be, so the attempt is released without payment.
- A settle that fails leaves the hold pending, never lost money, and checkout
  retries it from the payment wake path.

## Proof

- `tests/features/checkout/registry-coupons.test.mjs` runs checkout through
  the hosted port against a stand-in for the service built on Commerce's own
  coupon core, including issue 34's neutral case (a 1000-unit item with a
  250-unit discount) under quote failures, lost and refused holds and expired
  quotes.
- `tests/features/checkout/checkout-pricing-hosted.test.mjs` runs every case
  in `checkout-pricing-recovery.test.mjs` again through the hosted port.
- `tests/integration/registry-checkout-services.test.mjs` runs the compiled
  Registry backend in workerd with a coupon service configured: a coupon
  checkout holds, pays and settles with its own pass, and a missing or wrong
  pass leaves coupon codes unavailable while checkout without one still works.
- `npm run build:sandbox` measured the Registry backend at 117,068 bytes,
  14,004 under the limit; the coupon port and quote validation add 4,662.
  Checking the service's quote arithmetic and reporting `COUPON_UNAVAILABLE`
  add 373 more (117,441 bytes, 13,631 under the limit).
  Specific coupon reasons add 737 more (118,178 bytes, 12,894 under the limit).
