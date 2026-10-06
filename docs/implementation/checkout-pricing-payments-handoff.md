# Checkout pricing handoff, version 1

This is the positive-payable Commerce source contract for the existing Payments
owner. Schema: `dinkuskit.commerce.checkout-pricing/v1`. It extends current
bounded-window requests with an optional `pricing` snapshot. Existing Payments
merchandise-only implementations must adopt it explicitly before it is enabled.

## Canonical arithmetic

Commerce owns the calculation and order. The payment request contains original
catalog `lines` (identity, name, quantity, unit price), canonical `total`, and:

| Snapshot field | Meaning |
| --- | --- |
| `schema` | Exact version above |
| `merchandiseSubtotal` | Sum of original unit price × quantity |
| `couponDiscount` | Existing evaluator's discount, capped and allocated by its settled rules |
| `netMerchandise` | Subtotal minus discount |
| `shipping` | Frozen configuration ID, revision, free/flat mode and USD `charge` |
| `finalTotal` | Net merchandise plus shipping, equal to request `total` |
| `lines` | Original identity/quantity/unit price, `lineSubtotal`, allocated `discount`, exact `netAmount` |
| optional `coupon` | Normalized selection and original evaluator quote snapshot |

All amounts are canonical nonnegative USD integer minor-unit strings within
the existing Money bound. Line discounts sum to the coupon discount; line net
amounts sum to net merchandise. The optional coupon quote also freezes
`merchandiseTotal` and `overallPayableTotal` and coupon/rule/version/quote IDs.

For example, original merchandise of 250 cents, a 100-cent fixed discount,
and 50-cent flat shipping produces **200 cents**. With quantities two and one,
the existing evaluator allocates discounts of 60 and 40 cents to original
line subtotals of 150 and 100 cents. The exact net lines are 90 and 60 cents.
Payments must preserve whole-line amounts; dividing discounts into unit prices
and rounding again can change the charge.

Payments must validate this arithmetic, persist the complete original snapshot
and fingerprint before processor contact, and derive processor line/charge
parameters whose total equals the canonical amount. It must not reevaluate a
coupon, resolve new prices/shipping, create a second money writer, omit the
snapshot when shipping offsets the discount, or reset idempotency/deadlines.
Processor adoption and real Stripe acceptance remain separate proof gates.
Commerce's trusted TEST adapter rejects inconsistent snapshot, line, coupon,
shipping or request-total arithmetic before credential resolution or transport
on both creation and lookup. It validates the frozen original without resolving
new merchant rules or prices.

## Explicit support and historical requests

The trusted pricing context declares `paymentPricingSchema` equal to the exact
schema. The resolved payment port independently declares the same
`pricingSchema`. Absence or mismatch stops creation/recovery and retains any
already-started attempt. It cannot establish a provider not-created fence.
The trusted TEST adapter additionally requires its server configuration's
`pricingSchema`; its default rejects pricing-bearing requests before credential
reads or binding/session HTTP. An unknown schema is rejected.

New priced requests keep `paymentWindow:{minSeconds:1800,maxSeconds:1860}` and
`paymentMethods:["card"]`. Historical merchandise-only requests retain their
original shape and fingerprint, including frozen `paymentWindowSeconds:1800`
originals. Never add pricing or migrate a window on replay. Pricing-bearing
legacy-window construction is not part of this version.

## Trusted input, redemption and recovery

The guest start accepts only `lines` and optional scalar `couponCode`. The
merchant's shipping reader is trusted server configuration. Native and Registry
runtime assembly bind `coupons` from this Commerce installation's owner storage;
no host-supplied foreign coupon collection is used. This seam does not add a
merchant shipping UI or attest an installed site's configuration.

Checkout freezes one snapshot and persists its cart attempt before coupon
capacity mutation. Losing cart candidates do not reserve slots. Coupon capacity
uses the existing stable aggregate and CAS owner before a payable session.
Current rule/expiry/cap failures never fall back to an undiscounted payment.
Commerce first persists a pre-payment release phase when creation is forbidden;
the trusted `releaseUnstarted` owner operation fences both existing and late
coupon reserves without consuming capacity. It rejects payment-bound or
consumed attempts. This operation is not a public browser route.

Unknown provider/storage outcomes retain the frozen original. Only validated
authoritative payment results establish paid or terminal-unpaid state. Provider
session attachment is immutable. The canonical paid order stores the exact
pricing snapshot before coupon consumption. Terminal replay completes lost
coupon writes idempotently; wakes remain unacknowledged until coupon effects
settle. Local clocks and changed host support never authorize release.

Guest projections expose subtotal, discount, net merchandise, shipping mode and
charge, and final total. Internal configuration/quote/redemption identities stay
server-side. Historical guest projections remain valid without a pricing field.

## Acceptance limits and next owner

This slice retains explicit rejection of a **zero final payable total**. The
accepted zero-order behavior remains required for v1 and is the next separate
Commerce slice: one canonical order/receipt writer and trusted free-order
redemption, with no fake payment/session ID. A zero merchandise amount with a
positive shipping charge is still payable.

Inventory remains optional for unmanaged baskets and fail-closed for managed
ones. There is no new tax, shipping-address, stacking, advanced-promotion,
account, provider, credential, scheduler, deployment or publication policy.
Source/fixture transport proof is not full-v1, Registry installation, real Stripe
purchase, or provider activation proof. The coordinator routes the immutable
source/artifact identity to the existing Payments and Template owners.
