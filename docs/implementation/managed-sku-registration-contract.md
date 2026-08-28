# Managed-SKU registration contract

This slice defines the provider-neutral Commerce contract for connecting a
managed catalog item to one SKU record in the store's selected inventory pool.
It does not call DinkusKit Inventory. A later adapter will translate this
contract to Inventory's transport and persistence APIs.

## Ownership boundary

Commerce owns the catalog item's canonical SKU, product title, `Manage stock?`
choice, store-level provider binding, and persisted setup state. Inventory owns
the pool-wide SKU record, its permanent opaque identity, its operational
display name, and every stock quantity and receipt.

Registration establishes identity only. It carries no location, quantity,
unit, balance, reservation, receipt, or stock mutation. The store's default
fulfillment location remains in `InventoryProviderBinding` for a later,
separate Set Initial Stock action.

## Public contract

```ts
interface ManagedSkuRegistrationInput {
  sku: string;
  productTitle?: string | null;
}

interface ManagedSkuRegistrationRequest {
  poolId: string;
  sku: string;
  displayNameIfNew: string;
}

interface InventorySkuIdentity {
  inventorySkuId: string;
  sku: string;
  displayName: string;
}

type ManagedSkuRegistrationResult =
  | { outcome: "registered"; inventorySku: InventorySkuIdentity }
  | { outcome: "existing"; inventorySku: InventorySkuIdentity };

interface InventoryProviderPort {
  registerManagedSku(
    request: ManagedSkuRegistrationRequest,
  ): Promise<ManagedSkuRegistrationResult>;
}

type ManagedStockManagement =
  | { mode: "managed"; status: "setup-required" }
  | {
      mode: "managed";
      status: "needs-review";
      candidate: InventorySkuIdentity;
    }
  | {
      mode: "managed";
      status: "active";
      inventorySkuId: string;
    };
```

`createManagedSkuRegistrationRequest(binding, input)` returns only `poolId`,
the Commerce canonical SKU, and `displayNameIfNew`. A non-blank trimmed product
title supplies the one-time initial name; an absent or blank title falls back
to the SKU. An existing Inventory SKU ignores `displayNameIfNew`, so a second
store cannot rename the pooled item by connecting to it.

`normalizeManagedSkuRegistrationResult(value)` accepts only a known outcome
and non-empty opaque identity fields. It returns a clean value containing no
provider extras.

`applyManagedSkuRegistrationResult(current, expectedSku, result)` accepts only
`setup-required` managed state and a result whose visible SKU equals the
Commerce SKU being connected. A new registration becomes `active` and stores
only the permanent `inventorySkuId`. An existing SKU becomes `needs-review`
and retains the candidate identity for an explicit human decision.

`confirmExistingManagedSku(current)` accepts only `needs-review` and promotes
the candidate's permanent identity to `active`. It validates every candidate
identity field at runtime before activation, including values restored from
untyped persisted data. The later UI/adapter must show the current Inventory
stock read and revalidate it before invoking this confirmation. That stock read
is deliberately not copied into Commerce state.

## Persisted-state compatibility

The identity-bearing `active` representation supersedes the pre-release
status-only representation. Catalog reads preserve valid managed states. A
legacy `active` record without a non-empty `inventorySkuId`, or another
malformed managed state that cannot satisfy the current union, is returned as
`managed` / `setup-required`. Commerce never invents an Inventory identity and
never exposes malformed state as active. The user must complete explicit fresh
registration before stock management becomes active again.

Missing stock-management state on a pre-policy catalog record retains the
existing unmanaged compatibility behavior. Valid identity-bearing `active`
records and valid `needs-review` candidates are preserved.

## Lifecycle and invariants

```text
unmanaged
  -> setup-required             enable Manage Stock
  -> unmanaged                  disable Manage Stock

setup-required
  -> active                     Inventory registered a new SKU
  -> needs-review               Inventory found the SKU already in the pool
  -> unmanaged                  disable Manage Stock

needs-review
  -> active                     user confirms the same pooled item
  -> unmanaged                  disable Manage Stock

active
  -> unmanaged                  disable Manage Stock
```

- `active` is impossible without a non-empty permanent Inventory SKU identity.
- Legacy identity-less active state fails safe to `setup-required` on read.
- A malformed review candidate cannot be promoted to active.
- `existing` never becomes authoritative without explicit confirmation.
- A result for a different visible SKU fails closed.
- Re-enabling Manage Stock starts fresh at `setup-required`; Commerce does not
  silently reuse a discarded link.
- Later Commerce title changes do not rename Inventory. Later Inventory name
  changes do not alter Commerce or storefront titles.
- The active link stores the stable identity, not a copy of Inventory's name or
  visible SKU, so either display value can evolve without breaking the link.
- Registration and every state transition contain no Commerce-local stock.

## Zero-implementation review

The change affects the exported and persisted `StockManagement` union, the
catalog replay fixture that represents an advanced managed item, both package
entry points, the inventory-provider tests, feature ownership documentation,
and proof. This is a high-risk public-state change even though the functions
are local and pure.

Inventory `origin/main` at
`e32ac165cae5efd78390bee1f0306754aa7fabbb` already accepts opaque `skuId`
values in location and aggregate stock reads but intentionally has no SKU
registration API. The future adapter may map Commerce's `inventorySkuId` to
that provider field. This slice makes no cross-repository compatibility claim
and does not change Inventory.

Required regression proof is:

- unchanged unmanaged and `setup-required` creation behavior;
- request naming fallback and omission of location/quantity fields;
- strict result validation and provider-extra stripping;
- new registration to active identity;
- existing registration to review, then explicit confirmation;
- rejection of wrong-SKU and out-of-order transitions;
- disable/re-enable behavior with an identity-bearing active state;
- package-root and feature-entry export parity;
- legacy identity-less active replay to `setup-required` while valid active
  replay remains active;
- malformed persisted review-candidate rejection before activation;
- the full Commerce verifier after focused tests pass.

## Explicit exclusions

No admin UI, popup, OAuth, pool discovery, binding persistence, live Inventory
transport, SKU creation inside Inventory, quantity read, location selection,
opening balance, stock mutation, checkout, deployment, or production change is
implemented here.
