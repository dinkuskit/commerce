# Product feeds and channel eligibility

Issue [#60](https://github.com/dinkuskit/commerce/issues/60) adds a
Commerce-owned, per-product opt-in record. The initial closed channel list is
`google-merchant` and `meta-catalog`; new products have no channels enabled.
`itemId` is the permanent feed identity, while SKU remains an editable
merchant-facing attribute.

The host supplies published storefront facts for each item: canonical
`/products/{slug}` URL, title, description, and public image URLs. Commerce
supplies the `catalog/public` and `catalog/public/item` product projection,
including authoritative customer price, availability, and `feedChannels`.
These public routes project only the approved `google-merchant` and
`meta-catalog` channel ids from the existing merchant eligibility record.
Unset or explicitly empty eligibility produces `[]`; older adapters without
the collection omit the field. Neither case enables a channel. Native routes
map `productFeedEligibility` to the same shared reader used by Registry's
`product_feed_eligibility` collection, and list reads batch this lookup.
No eligibility record metadata or admin-only product fields are exposed.
The feed builders omit products without
eligibility, listability, a price, a published URL, or a title. Optional GTIN, MPN,
brand, shipping, description, and image values are emitted only when supplied.

`buildGoogleMerchantFeed` emits deterministic RSS 2.0 with Google `g:` fields.
Every item carries `g:condition` `new` (Commerce has no used or refurbished
condition, and the Meta CSV already sends `new`). When an item has neither a
GTIN nor a brand plus MPN, it carries `g:identifier_exists` `no`, the channel's
explicit no-identifier signal, instead of an invented identifier;
`buildMetaCatalogFeed` emits deterministic CSV. Availability follows the
JSON-LD semantics per channel: `in-stock` and `low-stock` both emit `in stock`
in Google and Meta, since low stock is still available to buy. JSON-LD keeps
its more specific `LimitedAvailability` value for low stock; the feeds must
not turn that into `out of stock`. A backorder product is Google `backorder`
and Meta `available for order` (never `preorder`, which means not yet released).
`out-of-stock` and `availability-unavailable` remain `out of stock`. The
first image URL is the main image; the rest are sent as additional image links
(up to 10 for Google, 20 for Meta, the channels' limits). `pageProductFeedRows` provides
a bounded cursor contract for hosts that page their catalog reads. These
builders are host-side exports and are intentionally not imported by
`src/plugin.ts`, keeping them outside the Registry backend size cap.

A storefront host should read paged `catalog/public` data, join each item with
its published page projection, pass `product.feedChannels ?? []` as the feed
builder's `eligibility`, call the appropriate
builder, and serve the result at its own public route (for example
`/feeds/google-merchant.xml` or `/feeds/meta-catalog.csv`). The host owns HTTP
delivery, caching, and route policy; feed output contains only public product
data.
