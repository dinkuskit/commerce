# Catalog product identity and host page lookup

Commerce owns the permanent product identity and product facts. `itemId` is
minted once when a catalog item is created and never changes. SKU is a
merchant-facing attribute: it remains unique while assigned, but it may be
edited through the authenticated `catalog-items/set-sku` route. Orders and
integrations key on `itemId`, not SKU.

Commerce exposes the same filtered projection through:

- `GET catalog/public` with the existing opaque `cursor`; and
- `GET catalog/public/item?itemId={itemId}` for one bounded lookup.

The single-item response is one product object or `null`. It includes only
the authoritative `id` (`itemId`), name, current SKU, customer-facing price,
availability, and the existing live media projection. Missing, unpriced,
non-listable, and fail-closed managed items return `null`. Both routes are
`no-store`. Neither route returns a page, slug, URL, publication state, or CMS
field.

The host owns the explicit page contract. Its resolver accepts the returned
`itemId` and returns one canonical published page reference or no reference.
The host must atomically enforce these invariants:

1. A published product entry claims one `itemId`, and an `itemId` has at most
   one published entry.
2. A competing publish is rejected or flagged and excluded; it is never
   selected by ordering or “first match”.
3. Unpublishing or deleting the canonical entry returns no page. A draft is
   not an implicit fallback.
4. Resolve, publish, and unpublish observe the same serialized/transactional
   state, so simultaneous publishes have one deterministic winner.

Routing, slugs, redirects, and page content are intentionally outside this
Commerce contract. A slug is a host URL attribute and changing it does not
change `itemId`, SKU, or existing orders.
