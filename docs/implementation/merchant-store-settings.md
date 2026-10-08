# Merchant store settings

Commerce stores one plugin-scoped `merchantStoreSettings` record through
EmDash `ctx.settings`. Writes use the record's opaque revision with
`compareAndSet`; there are no unconditional writes or competing stores.

The merchant may select a store country, an independent selling/customer
country list, and an independent physical shipping-destination list. Country
codes are recognized ISO 3166-1 alpha-2 values, normalized to uppercase and
deduplicated. On the first store-country save, an omitted list defaults to the
selected country. Later store-country changes preserve omitted lists. Explicit
empty lists mean that no countries are enabled.

`requirePhoneNumber` defaults to `false` and can be saved before a store
country exists. This feature records the requirement and exposes
`loadCheckoutContactRequirements`; it does not collect, verify, send, or
enforce phone contact data.

These country settings are not enforced by checkout yet. In particular, this
slice does not enforce billing or shipping country eligibility, IP eligibility,
address completeness, taxes, currency, consent, or fulfillment policy. It
never infers a country from locale, IP, or shipping origin.
