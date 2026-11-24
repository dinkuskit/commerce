---
"@dinkuskit/commerce": minor
---

Commerce no longer carries coupon code. Coupons are their own Registry plugin in the store, and the store's own code starts checkout through Commerce's new private add-ons door, `checkout/addons/start`, with the add-ons' answers: amounts off per line and free shipping, which Commerce checks against its own prices before it does the totals. Anyone signed in is refused there (`STORE_ONLY`). Orders shows the codes on the discount line, and the courier's `order.paid` news carries the discount and the add-ons, so the Coupons plugin can count each use. The public `checkout/guest/start` no longer takes `couponCode` and refuses add-on answers; `COUPON_UNAVAILABLE`, the hosted coupon port, the `coupons` checkout setting and the `./features/coupons` export are removed. Payments must accept a discount without the old coupon quote before this ships.
