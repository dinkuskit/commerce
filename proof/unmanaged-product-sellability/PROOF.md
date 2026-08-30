# Unmanaged product sellability proof

## Scope

This proof covers GrillTrack decisions:

- `unmanaged-availability-model-044`
- `unmanaged-availability-default-045`
- `unmanaged-state-transition-046`
- `manual-control-managed-boundary-047`
- `unmanaged-quantity-display-boundary-048`

Commerce baseline:
`94c9c314686807ac43ac63d0c66671f57e259453`.

## Verified result

- Commerce accepts exactly `in-stock`, `out-of-stock`, or
  `available-on-backorder` as manual availability for an unmanaged product.
- A missing manual record defaults to `in-stock` without a migration write.
- The private `catalog-items/set-manual-availability` POST action requires
  `content:edit_any`, accepts only catalog item ID and status, and returns a
  conflict when Manage Stock is enabled.
- Manual availability has its own keyed collection. Its writes never rewrite
  the catalog row, Inventory binding, managed registration state, or managed
  backorder policy.
- The saved value remains dormant during managed operation and returns after
  management is disabled. Commerce never copies Inventory quantity or a
  derived managed status into it.
- `resolveStorefrontAvailability` returns the existing structured schema for
  both authorities. Unmanaged products never emit quantity or `low-stock` and
  never read Inventory configuration, display policy, managed backorder
  policy, or provider state.
- Managed products never read or fall back to dormant manual availability,
  including incomplete setup and storage/provider failure.
- Missing is distinct from untrustworthy storage: lookup failure or malformed
  manual state returns `availability-unavailable` and is not sellable.
- The existing managed-only resolver and its behavior remain available for
  current consumers.

## TDD receipts

First red command:

```text
npm run build && node --test tests/features/catalog/manual-availability.test.mjs
```

Observed red result: exit `1` because `dist/index.js` did not provide
`CATALOG_MANUAL_AVAILABILITY_COLLECTION`. The focused catalog test then passed
all five cases after the minimal persistence and route implementation.

Second red command:

```text
npm run build && node --test tests/features/storefront-availability/storefront-availability.test.mjs
```

Observed red result: exit `1` because `dist/index.js` did not provide
`resolveStorefrontAvailability`. The focused resolver suite then passed the
manual-state matrix, authority isolation, restoration, compatibility, and
fail-closed cases.

## Real runtime receipt

The redacted synthetic transcript is retained at:

```text
proof/unmanaged-product-sellability/live-runtime.txt
```

The exact EmDash 0.35 storage repository persisted an explicit
`out-of-stock` value, closed, reopened, and resolved that product as not
sellable without contacting Inventory.

No customer, tenant, credential, account, or production data is present.

Artifact integrity:

- `live-runtime.txt`: 959 bytes
- `live-runtime.txt` SHA-256:
  `8ba170b10d65805196cb34df03746a5f616254f9070a8f04d3f2c701a8d965aa`

## Verification receipt

Final command:

```text
CI=1 mise exec node@22.23.2 -- bin/verify-commerce full
```

Final result: exit `0`.

- TypeScript typecheck passed.
- Unit suite: 89 passed, 0 failed.
- Public repository contract: clean.
- Feature boundary contract: clean.
- Integration suite: 18 passed, 0 failed.
- Exact EmDash 0.35 storage proved that manual `out-of-stock` survives
  repository close/reopen and resolves without Inventory contact.
- Existing catalog, managed availability, atomic claim, permanent site
  identity, and Wrangler/D1 proofs remained green.

Manifest command:

```text
sha256sum -c proof/unmanaged-product-sellability/source-manifest.sha256
```

The manifest covers every changed implementation, test, feature-map, verifier,
and product-document file in this slice. GrillTrack state and proof files are
excluded because they are workflow evidence rather than runtime source.

Immutable reviewed-source identity:
`sha256:dd8da6adba088acd8faafc05d6d2768dd35019eb596bda8947d7d37f38853d37`.

## Blast radius

| Surface | Risk | Evidence |
| --- | --- | --- |
| Persisted manual sellability | High | strict input, identity, idempotency, corruption, failure, and EmDash reopen cases |
| Managed Inventory authority | High | full prior matrix plus explicit proof that active and incomplete managed states never read or fall back to manual state |
| Private admin action | High | POST-only, `content:edit_any`, exact field allowlist, managed conflict, and no catalog-row writes |
| Public resolver contract | Medium | additive unified export; existing managed-only export and tests retained |
| Storefront quantity display | Medium | exact and threshold settings are proven unread and quantity is absent for every manual state |
| Blocks and mounted websites | Deferred | no source change, rendering, live connector, or mounted compatibility claim in this slice |

## Fidelity limits and deferrals

This slice does not add visual EmDash UI, a persisted Manage Stock toggle
action, live cross-plugin transport, Blocks rendering, cart or checkout
enforcement, reservations, order states, pool migration, or deployment.
`setManageStock` remains a pure transition; a future persisted toggle must
define cross-record concurrency before claiming live mutation proof.

No push, pull request, merge, deployment, package publication, account change,
or production mutation was performed by this implementation step.
