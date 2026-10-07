# Zero-payable checkout orders

Checkout composes the authoritative catalog, coupon, and configured shipping
snapshot before deciding whether a provider payment is needed. A USD snapshot
with final total `0` follows the existing checkout aggregate and CAS writer:

- reserve inventory and coupon capacity as usual;
- persist one canonical `order:<attemptId>` and `receipt:<attemptId>` with the
  frozen lines, pricing, and zero total;
- omit `paymentId`, payment session creation, provider lookup, and provider
  coupon-session attachment;
- consume a coupon only after the canonical order is durable, using the
  existing verified-free-order proof and its exact attempt, coupon, rule,
  quote, order, receipt, and zero-total identities.

Unknown storage or coupon outcomes retain the durable attempt for replay.
Retries converge on the same order and coupon attempt. Positive totals retain
the existing Payments flow, and positive shipping therefore remains payable.
This slice adds no shipping, tax, refund, expiry, inventory-ledger, or
provider-activation policy.
