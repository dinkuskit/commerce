# Prepared guest checkout recovery

Base: `13cf0eb08b1ea902faac7b563ae05d4d163ab624`.

## Reproduction and repair

The actual compiled 0.2.1 sandbox rejects a physical basket when the merchant
has no allowed shipping country. That validation happens before saving a
checkout attempt or calling Payments. After configuring a shipping country,
status formerly returned `CHECKOUT_NOT_FOUND`, preventing the consumer from
reusing its prepared capability.

Status now returns the existing prepared projection only after capability and
origin admission, a successful store read returning no aggregate, and no
explicit attempt hint. It creates no capability, attempt, or provider session.
Storage errors and malformed aggregates still fail closed. Existing attempts
continue through reconciliation. Capability lifetime policy is unchanged.

## Local proof

The regression tests first failed against the base at the no-attempt status
assertions. They pass with the repair:

```sh
node --test --test-name-pattern='prepared status|existing unknown payment|country-rejected' \
  tests/features/checkout/guest-mount.test.mjs \
  tests/integration/registry-checkout-services.test.mjs
```

Six cases cover repeated read-only status, capability/origin denial, explicit
missing hints, unavailable/malformed storage, existing unknown payment state,
the pre-claim start race, and the compiled workerd country-rejection sequence.
The race produces one persisted attempt and one distinct provider session even
when more than one idempotent ensure call occurs. A changed basket remains
frozen. Existing tests retain foreign-cart hints, released/paid reconciliation,
and lost-response defenses.

A separate synthetic consumer check against the existing Template Store
controller confirms one prepare, one rejected start, then authoritative
no-attempt status restores `canStart` with the same retained capability.
No template source change is needed.

The full repository gate is `bin/verify-commerce full`; final command and
exact-revision review outcomes belong to the PR handoff. These are local
synthetic proofs, not hosted checkout or live-provider acceptance. No hosted
absence, deployment, installation, merge, or publication is claimed here.
