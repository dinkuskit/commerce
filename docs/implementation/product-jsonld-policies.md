# Product/Offer JSON-LD and single-source shipping/return policies

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
| `jsonld-policy-records-059` | Versioned `store_shipping_policy` / `store_return_policy` |
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

Authenticated `catalog-items/set-identifiers` writes optional `gtin` (validated
GTIN-8/12/13/14 with check digit), `mpn`, and `brand` onto the catalog item.
Public `catalog/public` and `catalog/public/item` project only present fields.
Native Products admin exposes the fields; unset means omitted.

## Store policies

| Collection (sandbox / native) | Contents |
| --- | --- |
| `store_shipping_policy` / `storeShippingPolicy` | Charge fields matching `TrustedShippingConfiguration` plus optional destination countries, handling/transit day bounds, policy page URL |
| `store_return_policy` / `storeReturnPolicy` | Optional MerchantReturnPolicy-mapped fields plus policy page URL |

Each record is singleton `active` with a monotonic `revision`. Public
`GET policies/public` returns both. Native authenticated
`settings/shipping-policy` and `settings/return-policy` write them. Unset
fields are omitted — never invented.

Checkout continues to resolve shipping charges from installed checkout settings
in this slice. Draft PRs #68–#70 (merchant country / US delivery) overlap on
destination vocabulary; this slice does not invent US-wide defaults from those
drafts.

## JSON-LD builder

```ts
import { buildProductJsonLd } from "@dinkuskit/commerce/features/structured-data";

const jsonLd = buildProductJsonLd({
  product, // public catalog projection (by itemId)
  page: { url, description?, images? },
  policies: await readPublicStorePolicies(ctx), // or host-held copies
});
```

Pure function: no network, no storage. Keep this export out of `src/plugin.ts`
so it stays outside the Registry sandbox backend byte budget.

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
| Main tip after #88 (delivery address landed) | 119448 | 11624 |

The JSON-LD builder stays on the host export and is not in the sandbox graph.
Optional identifier projection remains in the public catalog. After #75 restored
Registry headroom, sandboxed `GET policies/public` is mounted again so policy
pages and JSON-LD share the same revision in Registry installs. Hosts and native
installs may still use `@dinkuskit/commerce/features/store-policies`
(`readPublicStorePolicies` / `readPublicStorePoliciesFromStorage`).

The #88 delivery-address change is included in the measured main tip above;
the backend remains below the 131,072-byte cap with 11,624 bytes of headroom.
