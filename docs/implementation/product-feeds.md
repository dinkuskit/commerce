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
eligibility, listability, a price, a published URL, or a title. For a product with
options, these checks apply to each concrete member's price and listability,
not a root/from price. Family eligibility and published content still gate all
members. Unpriced/nonlistable members are omitted; listable sold-out members
remain present with their own availability. A family never becomes a separate
offer, even if the caller supplied a root price. Older host projections that
omit option definitions but retain member selections are also recognized.
Optional GTIN, MPN, brand, shipping, description, and images are never invented.

For a complete RSS 2.0 document, call `buildGoogleMerchantFeed(rows, { channel })`
with the public store's `title`, canonical home `link`, and `description`. These
three escaped elements appear directly in `<channel>`, even if no rows qualify.
The title and description must contain only XML 1.0 characters. Use `now` in
the options to supply a clock for date-based tests. The former
`(rows, now?)` call still returns its original item-only channel for compatibility;
update public feeds to supply metadata rather than guessing it from a product.
Every item carries `g:condition` `new` (Commerce has no used or refurbished
condition, and the Meta CSV already sends `new`). When an item has neither a
GTIN nor a brand plus MPN, it carries `g:identifier_exists` `no`, the channel's
explicit no-identifier signal, instead of an invented identifier;
`buildMetaCatalogFeed` emits deterministic CSV. Availability follows the
JSON-LD mapping per channel: a backorder product is Google `backorder` and Meta
`available for order` (never `preorder`, which means not yet released). A
Google backorder row also carries `g:availability_date` from the variant's
expected ship date (`backorderShipDate`: still ahead and at most a year away);
a backorder row without one is left out of the Google feed, which requires it.
The
first image URL is the main image; the rest are sent as additional image links
(up to 10 for Google, 20 for Meta, the channels' limits). `pageProductFeedRows` provides
a bounded cursor contract for hosts that page their catalog reads. These
builders are host-side exports and are intentionally not imported by
`src/plugin.ts`, keeping them outside the Registry backend size cap.

## Variant rows and landing pages

Variant row `id` (and Meta `retailer_id`) is the permanent member `catalogItemId`;
`item_group_id` is the permanent family `productId`, not a mutable SKU. The title
adds the member's option/value labels. Google also carries `item_group_title`
and repeated `variant_option` name/value pairs. Standard option labels Color,
Size, Material, Pattern, Age group and Gender (case/whitespace normalized) are
projected into the corresponding standard channel fields; arbitrary labels stay
in the title and Google's generic option fields, never invented XML tags or
Meta columns. Values are preserved, not translated or certified against a
channel's taxonomy. Meta adds group/standard-attribute columns only when its
output contains variant rows, preserving the existing simple-only CSV shape.
Family brand and host content/images may be shared. Public members do not carry
GTIN/MPN, so those identifiers are omitted for every variant row, including a
default member whose ID equals the family ID; another member's identifiers must
never be copied.

The host can supply `content.variantUrls`, a map from concrete member ID to a
published URL that preselects that member, for example
`{ "tee-l": "https://shop.example.test/products/tee?item=tee-l" }` when that is
the host's own selection contract. Commerce does not invent query syntax. An
explicitly empty member URL omits that member. When a URL is absent, the builder
retains the supplied family canonical URL for older hosts; **hosts must supply
preselected URLs for variant landing-page parity**. This is not a Merchant Center
or Meta admission validator, and emitting rows is not proof of channel approval.

Channel reference: Google's [item group ID](https://support.google.com/merchants/answer/6324507)
and [variant option](https://support.google.com/merchants/answer/17085214) describe
separate member identities, grouping, option pairs and matching landing pages.

A storefront host should read paged `catalog/public` data, join each item with
its published page projection, pass `product.feedChannels ?? []` as the feed
builder's `eligibility`, call the appropriate
builder, and serve the result at its own public route (for example
`/feeds/google-merchant.xml` or `/feeds/meta-catalog.csv`). The host owns HTTP
delivery, caching, and route policy; feed output contains only public product
data.
