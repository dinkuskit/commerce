# Configure Inventory action proof

## Scope

This proof covers GrillTrack decisions:

- `configure-inventory-entry-030`
- `store-inventory-binding-storage-031`
- `store-inventory-pool-change-032`
- `configure-inventory-runtime-boundary-033`
- `stable-commerce-site-identity-035`
- `configure-inventory-command-input-036`

Commerce baseline:
`9fd24c6a13a4a4d332109e2d4541b05ec5f83786`.

Inventory alignment baseline (read only):
`d31fbfda982ad669f638a222f0cb1caa7592c095`. Its `sku.register`
request and outcomes match the existing Commerce provider-neutral registration
contract. This slice does not import Inventory source or assume a transport.

## Verified result

- Commerce persists one active store configuration with a permanent,
  server-generated site ID, provider reference, pool ID, and default
  fulfillment-location ID.
- Concurrent first-time setup converges on one configuration and one site ID
  through an exact named EmDash unique index.
- The same binding replays idempotently. A default-location change retains the
  site ID. A provider or pool change returns `migration-required` without
  mutation.
- The private Configure Inventory route requires EmDash 0.35
  `content:edit_any` and accepts only `catalogItemId`.
- Commerce loads SKU, title, Manage Stock state, site, provider, pool, and
  location from server-owned storage.
- Missing store setup returns `inventory-setup-required` without provider
  resolution, registration claim, or catalog mutation.
- A complete setup runs the existing atomic managed-SKU registration flow
  through an injected `InventoryProviderPort` and persists the resulting
  catalog state.
- Pending, review-required, and active products do not start another
  registration.
- With no runtime provider installed, the action fails before claim or catalog
  mutation.

## TDD receipt

Baseline command:

```text
bin/verify-commerce quick
```

Result before source changes: exit `0`; 56 tests passed; repository and feature
audits clean.

Red command:

```text
npm run build && node --test \
  tests/features/inventory-setup/inventory-setup.test.mjs
```

Observed red result: exit `1` because `dist/index.js` did not provide the new
`CONFIGURE_INVENTORY_ROUTE` export. This was the expected missing-contract
failure before implementation.

Focused green result after the minimal implementation:

```text
10 tests passed; 0 failed
```

## Real runtime receipts

The redacted synthetic transcript is retained at:

```text
proof/configure-inventory-action/live-runtime.txt
```

It proves:

- two separate processes using the exact EmDash 0.35 storage repository
  converge on one permanent site identity;
- missing singleton uniqueness fails closed without a configuration row;
- the complete Configure Inventory action persists one configuration, one
  append-only registration claim, and one active catalog identity; and
- two local Wrangler/D1 processes enforce one configuration key and persist
  only one contender.

No customer, tenant, credential, or production data is present. All identities
are synthetic.

Artifact integrity:

- `live-runtime.txt`: 1656 bytes
- `live-runtime.txt` SHA-256:
  `33cd78f34dab5b75e711587005604890d604744f555c7d8536d22aca234a6599`

## Verification receipt

Command:

```text
CI=1 mise x node@22.23.2 -- bin/verify-commerce full
```

Result: exit `0`.

- TypeScript typecheck passed.
- Unit suite: 68 passed, 0 failed.
- Public repository contract: clean.
- Feature boundary contract: clean.
- Integration suite: 16 assertions passed, 0 failed.
- Exact EmDash 0.35 storage proved one permanent site identity across two
  processes and persisted the complete Configure Inventory action.
- Local Wrangler/D1 proved the singleton expression index across two
  processes.

Manifest command:

```text
sha256sum -c proof/configure-inventory-action/source-manifest.sha256
```

The manifest covers every changed implementation, test, feature-map, package,
and product-document file in this slice. GrillTrack state and proof files are
excluded because they are durable workflow evidence rather than reviewed
runtime source.

Immutable reviewed-source identity:
`sha256:9298a6b375d5b9fa42d72f790d9d8bd0757cd1ade32bf1f72034d7214b523073`.

## Blast radius

| Surface | Risk | Evidence |
| --- | --- | --- |
| Store identity and binding | High | singleton unique-index probe, two-process SQLite convergence, two-process Wrangler/D1 constraint proof |
| Catalog managed-stock state | High | full action persists pending then terminal state through the existing registration state machine |
| Private plugin route | High | exact-input rejection, method rejection, authenticated EmDash permission, provider-unavailable fail-closed test |
| Existing atomic claim | Medium | reused through its public entry; full existing claim suite remains green |
| DinkusKit Inventory | Deferred | contract alignment only; no source import, connector, credentials, or transport |
| Blocks and mounted websites | Deferred | no source changes or compatibility claim in this slice |

## Fidelity limits

This is the Commerce half of configuration and registration. It does not prove
a live cross-plugin call, Cloudflare OAuth, provider discovery, pool discovery,
visual setup UI, stock quantity, reservation, stock movement, checkout,
fulfillment, or pool migration. The provider resolver remains an injected,
replaceable boundary so the live connector can follow upstream EmDash decisions
without changing this stored Commerce contract.

No commit, push, pull request, merge, deployment, package publication, account
change, or production mutation was performed by this implementation step.
