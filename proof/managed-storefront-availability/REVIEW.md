# Managed storefront availability exact-source review

## Review identity

Reviewed source manifest:
`proof/managed-storefront-availability/source-manifest.sha256`.

Immutable source identity:
`sha256:0a7c8379c571bedf6ff9315d50e99a5a38e72142db60990058dd31cc8b2636b4`.

The manifest was verified with `sha256sum -c` immediately before and after the
final full verification. Its file list exactly matches all changed source,
test, package, feature-map, and product-document files after excluding
GrillTrack state and proof artifacts.

## Standards review

Result: clean; no open findings.

- Feature imports cross boundaries only through public `index.ts` entries.
- The package root composes both new private actions and declares their
  dedicated EmDash storage collections.
- Browser inputs are exact and bounded; alternate fields and non-POST methods
  are rejected.
- The actions retain EmDash `content:edit_any` permission and are not public.
- Display and backorder writes cannot overwrite catalog managed-SKU state or
  the store Inventory binding because each policy has its own keyed record.
- Provider responses are checked against the requested schema, pool, SKU,
  location scope, complete stock shape, unit consistency, and matching location
  stock before Commerce uses `available`.
- No credentials, auth material, customer data, provider transport, or fallback
  stock ledger were introduced.
- Repository and feature audits, typecheck, unit tests, integration tests, and
  `git diff --check` are clean.

## Source-intent review

Result: clean; all seven locked decisions remain represented.

- Status-only is the missing-record default.
- Exact and positive-integer threshold modes expose quantity only when allowed.
- Backorders are per product and opt-in.
- Zero or negative authoritative available stock is out of stock unless the
  product explicitly allows backorders.
- Missing or unprovable managed Inventory truth is unavailable and not
  backorderable.
- Incomplete managed setup fails closed before provider contact.
- The result is structured and customer wording stays with Blocks/storefront.
- Inventory is read only at the configured default fulfillment location.

## Resolved findings during implementation

1. `required_fix` — The first draft stored policy fields inside catalog and
   Inventory-configuration rows, which could clobber concurrent SKU-setup or
   location changes. Resolved by isolating both policy records and proving the
   original rows receive no writes.
2. `required_fix` — Strict Inventory-result validation exposed an integration
   fixture with an empty location list. Resolved by making the fixture match
   Inventory v1's location-scoped `found` result and rerunning the full suite.

No finding remains deferred or requires a human gate inside this local
implementation cycle. Delivery and the later live connector/UI proof remain
separate work.
