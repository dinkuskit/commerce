# Product and variant model boundary

The confirmed architectural decision `product-variant-model-20261008` uses one
product/variant model. The simple editor hides the single default variant;
merchants can introduce variant-defining choices when needed. This is a locked
direction, not an implemented variant system or agent API.

## Confirmed boundary

1. One product/variant model; simple editing hides the single default variant.
2. Optional variant-defining choices, separate from descriptive attributes.
3. Fulfillment defined independently for the purchasable variant.
4. Human UI and future agent tools share authoritative validation and identities.
5. Customizations, bundles, and protocol integrations remain later work.

Permanent Commerce `itemId` remains stable; SKU is editable merchant data, not
identity. EmDash/the host owns editorial publication and canonical page identity.
Commerce owns sellable identity, authoritative price and checkout/order authority.
Inventory remains optional under the existing managed/unmanaged rules; Commerce
does not gain a local physical stock ledger.

Descriptive attributes do not automatically create sellable combinations.
Variant-defining options select a purchasable variant. Future customizations are
a distinct concept; they are not a newly required modifier feature. Independent
fulfillment does not select product-to-variant inheritance or mixed-fulfillment
rules. No bundle eligibility flags are introduced.

## Reference check

Official documentation inspected October 8, 2026 informed the boundary:

- [Shopify ProductVariant](https://shopify.dev/docs/api/admin-graphql/latest/objects/ProductVariant)
  documents a default variant, selected options, variant pricing and inventory
  association. A simple-facing editor can use a sellable-variant model.
- [Shopify category metafields](https://help.shopify.com/en/manual/custom-data/metafields/category-metafields)
  describes structured attributes that can connect to variant options. This
  supports distinguishing descriptive attributes from variant-defining choices;
  it does not require a taxonomy implementation.
- [BigCommerce catalog overview](https://docs.bigcommerce.com/developer/docs/admin/catalog-and-inventory/products-overview)
  distinguishes variant options from modifiers such as embroidery. Modifiers
  do not change the fulfilled SKU/variant or have inventory per modifier-value
  combination. Its simple-product base variant is a reference representation,
  not an exact equivalence to this proposed architecture.
- [Shopify agent catalogs](https://shopify.dev/docs/agents/catalog) exposes catalog
  search/lookup and product details with selections and availability. These
  capabilities support structured product discovery; they do not grant paid or
  checkout authority.
- [BigCommerce MCP overview](https://docs.bigcommerce.com/developer/api-reference/mcp/overview/)
  and [B2C reference](https://docs.bigcommerce.com/developer/api-reference/mcp/storefront/b2c)
  were identified in the coordinated reference review. Independent retrieval
  exceeded the page-size limit; no current Beta status or tool inventory from
  those pages is independently asserted here.

These references informed the confirmed distinction. They do not select another
platform's identifiers, migration, defaults, tax rules or protocols for Commerce.

## Current source and next bounded implementation

At main `938cb06cc6c0a1e7f457e514076d608219e38c65`, catalog records support only
`simple-product`; checkout lines use `catalogItemId`. PR62 preserves permanent
item identity and provides canonical shopper-safe list and item lookup. There
is no option/variant system, fulfillment classification, contact/address capture
or general agent operation API. This decision does not complete [issue33](https://github.com/dinkuskit/commerce/issues/33).

The existing readers are already typed and exported. The smallest possible
additional foundation is an **in-process catalog tool contract**, only when a
concrete consumer needs stable named operation descriptors, strict input schemas
and a host-bound dispatcher. A duplicate wrapper with no consumer adds no value.
These descriptors frame list/item lookup for tool discovery and invocation using
the same installed
`PluginContext`, `readPublicCatalog` and `readPublicCatalogItem`, with existing
cursor, identity, price/availability, storage and installation validation. Return
the exact existing public projections. The readers do not enforce EmDash
publication: canonical published page selection remains the explicit host
resolver boundary. A tool reader cannot claim a product is published or invent
a storefront URL. Introduce no second catalog, price or
order engine, public route, permission grant or protocol server. Mutations and
new variant selections remain outside this foundation.

Proposed source-owner reservation for that future slice:

- New `src/features/catalog/tool-contract.ts`: typed read operations that delegate
  to the current public readers and reject unsupported/tampered invocation input.
- `src/features/catalog/kernel/index.ts`: additive exports; current
  `src/features/catalog/index.ts` already re-exports the kernel.
- New `tests/features/catalog/tool-contract.test.mjs`: compare tool/UI reader
  output and failures for exact itemId, cursor, malformed/extra input, unavailable
  context, and managed Inventory unavailability. Do not resolve by editable SKU.
- `FEATURE_MAP.md` and one focused implementation contract/proof: record this
  adapter's limits; retain full repository gate and the 131,072-byte sandbox cap.

Dependencies are PR62's current public readers and existing authority boundaries.
No new product migration/default, variant ID mapping, inheritance, geography or
phone/contact policy is needed for these read operations. The coordinator can
route this build under the confirmed scope after identifying its concrete tool
consumer and receiving narrow path-release confirmation against existing catalog
writers. Until then Grok retains the earlier reservation; this document does not
release it. In-process tool descriptors do not establish an agent-ready storefront
or Registry endpoint. This document does not implement or publish the adapter.

Remaining real choices before a broader product/checkout change: map preserved
existing item identity to product/default-variant identity; choose explicit legacy
classification/default/migration; settle fulfillment inheritance and mixed-cart
behavior; then define variant-specific price/stock behavior without inferring it
from the architectural lock. Routine module names, export wiring and delegation
to existing validation do not require reopening the five-point decision.

Issue33's selected contact/address direction remains separate: billing for all
orders, physical shipping additionally required before payment, digital-only no
shipping request, explicit unchecked-by-default billing-copy control, required
email without account creation, phone-required toggle off by default, and audited
merchant shipping corrections without changing paid money. This recording does
not silently lock geography, disclosure consent/PII retention, guest projections,
receipt sending or those choices' complete implementation contract.

Bootstrap63 owns AGENTS, ignore rules, scripts/agent-skills and GrillTrack scripts;
this decision branch does not modify them. Template34 and Inventory remain with
their existing owners. Host/Registry authority and authenticated PDF delivery
remain external dependencies; tool descriptors cannot bypass them.
