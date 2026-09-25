# Persisted Manage Stock toggle

This slice gives a shop owner a durable `Manage stock?` choice after a catalog
item exists. It does not add visual EmDash UI, live Inventory transport,
template-store catch-up, cart, checkout, or deployment.

## Action

The private `catalog-items/set-manage-stock` route requires `content:edit_any`
and accepts exactly:

```json
{ "catalogItemId": "catalog-item-id", "manageStock": true }
```

Commerce loads the catalog row, applies the existing `setManageStock`
transition, and persists `stockManagement` on that row. `creationIntent.manageStock`
remains the immutable create-command input.

## Enable

Turning Manage Stock on for an unmanaged product persists:

```json
{ "mode": "managed", "status": "setup-required" }
```

and increments `manageStockRevision`. There is no local quantity, SKU
registration, or opening balance. Configure Inventory remains the separate
next action. Enabling an already-managed product is idempotent and preserves
its current managed status and revision.

## Disable

Turning Manage Stock off persists `{ "mode": "unmanaged" }` on the Commerce
catalog item only. Inventory pool SKUs and quantities are not deleted, renamed,
or adjusted. Manual availability, managed backorder policy, and the store
binding are not rewritten, so dormant manual availability returns. Reconstructable
managed-SKU registration claims for that catalog item are released so a later
enable can start fresh reconciliation.

## Cross-record concurrency

The toggle read-modify-writes catalog `stockManagement` and
`manageStockRevision`, plus reconstructable claim deletes on disable. Isolated
collections stay isolated.

Configure Inventory re-reads the catalog item before each persist. If the
product is unmanaged or `manageStockRevision` no longer matches the revision
captured at action start, persist aborts with `MANAGE_STOCK_REQUIRED` and does
not resurrect stale registration state.
