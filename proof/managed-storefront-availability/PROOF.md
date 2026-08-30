# Managed storefront availability proof

## Scope

This proof covers GrillTrack decisions:

- `storefront-stock-display-policy-037`
- `product-backorder-policy-038`
- `managed-inventory-unavailable-policy-039`
- `incomplete-managed-setup-availability-040`
- `structured-storefront-availability-041`
- `default-fulfillment-location-availability-042`
- `backorders-opt-in-default-043`

Commerce baseline:
`530348c07769a010b0fa4ef24604292a4254eda0`.

Inventory alignment baseline (read only):
`86da623e0a21f174636cd833f8faf932ba219721`. Commerce mirrors its
`dinkuskit.inventory.sku-stock-read-result/v1` location-scoped read contract
through a provider-neutral port and does not import Inventory source or select
a transport.

## Verified result

- The default store policy returns `in-stock` or `out-of-stock` without
  exposing quantity.
- Store owners can persist exact-quantity display or a positive integer
  low-stock threshold through a private `content:edit_any` action.
- Each product can opt into backorders through a separate private action. A
  missing policy record means backorders are off.
- Display policy and backorder policy use dedicated collections. Their writes
  do not rewrite the store Inventory binding or catalog item, so they cannot
  clobber simultaneous fulfillment-location or managed-SKU state changes.
- Commerce requests Inventory's authoritative `available` quantity for the
  configured pool, Inventory SKU, and default fulfillment location only.
- Positive stock is sellable. Zero or negative stock is out of stock unless
  backorders are explicitly enabled, in which case it is available on
  backorder.
- Incomplete managed setup, absent configuration, unavailable provider,
  not-found stock, wrong response identity, and malformed quantity or location
  results all return `availability-unavailable` with `sellable: false`.
  Backorder policy never overrides this fail-closed state.
- The stable result is structured as `status`, `sellable`, and an optional
  exact string quantity; storefront wording remains outside Commerce.

## TDD receipt

Red command:

```text
npm run build && node --test \
  tests/features/storefront-availability/storefront-availability.test.mjs
```

Observed red result: exit `1` because `dist/index.js` did not provide the new
`STOREFRONT_AVAILABILITY_RESULT_SCHEMA` export. This was the expected missing
contract before implementation.

Focused green verification ultimately passed all 78 unit tests, including the
new policy matrix, strict input rejection, isolated persistence, response
identity validation, and fail-closed provider cases.

## Real runtime receipt

The redacted synthetic transcript is retained at:

```text
proof/managed-storefront-availability/live-runtime.txt
```

The exact EmDash 0.35 storage repository was written, closed, reopened, and
read again. It retained threshold `5` and `allowBackorders: true`; Commerce
then queried the Murphy default location and resolved available quantity `5`
to `low-stock`.

No customer, tenant, credential, account, or production data is present.

Artifact integrity:

- `live-runtime.txt`: 1062 bytes
- `live-runtime.txt` SHA-256:
  `446dcb17385ca21c462f752773d45fce7f9123de6d6dc86a06e50d5758e4ed29`

## Verification receipt

Command:

```text
CI=1 mise x node@22.23.2 -- bin/verify-commerce full
```

Final result: exit `0`.

- TypeScript typecheck passed.
- Unit suite: 78 passed, 0 failed.
- Public repository contract: clean.
- Feature boundary contract: clean.
- Integration suite: 17 passed, 0 failed.
- Exact EmDash 0.35 storage proved the policy records survive repository
  reopen and drive the location-scoped availability result.
- Existing catalog, claim, store-identity, and Wrangler/D1 proofs remained
  green.

Manifest command:

```text
sha256sum -c proof/managed-storefront-availability/source-manifest.sha256
```

The manifest covers every changed implementation, test, feature-map, package,
and product-document file in this slice. GrillTrack state and proof files are
excluded because they are workflow evidence rather than reviewed runtime
source.

Immutable reviewed-source identity:
`sha256:0a7c8379c571bedf6ff9315d50e99a5a38e72142db60990058dd31cc8b2636b4`.

## Blast radius

| Surface | Risk | Evidence |
| --- | --- | --- |
| Managed sellability | High | explicit positive, zero, negative, backorder, unavailable, wrong-identity, and malformed-response matrix |
| Inventory authority boundary | High | exact Inventory v1 schema alignment; location-only query; no Commerce quantity persistence or fallback |
| Policy persistence | High | exact EmDash 0.35 repository close/reopen proof and isolated-collection unit assertions |
| Private admin actions | Medium | POST-only, exact-input rejection, authenticated EmDash permission, and public-entry tests |
| Existing catalog and setup | Medium | complete existing unit and integration suites remain green; policy writes leave their records untouched |
| Blocks and mounted websites | Deferred | no source change, rendering, live connector, or compatibility claim in this slice |

## Fidelity limits and deferrals

This is the Commerce backend half. It does not prove a mounted-site UI, live
cross-plugin transport, Blocks rendering, cart or checkout enforcement,
reservation timing, order-state transitions, pool migration, Cloudflare OAuth,
or a production deployment. Manual unmanaged-product sellability also remains
a later Commerce slice.

No commit, push, pull request, merge, deployment, package publication, account
change, or production mutation was performed by this implementation step.
