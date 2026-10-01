# Coupons v1 implementation contract

This is a trusted, unmounted Commerce feature. Checkout, payment, order
creation, browser/admin UI, and shopper UI adoption remain pending.

## Authority

`coupons` is the single durable authority. `createCouponAdmin`,
`evaluateCoupon`, and the one public `createCouponAttemptOwner` read and update
the same admin-created coupon record via versioned CAS. Attempts freeze the
rule version, coupon/rule/quote identities, all catalog-priced lines,
allocations, discount, merchandise payable total, and the trusted Commerce-host
overall payable total.
Pending and consumed attempts count against the current cap; released attempts
do not. Cap edits preserve attempts, cannot resurrect released holds, and a
shrink below usage produces zero remaining capacity until increased. Checkout
must supply the final total through this trusted owner boundary; browser totals
are not accepted.

Dates require offset-bearing ISO instants (`Z` or `±HH:MM`) and are compared by
epoch. The merchant host must convert wall time using its explicitly selected
IANA zone. Codes are normalized by trim/case and uniqueness is enforced by the
declared storage index; `list()` paginates instead of truncating at 500.

## Minimum spend eligibility policy

Coupons requiring a minimum eligible merchandise spend fail closed when the
eligible merchandise subtotal (pre-coupon, excluding shipping and tax) is
below the rule threshold:
- `evaluateCoupon` throws `CouponAdminError` with code `INVALID_INPUT` and
  message `minimum eligible merchandise spend not met`. Minimum failure makes
  the coupon ineligible rather than an accepted zero-discount quote.
- `createCouponAttemptOwner.reserve` validates the current rule minimum against
  the frozen quote's `eligibleSubtotal` before any attempt allocation or CAS,
  throwing `CouponRedemptionError` with code `INVALID_INPUT` if not met. This
  prevents stale or forged below-threshold quotes from consuming scarce cap
  capacity.
- Existing identical attempt replay remains first and unaffected by subsequent
  rule minimum edits.
- The zero final-payable free policy remains intact: a coupon with a qualifying
  subtotal that reduces overall payable merchandise total to zero (100% or
  fixed full subtotal) remains valid and reconciles through the free-order seam.

## Trusted free-order seam

Only a durable Commerce owner may supply a whitelisted completed-order proof:
matching attempt/coupon/rule/rule-version/quote IDs, order and receipt IDs,
and an overall USD payable total of exactly zero. A positive original quote
cannot consume through a forged zero proof. Payment sessions and payment IDs
are never accepted by this seam.

## Storage and adoption

The host declares `coupons` with a unique `normalizedCode` index and atomic
`getVersioned`/`compareAndSet`; future host admission uses the supported EmDash
permission `plugins:manage`. Host admission remains pending, and this package's
storage declaration is explicitly `mounted: false`; no route or permission
adapter is mounted here. Checkout, free-order owner, payment owner, shopper UI,
and merchant UI adoption are explicit host seams, not claims made by this
package.
