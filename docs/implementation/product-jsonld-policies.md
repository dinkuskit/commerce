# Product/Offer JSON-LD

Parent tracker: [#61](https://github.com/dinkuskit/commerce/issues/61). Spec:
[#59](https://github.com/dinkuskit/commerce/issues/59).

## Locked decisions

All five `#59` GrillTrack entries are **locked** (partial lock
[comment 6067853218](https://github.com/dinkuskit/commerce/pull/73#issuecomment-6067853218);
completing lock
[comment 6067898015](https://github.com/dinkuskit/commerce/pull/73#issuecomment-6067898015)):

| ID | Lock |
| --- | --- |
| `jsonld-availability-low-stock-059` | `low-stock` → `LimitedAvailability` |
| `jsonld-availability-unavailable-059` | Emit `Offer` with `OutOfStock` (never omit; never `InStock`) |
| `jsonld-optional-identifiers-059` | Optional `gtin`, `mpn`, and `brand` |
| `jsonld-policy-records-059` | Versioned `store_shipping_policy` / `store_return_policy` (superseded: see Store policies) |
| `jsonld-builder-export-059` | Host export `@dinkuskit/commerce/features/structured-data` |

Follow-ups remain **proposed** (not this PR; 83-byte backend headroom):
`storefront-stock-qty-display-followup-059` and
`catalog-hide-oos-structured-data-followup-059`.

## Identity and host boundary

Lookups and structured-data inputs key on permanent `itemId` (see
[catalog-product-identity.md](catalog-product-identity.md)). SKU remains the
editable merchant attribute projected as schema.org `sku`. The host supplies
canonical URL, description, and absolute image URLs. Commerce never reads CMS
or page state.

## Optional identifiers

The product panel's identifiers form and the `catalog` route's `identifiers` op (the native-only `catalog-items/set-identifiers` route is gone, `commerce-one-build-registry-20261031`) write optional `gtin` (validated
GTIN-8/12/13/14 with check digit), `mpn`, and `brand` onto the catalog item.
Public `catalog/public` and `catalog/public/item` project only present fields.
Native Products admin exposes the fields; unset means omitted.

## Store policies

A store's shipping and returns policies are its EmDash pages, written by the
merchant; Commerce keeps no policy records (`policy-pages-are-content-20261031`,
Ronald, 31 Oct 2026, superseding `jsonld-policy-records-059`). The
`store_shipping_policy` and `store_return_policy` collections, the public
`policies/public` read and the `@dinkuskit/commerce/features/store-policies`
export are gone. Nothing ever wrote them on the Registry build, and the shipping
record repeated the charge and free-over held in the DinkusKit checkout settings
and the destinations held by `merchant-selling-countries-002`.

Structured shipping and return terms are deferred. When they come, shipping
markup derives from the checkout settings and the shipping destinations, not a
separate record. When UCP checkout is built, its required policy links carry
the store's EmDash policy page URLs. A storefront may name its published
returns page as the store-wide return policy by link only; that markup is the
storefront's.

## JSON-LD builder

```ts
import { buildProductJsonLd } from "@dinkuskit/commerce/features/structured-data";

const jsonLd = buildProductJsonLd({
  product, // public catalog projection (by itemId)
  page: { url, description?, images? },
});
```

Pure function: no network, no storage. The Offer carries no `shippingDetails`
or `hasMerchantReturnPolicy`, and `assertProductJsonLdShape` refuses an Offer
that does. Keep this export out of `src/plugin.ts` so it stays outside the
Registry sandbox backend byte budget.

For an editorial product preview without a linked Commerce item, use the
host-only page-facts builder:

```ts
import { buildProductPreviewJsonLd } from "@dinkuskit/commerce/features/structured-data";

const jsonLd = buildProductPreviewJsonLd({
  url: "https://shop.example.test/products/preview-hat",
  name: "Preview hat",
  description: "A forthcoming wool hat", // optional
  images: ["https://cdn.example.test/preview-hat.jpg"], // optional
});
```

The host supplies the canonical URL and a nonempty display name. Only those
page facts appear: no SKU, GTIN, MPN, brand, price, availability, or `Offer` is
invented. This metadata does not make the preview sellable. Use
`buildProductJsonLd` with the public Commerce projection
for a linked product. The existing `assertProductJsonLdShape` validates that
SKU-bearing Commerce output; it is not a preview validator. Both builders
remain outside the Registry sandbox graph.

## Availability → schema.org

- `in-stock` → `InStock`
- `low-stock` → `LimitedAvailability`
- `out-of-stock` → `OutOfStock`
- `available-on-backorder` → `BackOrder`
- `availability-unavailable` → `OutOfStock`

Offer `price` is `customerPays` as an exact decimal from integer minor units
(sale when present).

## Registry backend size (matched installs, Node 22.23.2 / npm 10.9.8)

| Build | `dist/sandbox/plugin.mjs` bytes | Headroom vs 131072 |
| --- | ---: | ---: |
| Main tip after #75 (coupons deferred) | 102045 | 29027 |
| This slice (with sandboxed `policies/public`) | 102792 | 28280 |

The JSON-LD builder stays on the host export and is not in the sandbox graph.
Optional identifier projection remains in the public catalog. The sandboxed
`policies/public` read this table measured is gone
(`policy-pages-are-content-20261031`).
