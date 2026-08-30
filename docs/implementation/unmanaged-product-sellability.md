# Unmanaged product sellability

This slice completes Commerce's backend storefront-availability contract for
products whose Manage Stock setting is disabled. It does not add a visual
EmDash control, a persisted Manage Stock toggle action, Inventory transport,
Blocks rendering, checkout enforcement, or deployment.

## Manual availability

Commerce supports exactly three manual states:

| Manual state | Storefront status | Sellable | Quantity |
| --- | --- | --- | --- |
| `in-stock` | `in-stock` | yes | never |
| `out-of-stock` | `out-of-stock` | no | never |
| `available-on-backorder` | `available-on-backorder` | yes | never |

A missing record means `in-stock`. This is the compatibility default for both
new products and legacy catalog rows and does not require a migration write.
Exact and threshold display settings apply only when Inventory supplies an
authoritative managed quantity; they never manufacture a count or
`low-stock` state for an unmanaged product.

## Isolated persistence and action

Each explicit choice is stored in the dedicated
`catalogManualAvailability` collection under the catalog item ID. The private
`catalog-items/set-manual-availability` action requires
`content:edit_any`, accepts only `catalogItemId` and a supported `status`, and
rejects non-POST methods. It loads current `stockManagement.mode` from the
server-owned catalog row and returns `MANAGE_STOCK_ENABLED` with conflict
status when the product is managed.

The manual record is separate from the catalog row, store Inventory binding,
and managed-product backorder policy. Changing it cannot overwrite an
Inventory registration transition. The separate managed backorder setting
continues to decide what zero authoritative Inventory stock means; it is not
rewritten by a manual `available-on-backorder` choice.

## Unified resolution

`resolveStorefrontAvailability` loads the catalog item once and selects one
authority:

- Managed products use the existing Inventory-backed path. They never read or
  fall back to manual availability, including during incomplete setup or
  provider failure.
- Unmanaged products read only their manual availability. They do not read the
  Inventory binding, display settings, managed backorder policy, or provider.

Both paths return
`dinkuskit.commerce.storefront-availability-result/v1`. The existing
`resolveManagedStorefrontAvailability` export remains unchanged for current
consumers that deliberately accept managed products only.

Manual-record lookup failure or malformed persisted state returns
`availability-unavailable` with `sellable: false`; it is not confused with a
missing record, which safely means `in-stock`.

## Manage Stock transitions

The manual record remains dormant while Manage Stock is enabled. If management
is disabled later, the unified resolver reads the same saved value; it never
copies an Inventory quantity or derived managed status into Commerce.

The current repository exposes `setManageStock` as a pure transition but has
no authenticated persistence action for that toggle. A future toggle action
must define its cross-record atomicity before it can claim concurrent mutation
proof. This slice proves the authority switch and dormant-state restoration
without expanding into that future action.
