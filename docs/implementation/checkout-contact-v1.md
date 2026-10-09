# Checkout contact foundation v1

This slice defines the bounded Commerce checkout contact contract and its
checkout orchestration integration. It does not send messages or alter payment
data.

## Input

`normalizeCheckoutContactInput` accepts exactly:

```ts
{ email: string; phone?: string }
```

Email is required, trimmed, limited to ordinary bounded syntax and length, and
rejects control characters. Phone is an ordinary user-entered string capped at
64 characters; no E.164, country, or geographic assumptions are made. An empty
optional phone is omitted. Unknown fields, including account fields,
browser-supplied requirement flags, and browser-supplied revisions, are
rejected. No account is created or required.

## Requirements and snapshot

`captureCheckoutContact` receives a trusted injected loader returning:

```ts
{ requirePhoneNumber: boolean; revision: string | null }
```

The loader is the boundary for the separately owned settings seam. A failed
or malformed loader result fails closed with a generic typed error; it never
downgrades an unavailable requirement to optional phone. The exact boolean and
revision, including `null` for an absent record, are copied into a
frozen snapshot:

```ts
{
  schema: "dinkuskit.commerce.checkout-contact/v1",
  contact: { email: string; phone?: string },
  requirePhoneNumber: boolean,
  revision: string | null
}
```

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
