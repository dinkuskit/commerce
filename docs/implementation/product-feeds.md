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
eligibility, listability, a price, a published URL, or a title. Optional GTIN, MPN,
brand, shipping, description, and image values are emitted only when supplied.

`buildGoogleMerchantFeed` emits deterministic RSS 2.0 with Google `g:` fields.
Every item carries `g:condition` `new` (Commerce has no used or refurbished
condition, and the Meta CSV already sends `new`). When an item has neither a
GTIN nor a brand plus MPN, it carries `g:identifier_exists` `no`, the channel's
explicit no-identifier signal, instead of an invented identifier;
`buildMetaCatalogFeed` emits deterministic CSV. Availability follows the
JSON-LD mapping per channel: a backorder product is Google `backorder` and Meta
`available for order` (never `preorder`, which means not yet released). The
first image URL is the main image; the rest are sent as additional image links
(up to 10 for Google, 20 for Meta, the channels' limits). `pageProductFeedRows` provides
a bounded cursor contract for hosts that page their catalog reads. These
builders are host-side exports and are intentionally not imported by
`src/plugin.ts`, keeping them outside the Registry backend size cap.

A storefront host should read paged `catalog/public` data, join each item with
its published page projection and eligibility record, call the appropriate
builder, and serve the result at its own public route (for example
`/feeds/google-merchant.xml` or `/feeds/meta-catalog.csv`). The host owns HTTP
delivery, caching, and route policy; feed output contains only public product
data.
