# Atomic catalog saves (Commerce #203)

Owner decision: keep the repair in Commerce (option A), accepted 2026-10-27.
Base: e4da1218bc429d469442e5e6a807c7f46856e65b; EmDash 1.2.0.

A product's catalog record holds a versioned `catalogData` value with per-member
price, manual availability and shipping-weight overrides, plus product feed
eligibility. A save changes this value with one conditional write. Product,
choice and SKU identities remain unchanged. Inventory remains stock authority.

Legacy records are read when a field has never been saved in the new value.
The first successful save of that field makes the new value authoritative;
an explicit null means cleared, never fall back. Failed or refused saves do
not migrate anything. Legacy rows are retained, not dual-written or deleted.
All shipped readers/writers must use the catalog-aware kernel. Old binaries
must not run concurrently or be installed over the new version: they do not
understand the new authority. A downgrade needs an explicit export/conversion,
not an automatic fallback. Historic order snapshots remain unchanged.

A form carries the product revision it displayed. Validation precedes a single
compare-and-set; a conflict changes nothing and asks for a reload. Rendering
failure after an acknowledged commit returns a truthful saved result with a
reload action. An unknown write outcome is reported as unknown and requires a
read before resubmission. The limits remain 50 choices and 1 MiB encoded JSON;
oversize state is rejected before persistence. No new sandbox capabilities.

## Focused evidence (checked 2026-10-27)

| Source | Relevant pattern | Application and limit |
| --- | --- | --- |
| [EmDash storage](https://docs.emdashcms.com/plugins/creating-plugins/storage/#conditional-writes), 1.2.0 source | CAS applies to one key; fields requiring atomicity belong in one value | Adopt as the actual runtime boundary. Cloudflare `putMany` is sequential and is not a replacement. |
| [commercetools general concepts](https://docs.commercetools.com/api/general-concepts#resource-updates), current API docs | Multiple actions on one versioned resource succeed or fail together; stale versions conflict | Adapt the product revision and save boundary, not its broader catalog model. A server error can still leave a write outcome unknown. |
| [Shopify productSet](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/productSet), 2026-10 | Product changes share one operation; synchronous and asynchronous outcomes are distinct; omitted scalar fields remain unchanged | Adapt explicit patch and outcome semantics. Its list replacement behavior and inventory mutations are not adopted. These docs alone do not establish its database transaction implementation. |
| [WooCommerce REST v3 products](https://woocommerce.github.io/woocommerce-rest-api-docs/#products), current official reference | Product editing and product batch operations are distinct APIs | Do not equate a batch endpoint with a transaction. Full reference retrieval was unavailable; no atomicity claim is based on it. |

commercetools is included for its explicit resource-version/atomic-update
contract. BigCommerce reference retrieval was unavailable, so no claim about
its atomicity is made. No private vendor code or captured merchant data is used.

The [organization vision](https://github.com/dinkuskit/.github/blob/main/VISION.md)
and [scope](https://github.com/dinkuskit/.github/blob/main/ROADMAP.md) require one
authoritative owner, initialized-state upgrade proof, Registry fit and truthful
recovery. This changes persistence, not product/variant identity, physical stock
ownership, checkout pricing rules or the scope of supported products.

## Verification contract

Prove legacy read-through, explicit clears, all-or-nothing faults, stale-form
conflicts, concurrent edits, repeated same-value saves, post-commit render
failure and unknown write outcomes. Repeat the deployed stock-10 and 32 matrix
with an exact candidate artifact and inspect persisted state independently.
Preserve open/archive, tenancy, unmanaged stock and Registry size constraints.
