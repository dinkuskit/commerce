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
rows are excluded. No caller-supplied collection, namespace, price or settings
are accepted.

The response is:

```ts
type PublicCatalogResponse = {
  cursor?: string;
  products: readonly {
    id: string;
    name: string;
    sku: string;
    price: { currency: "USD"; minor: string };
    availability: {
      status: "in-stock" | "low-stock" | "out-of-stock" |
        "available-on-backorder" | "availability-unavailable";
      sellable: boolean;
      listable: boolean;
    };
  }[];
};
```

Only products with an authoritative customer price and `availability.listable`
are projected. The price is `customerPays` (sale when present, otherwise
regular), and availability is resolved by the existing storefront rules.
Managed products remain fail-closed when their configured provider is absent or
unavailable. Storage records, stock-management flags, settings, coupon,
checkout, order, and provider fields are never returned.

Consumers select `products[].id` and send `{ lines: [{ catalogItemId: id,
quantity }] }` plus an optional `couponCode` to the canonical guest checkout
`prepare` then `start` routes. The public projection is display/listing data
only; checkout re-resolves authoritative catalog price and availability.

Installation prerequisites are the original runtime plugin identity and
declared Commerce storage namespace, a configured product and authoritative
price, and the existing storefront availability configuration. Registry
identity, installation flags, native aliases, and test overrides do not imply
readiness. The shipped capabilities and allowed hosts remain empty, so this
route does not activate Payments or make external checkout available.

The compiled package exports `readPublicCatalog(ctx, cursor?)` and
`PUBLIC_CATALOG_ROUTE` from `@dinkuskit/commerce/features/catalog`. Call the reader
only with the original runtime-owned context; it is not an installation verifier.
The sandbox handler is the supported public consumer boundary. This slice adds
no native storage alias or cross-plugin context construction.

Products retain the current price/listing rules, including the existing draft
state behavior. Publication and slugs are a later slice. Managed products have
`availability-unavailable` and `sellable: false` with the currently absent
Inventory read boundary; no local-stock fallback is introduced.

The installed HTTP/browser fixture proves authenticated admin creation/pricing,
anonymous catalog/cart selection and canonical prepare. With the shipped empty
grants and unconfigured Payments, start returns `PAYMENTS_UNAVAILABLE` and writes
no checkout/order aggregate. The compiled workerd/SDK fixture separately exercises
canonical coupon-adjusted payment/order/receipt behavior with synthetic intercepted
issuer/provider transport. Neither fixture proves a signed Registry release,
hosted identity, real Stripe TEST readiness, shipping checkout or scheduler.
