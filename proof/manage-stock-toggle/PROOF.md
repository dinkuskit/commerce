# Persisted Manage Stock toggle proof

## Scope

This proof covers GrillTrack decisions:

- `manage-stock-toggle-action-049`
- `manage-stock-enable-path-050`
- `manage-stock-disable-path-051`
- `manage-stock-concurrency-052`

Commerce baseline:
`8ca3e5dd14264df6db21bf4bee778158b0357bd2`.

## Verified result

- The private `catalog-items/set-manage-stock` POST action requires
  `content:edit_any` and accepts only `catalogItemId` and boolean
  `manageStock`.
- Enabling an unmanaged product persists `managed` / `setup-required` with no
  local quantity, increments `manageStockRevision`, and does not register a
  SKU or take an opening balance.
- Enabling an already-managed product is idempotent.
- Disabling persists `unmanaged` on the catalog item only, preserves
  `creationIntent` and `manageStockRevision`, leaves manual availability and
  backorder policy untouched, and releases reconstructable registration claims.
- Configure Inventory re-reads the catalog row before persist and aborts with
  `MANAGE_STOCK_REQUIRED` when the product is unmanaged or the revision no
  longer matches the revision captured at action start.
- Exact EmDash 0.40.1 storage reopen restores dormant manual `out-of-stock`
  after a live enable, Configure Inventory, and disable cycle without
  contacting Inventory.

## TDD receipts

First red/green command:

```text
npm run build && node --test tests/features/catalog/set-manage-stock.test.mjs
```

Second command:

```text
npm run build && node --test tests/features/inventory-setup/inventory-setup.test.mjs
```

## Real runtime receipt

The redacted synthetic transcript is retained at:

```text
proof/manage-stock-toggle/live-runtime.txt
```

The exact EmDash 0.40.1 storage repository persisted enable, Inventory
registration, disable, claim release, and dormant manual availability across
close/reopen.

No customer, tenant, credential, account, or production data is present.

Artifact integrity:

- `live-runtime.txt`: 1006 bytes
- `live-runtime.txt` SHA-256:
  `32bd4ed5d35f8eeb8d33bd195362dbffc7cec470e6c935bd21038f4923218712`

## Verification receipt

Final command:

```text
CI=1 bin/verify-commerce full
```

Final result: exit `0`.

- TypeScript typecheck passed.
- Unit suite: 97 passed, 0 failed.
- Public repository contract: clean.
- Feature boundary contract: clean.
- Integration suite: 19 passed, 0 failed.
- Exact EmDash 0.40.1 storage proved enable, Configure Inventory, disable, claim
  release, and dormant manual `out-of-stock` across repository close/reopen
  without Inventory contact.
- Existing catalog, managed availability, atomic claim, permanent site
  identity, and Wrangler/D1 proofs remained green.

Manifest command:

```text
sha256sum -c proof/manage-stock-toggle/source-manifest.sha256
```

Immutable reviewed-source identity:
`sha256:c9a03e9dc27f76ab2a2b073664febf9f1d0d4b9656dd427c0cf69bf75c06b700`.

## Blast radius

| Surface | Risk | Evidence |
| --- | --- | --- |
| Persisted Manage Stock choice | High | enable, disable, idempotency, input allowlist, permissioned route, and EmDash reopen |
| Isolated manual availability | High | toggle does not write the manual collection; dormant `out-of-stock` returns after disable |
| Configure Inventory persist | High | mid-flight disable and disable-then-enable abort stale registration writes |
| Inventory side effects | High | disable releases only reconstructable Commerce claims; no quantity or SKU mutation |
| Visual admin / template-store | Deferred | no UI, click-selectors, or template-store catch-up in this slice |

## Fidelity limits and deferrals

This slice does not add visual EmDash UI, template-store catch-up, live
cross-plugin transport, Blocks rendering, cart or checkout enforcement,
reservations, order states, pool migration, npm publish, or deployment.
EmDash pin and PR 2768 are unchanged.
