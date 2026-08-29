# Retry-safe managed-SKU registration contract

This slice defines Commerce's provider-neutral orchestration for connecting a
managed catalog item to one SKU record in the selected inventory pool. The
provider port is executable, but live transport, authentication, and adapter
deployment remain separate work.

## Ownership boundary

Commerce owns the catalog SKU, product title, `Manage stock?` choice, provider
binding, hidden registration operation identity, and persisted setup state.
Inventory owns the pool-wide SKU record, permanent opaque `inventorySkuId`,
operational display name, and every stock quantity and receipt.

Registration establishes identity only. It carries no location, quantity,
balance, reservation, receipt, or stock mutation. The default fulfillment
location remains in `InventoryProviderBinding` for later stock operations.

## Public contract

```ts
interface ManagedSkuRegistrationRequest {
  poolId: string;
  sku: string;
  displayNameIfNew: string;
}

interface ManagedSkuRegistration {
  operationId: string;
  request: ManagedSkuRegistrationRequest;
}

type ManagedSkuRegistrationResult =
  | { outcome: "registered"; inventorySku: InventorySkuIdentity }
  | { outcome: "existing"; inventorySku: InventorySkuIdentity }
  | { outcome: "rejected"; code: string; message: string };

interface InventoryProviderPort {
  registerManagedSku(
    registration: ManagedSkuRegistration,
  ): Promise<ManagedSkuRegistrationResult>;
}

type ManagedStockManagement =
  | { mode: "managed"; status: "setup-required" }
  | {
      mode: "managed";
      status: "setup-pending";
      registration: ManagedSkuRegistration;
    }
  | {
      mode: "managed";
      status: "setup-needs-attention";
      registration: ManagedSkuRegistration;
      rejection: { code: string; message: string };
    }
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

`startManagedSkuRegistration` creates a proposed hidden operation ID and a
normalized, pool-scoped request snapshot, then requires a Commerce-owned
`ManagedSkuRegistrationClaimPort` before invoking `InventoryProviderPort`. The
claim is append-only and keyed to one catalog product setup generation. Its
EmDash adapter declares and actively proves unique `claimKey` and `operationId`
indexes. Exactly one contender receives `claimed`; every loser receives the
same stored winner as `already-claimed` and performs no persistence callback or
provider call.

The winning path persists `setup-pending` to the owning catalog item before
provider contact. If claim authority is absent, malformed, ambiguous, or cannot
prove its exact named unique constraints, Commerce throws
`REGISTRATION_CLAIM_UNAVAILABLE` before changing the prior state or contacting
Inventory. There is no in-process mutex or last-write-wins fallback.

Initial registration derives its generation key from the catalog item ID.
Corrected submission after a definitive rejection derives a distinct key from
the catalog item ID and rejected operation ID. Both generations retain their
append-only claim records, and the corrected request still requires a new
operation ID.

`retryManagedSkuRegistration` accepts only `setup-pending`, persists that same
snapshot again, and sends the same operation ID and request. It is the contract
behind the explicit **Retry connection** action. Reading or normalizing pending
state performs no provider call, and this slice contains no background retry
loop.

An adapter for
[Inventory PR #12](https://github.com/dinkuskit/inventory/pull/12) maps
`operationId` to Inventory `commandId`, adds Inventory-owned command envelope
fields, and maps the terminal result back to this provider-neutral union. The
candidate contract evaluated here is exact head
`670c539303ba77db916f50012070bdd83ead4e4e`.

## Outcome handling

- A thrown transport error or malformed result leaves the already-persisted
  operation `setup-pending`. The caller may present **Retry connection**.
- `registered` activates only the permanent `inventorySkuId` after validating
  that Inventory returned the requested visible SKU.
- `existing` becomes `needs-review`; `confirmExistingManagedSku` remains the
  only promotion from that state to active.
- `rejected` becomes `setup-needs-attention` and preserves the operation plus
  normalized code and message.
- Corrected resubmission starts from `setup-needs-attention`, must mint a
  different operation ID and claim generation, and persists the new snapshot
  before calling the provider. Changed payload is never sent under the rejected
  ID.
- If persisting a terminal result fails after Inventory succeeds, the durable
  pending snapshot remains safe to retry. Inventory's command replay returns
  the original terminal result.

## Persisted compatibility and lifecycle

```text
setup-required
  -> setup-pending             persist a new operation before provider call

setup-pending
  -> setup-pending             transport ambiguity, malformed response, reload
  -> active                    Inventory registered the SKU
  -> needs-review              Inventory returned an existing pooled SKU
  -> setup-needs-attention     Inventory definitively rejected the operation

setup-needs-attention
  -> setup-pending             corrected submission with a new operation ID

needs-review
  -> active                    user confirms the same pooled item

any managed state
  -> unmanaged                 disable Manage Stock
```

Stored pending and needs-attention states are preserved only when every
operation, request, and rejection field is a non-empty string of the expected
shape. Malformed state fails safe to `setup-required`. Valid active and
needs-review compatibility behavior remains unchanged. Re-enabling after
disabling starts fresh; if an earlier ambiguous call actually registered the
SKU, Inventory returns `existing` and Commerce requires confirmation.

The active link stores only the permanent Inventory identity. Commerce title
changes never rename Inventory, and Inventory display-name changes never alter
Commerce or storefront titles.

## Concurrent feedback

The concurrent result reports whether the losing request matches the winner.
Different settings never overwrite or replace the winning pool. A future UI
resolves the winning opaque pool ID to its current display name and presents:

- pending: `This product is already being connected to {poolName} in another
  session. Refresh to check its status.`
- complete: `This product was connected to {poolName} in another session.
  Refresh to review its inventory settings.`
- action: `Refresh status`.

Pool display names are not persisted as binding or stock authority.

## Verification contract

The executable proof covers:

- pending persistence before the first provider call;
- ambiguous failure followed by reload and exact-operation retry;
- terminal registration and genuine-existing confirmation paths;
- definitive rejection, needs-attention persistence, and new-ID resubmission;
- rejection of reused IDs, wrong-SKU results, malformed results, malformed
  stored attempts, and out-of-order transitions;
- omission of stock and location data from registration;
- same-request and different-pool contenders converging on one operation and
  one provider call;
- missing or ambiguous claim authority failing before provider contact;
- separate-process exact EmDash 0.35 and local Wrangler/D1 uniqueness proof;
- package-root and feature-entry export parity; and
- the complete Commerce verifier.

The proof does not claim live Inventory service-binding transport or an admin
setup surface. Those remain separate integration work.

## Explicit exclusions

No admin UI rendering, OAuth, pool discovery, binding persistence, live
Inventory transport, automatic retry scheduler, quantity read, location
selection, opening balance, stock mutation, checkout, deployment, or production
change is implemented here.
