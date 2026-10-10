# Checkout contact foundation v1

This slice defines the bounded Commerce checkout contact contract and its
checkout orchestration integration. It does not send messages or alter payment
data.

## Input

`normalizeCheckoutContactInput` accepts exactly:

```ts
{ email: string; phone?: string; delivery?: CheckoutDeliveryAddress }
```

Email is required, trimmed, limited to ordinary bounded syntax and length, and
rejects control characters. Phone is an ordinary user-entered string capped at
64 characters; no E.164, country, or geographic assumptions are made. An empty
optional phone is omitted. Unknown fields, including account fields,
browser-supplied requirement flags, and browser-supplied revisions, are
rejected. No account is created or required.

`delivery` (GrillTrack `commerce-delivery-address-001`, commerce#33) is where a
physical order goes, exactly as the shopper typed it:

```ts
{ name: string; line1: string; line2?: string; city: string;
  region?: string; postalCode: string; country: string }
```

Each field is trimmed, at most 200 characters and free of control characters;
`line2` and `region` may be empty or absent and are then omitted; `country` is
a two-letter code stored upper case. Unknown fields are rejected. It is never
a billing address and no billing address is collected.

## Requirements and snapshot

`captureCheckoutContact` receives a trusted injected loader returning:

```ts
{ requirePhoneNumber: boolean; shippingCountries: string[]; revision: string | null }
```

`shippingCountries` is the store settings' list of physical shipping
destinations.

The loader is the boundary for the separately owned settings seam. A failed
or malformed loader result fails closed with a generic typed error; it never
downgrades an unavailable requirement to optional phone. The exact boolean and
revision, including `null` for an absent record, are copied into a
frozen snapshot:

```ts
{
  schema: "dinkuskit.commerce.checkout-contact/v1",
  contact: { email: string; phone?: string; delivery?: CheckoutDeliveryAddress },
  requirePhoneNumber: boolean,
  revision: string | null
}
```

Checkout captures the contact after Catalog's basket quote. When any line is
physical (a catalog item with no fulfillment mark counts as physical) the
address is required (`DELIVERY_REQUIRED`) and its country must be one of
`shippingCountries` (`DELIVERY_COUNTRY_UNAVAILABLE`); with no destinations set
a physical basket is refused. Both happen before any attempt is written or
Payments is called, and the guest routes answer `INVALID_CART` with that
message. A digital-only basket keeps no address even when one was sent. There
is no store setting for this; local pickup, if added later, is a shopper choice
under a new decision.

The snapshot and nested contact are detached and readonly. Checkout persists
the snapshot through its existing cart CAS and copies the same frozen metadata
to the canonical order. New guest attempts capture it after guest/cart/site
authorization and before the initial CAS or provider call. Existing active
attempts replay their frozen state without requiring new contact or current settings.
A new attempt after any released original must capture contact again; legacy
originals are preserved exactly.

The trusted `loadCheckoutContactRequirements(settings)` seam is owned by the
store-settings feature through its existing kernel boundary. This adds no
package subpath. Native and installed checkout bindings always use the
original plugin context settings; only unit execution ports may inject a
loader. Prepare exposes only `requirePhoneNumber` as a UI hint. Contact PII,
the settings revision, and contact metadata remain absent from public
projections.
