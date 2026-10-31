# Installed public catalog contract

The installed sandbox artifact exposes `GET catalog/public` as a public route.
Its handler runs in the original Commerce `PluginContext`, using the same
`catalog_items`, `catalog_prices`, storefront availability collections, and
runtime plugin namespace used by the Products admin and guest checkout.

The public HTTP path is `/_emdash/api/plugins/<runtime-plugin-id>/catalog/public`.
The route accepts only one optional `cursor` query parameter (1–1024 characters),
reads at most 50 storage rows per page, and sends `Cache-Control: no-store`.
Follow each returned opaque cursor until it is absent, including empty filtered
pages. A page can contain fewer than 50 products because unpriced/nonlistable
rows are excluded, and because a page stops early once its products' images
would take more than 16 Media Library reads (each image is a read of its own;
the next cursor resumes at the next product). Prices, stock and media records
for the page are read in a few batched calls, so one page stays inside the
plugin sandbox's subrequest limit however large the shop is. No caller-supplied
collection, namespace, price or settings are accepted.

The response uses the exported `PublicCatalogResponse` and
`PublicCatalogProduct` types from `@dinkuskit/commerce/features/catalog`.
Its public fields are:

```ts
type Money = { currency: "USD"; minor: string };
type Availability = {
  status: "in-stock" | "low-stock" | "out-of-stock" |
    "available-on-backorder" | "availability-unavailable";
  sellable: boolean;
  listable: boolean;
};
type Image = {
  id: string; alt: string; width: number | null; height: number | null;
  placeholder: boolean;
};
type PublicCatalogResponse = {
  cursor?: string;
  products: readonly {
    id: string;
    name: string;
    sku: string;
    price?: Money;
    availability: Availability;
    image: Image | null;
    gallery: readonly Image[];
    gtin?: string;
    mpn?: string;
    brand?: string;
    feedChannels?: readonly ("google-merchant" | "meta-catalog")[];
    page?: string;
    variants?: {
      schema: "dinkuskit.commerce.product-variants/v1";
      productId: string;
      options: readonly {
        optionId: string;
        label: string;
        values: readonly { valueId: string; label: string }[];
      }[];
      members: readonly {
        catalogItemId: string;
        selections: readonly {
          optionId: string; optionLabel: string;
          valueId: string; valueLabel: string;
        }[];
        price: Money | null;
        availability: Availability;
        fulfillment: "physical" | "digital";
      }[];
    };
  }[];
};
```

`image` and `gallery` carry EmDash media ids resolved live through the
`media:read` capability; the storefront host maps ids to public file URLs and
builds `srcset` with the exported Commerce preset helpers. See
[product-media.md](./product-media.md).

`feedChannels` contains only merchant-approved public feed channel ids from
the existing eligibility record. Unset or empty eligibility returns `[]`;
adapters without the eligibility collection omit the field. Both mean no
opt-in. The single-item route has the same field and rules. See
[product-feeds.md](./product-feeds.md).

A simple product needs an authoritative customer price and listable
availability. Its price is `customerPays` (sale when present, otherwise regular).
A product with choices is projected as one family containing its priced,
listable members; it has no top-level `price` and its top-level `sellable` is
false. Use the selected member's own price and availability, not the family's
status or a price inferred from another member. Unpriced or nonlistable members
are omitted, and a family with no projected members is omitted. A simple
product can carry a hidden one-member descriptor with `options: []`; it retains
its ordinary top-level price. See [variant-checkout-v1.md](./variant-checkout-v1.md).

Managed products remain fail-closed when their configured provider is absent or
unavailable. Storage records, stock-management flags, settings, coupon,
checkout, order, and provider fields are never returned. Optional GTIN, MPN and
brand are catalog identifiers, not invented host metadata. `page` is the EmDash
entry id recorded by the host's last publish check, not a slug, URL or CMS
publication-state record. The host still resolves the published canonical page.

For a simple product, send its `id` as `catalogItemId`. For a product with
choices, select a sellable member and send that member's `catalogItemId`:
`{ lines: [{ catalogItemId, quantity }] }`, plus an optional `couponCode`, to the
canonical guest checkout `prepare` then `start` routes. Do not purchase a family
without choosing a member or invent every option × value combination. The
public projection is display/listing data only; checkout re-resolves
authoritative catalog price and availability.

Installation prerequisites are the original runtime plugin identity and
declared Commerce storage namespace, a configured product and authoritative
price, and the existing storefront availability configuration. Registry
identity, installation flags, native aliases, and test overrides do not imply
readiness. A public catalog read does not activate Payments or establish
checkout readiness, regardless of the installed plugin's other capabilities or
network allowlist. See [installed-checkout-context.md](./installed-checkout-context.md)
and [installed-checkout-services.md](./installed-checkout-services.md) for the
separate checkout requirements.

The compiled package exports `readPublicCatalog(ctx, cursor?)` and
`PUBLIC_CATALOG_ROUTE` from `@dinkuskit/commerce/features/catalog`. Call the reader
only with the original runtime-owned context; it is not an installation verifier.
The sandbox handler is the supported public consumer boundary. The native
build mounts the same two routes (GrillTrack
`catalog-native-public-routes-001`) with the same query rules, response and
`no-store` caching. Its handler maps the native camelCase storage names onto
the collection names the shared reader expects, and builds no cross-plugin
context.

Archived, Draft and nonlistable products stay off the public catalog. The
host's publish check changes Commerce's on-sale state and records the page link;
Commerce does not read CMS content or decide a canonical slug. Managed products
have `availability-unavailable` and `sellable: false` with the currently absent
Inventory read boundary; no local-stock fallback is introduced.

The original installed HTTP/browser fixture covers authenticated admin
creation/pricing, anonymous catalog/cart selection and canonical prepare. In its
unconfigured Payments setup, start returns `PAYMENTS_UNAVAILABLE` and writes no
checkout/order aggregate; that is a fixture result, not the capability manifest
of every current release. The compiled workerd/SDK fixture separately exercises
canonical coupon-adjusted payment/order/receipt behavior with synthetic
intercepted issuer/provider transport. Neither fixture proves a signed Registry
release, hosted identity, real Stripe TEST readiness, shipping checkout or
scheduler.

## Single-item identity lookup

`GET catalog/public/item?itemId={itemId}` is the bounded single-item form. It
returns one product object or `null` and uses the same grouped projection,
price, listability, availability, managed fail-closed, and media rules as the
paginated route. It also sends `Cache-Control: no-store`.

A concrete variant member lookup resolves to its public family, whose `id` can
differ from the requested member id. To refresh a cart line, locate the requested
`catalogItemId` in `variants.members` and use that member's current price,
availability and fulfillment. Do not discard a valid family solely because its
`id` differs from the requested member, or use its absent top-level price as the
member's price. If the requested member is absent, do not substitute a sibling.
This also applies when refreshing from the paginated catalog: its rows are
families, not a flat list of separately listed members.

Alternatively, `GET catalog/public/item?pageId={entryId}` resolves the product
that page's last publish check sells. It returns `null` when that product is off
the shop or another page has since taken it. Supply exactly one of `itemId` or
`pageId`. A successful response carries the same optional `page` entry id as the
list route, but no slug, URL or CMS publication state. The host's explicit page
resolver owns canonical published-page selection. See
[catalog-product-identity.md](./catalog-product-identity.md).
