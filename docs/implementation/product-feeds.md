# Product feeds and channel eligibility

Issue [#60](https://github.com/dinkuskit/commerce/issues/60) adds a
Commerce-owned, per-product opt-in record. The initial closed channel list is
`google-merchant` and `meta-catalog`; new products have no channels enabled.
`itemId` is the permanent feed identity, while SKU remains an editable
merchant-facing attribute.

The host supplies published storefront facts for each item: canonical
`/products/{slug}` URL, title, description, and public image URLs. Commerce
supplies the `catalog/public` product projection, including authoritative
customer price and availability. The feed builders omit products without
eligibility, listability, a price, a published URL, or a title. Optional GTIN,
brand, shipping, description, and image values are emitted only when supplied.

`buildGoogleMerchantFeed` emits deterministic RSS 2.0 with Google `g:` fields;
`buildMetaCatalogFeed` emits deterministic CSV. `pageProductFeedRows` provides
a bounded cursor contract for hosts that page their catalog reads. These
builders are host-side exports and are intentionally not imported by
`src/plugin.ts`, keeping them outside the Registry backend size cap.

A storefront host should read paged `catalog/public` data, join each item with
its published page projection and eligibility record, call the appropriate
builder, and serve the result at its own public route (for example
`/feeds/google-merchant.xml` or `/feeds/meta-catalog.csv`). The host owns HTTP
delivery, caching, and route policy; feed output contains only public product
data.
