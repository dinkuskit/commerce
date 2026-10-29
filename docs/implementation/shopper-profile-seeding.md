# Shopper profile seeding from kept orders

The verified `shopper-accounts-v1-20261020` contract keeps shopper profiles in
Commerce storage, separate from EmDash staff users. Its saved delivery address
uses `normalizeCheckoutDelivery`; its phone uses `normalizeCheckoutContactInput`.

Orders kept before strict checkout-contact admission may contain contact
objects that the current paid-order receiver would reject. Listing those kept
orders remains supported; it must not turn raw legacy fields into customer
records that the next account read rejects.

`projectShopperOrder` validates the effective delivery address and phone
independently using the existing shared normalizers. Missing or invalid fields
project as `null`; structurally valid fields are normalized. A bad phone does
not suppress a valid address, nor does a bad address suppress a valid phone.
The owner's corrected delivery address takes precedence over the checkout copy.
Phone syntax validation uses the same placeholder-email technique as account
profile edits; historical email formatting must not suppress a usable phone.
Verified-email linking remains unchanged. Normalization changes the shopper
projection, never the kept order or its frozen paid snapshot.

This does not apply new-checkout eligibility to history. In particular, shared
address normalization still permits an absent or unrestricted historical US
region. Current shipping-country settings are not retroactively applied.

The existing account seeder selects the newest available field when a saved
field is unset. A projected `null` is not seeded; an older usable field can be
selected instead. An explicitly saved or cleared field is not replaced by this
process. Saving `null` through the account form remains durable.

Already malformed **customer** records still fail closed with `UNAVAILABLE`.
This repair prevents new invalid seeds from legacy orders; it is not a
migration, an automatic repair of previously poisoned profiles, or permission
to rewrite customer/order data. No OTP, session, origin, role, storage-schema,
checkout-admission or payment behavior changes.

Tests cover public installed account handlers and the compiled Registry
backend in local workerd with the SDK's SQLite repositories and an email sink.
These are synthetic fixtures, not external Registry installation, SMTP delivery,
a deployed storefront or live provider proof.
