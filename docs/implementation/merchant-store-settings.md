# Merchant store settings

Commerce stores one plugin-scoped `merchantStoreSettings` record through
EmDash `ctx.settings`. Writes use the record's opaque revision with
`compareAndSet`; there are no unconditional writes or competing stores.

The merchant may select a store country, an independent selling/customer
country list, and an independent physical shipping-destination list. Country
codes are recognized [ISO 3166-1 alpha-2](https://www.iso.org/iso-3166-country-codes.html) values, normalized to uppercase and
deduplicated. On the first store-country save, an omitted list defaults to the
selected country. Later store-country changes preserve omitted lists. Explicit
empty lists mean that no countries are enabled.

`requirePhoneNumber` defaults to `false` and can be saved before a store
country exists. This feature records the requirement and exposes
`loadCheckoutContactRequirements`. Checkout consumes that requirement when
capturing contact; these settings do not verify phone ownership or send messages.

Checkout checks the shipping-destination list for a new physical checkout;
with no destinations enabled, a physical basket is refused before payment.
The admin form shows only the store country, shipping destinations and the
phone requirement (`merchant-selling-countries-002`). The stored
`sellingCountries` list keeps its record shape and first-save default so older
records and seeds still load, but no form edits it and nothing enforces it;
a submitted value is ignored. See [checkout contact](checkout-contact-v1.md) for address capture and the
separate US region check. These settings do not infer a country from locale,
IP, or shipping origin, collect a billing address, or determine taxes or currency.


Native Store and Registry Settings render the same BlockKit form. The native
section uses the supported private `admin` route with `/store` in each request,
so the host supplies declared-page UI context. Both transports require the existing
`content:edit_any` permission and host authentication/CSRF/scope checks. A conflict
retains the draft and its original revision; Reload saved settings is explicit.
The existing catalog/placeholder settings are preserved.

The server getter accepts only `settings.getVersioned` and returns
`{ requirePhoneNumber: boolean, shippingCountries: readonly string[], revision: string | null }`.
A missing record returns false/[]/null; a malformed or unreadable record throws
`STORAGE_UNAVAILABLE`. Contact capture uses this same authority. Digital-only
checkout does not require country setup; physical checkout needs an enabled
shipping destination.
