# Atomic managed-SKU registration plan

Status: implemented, verified, and reviewed; GrillTrack closure awaits confirmation

## Boundary

Commerce owns the decision that one catalog product and one setup generation
may have only one winning managed-SKU registration operation. Inventory remains
the owner of the pool-wide SKU record and stock truth.

The `dinkus.inventory-provider` feature will own:

- a provider-neutral claim port;
- an EmDash storage adapter for that port;
- orchestration that contacts Inventory only for the winning claim;
- structured concurrent-attempt outcomes and pool-name feedback copy.

It will not own admin rendering, pool discovery, live Inventory transport,
stock quantities, checkout, orders, fulfillment, or deployment.

## Storage contract

The plugin declares a `managedSkuClaims` collection with unique
indexes on `claimKey` and `operationId`.

Each append-only claim record contains:

```ts
interface ManagedSkuRegistrationClaimRecord {
  recordKind: "managed-sku-registration-claim";
  recordId: string;
  claimKey: string;
  catalogItemId: string;
  operationId: string;
  request: ManagedSkuRegistrationRequest;
  createdAt: string;
}
```

`recordId` is independent from `operationId`, so an accidental reuse of one
operation ID cannot silently overwrite an existing row through storage upsert
semantics.

`claimKey` identifies one product setup generation. The initial key is derived
from the catalog item ID. A corrected submission after definitive rejection is
derived from the catalog item ID and rejected operation ID, allowing a new
operation while retaining append-only history. Later re-enable flows may supply
a new durable setup-generation key; defining that transition is outside this
slice.

## Port and outcomes

```ts
interface ManagedSkuRegistrationClaimInput {
  claimKey: string;
  catalogItemId: string;
  registration: ManagedSkuRegistration;
}

type ManagedSkuRegistrationClaimResult =
  | { outcome: "claimed"; claim: ManagedSkuRegistrationClaimRecord }
  | { outcome: "existing"; claim: ManagedSkuRegistrationClaimRecord };

interface ManagedSkuRegistrationClaimPort {
  claim(
    input: ManagedSkuRegistrationClaimInput,
  ): Promise<ManagedSkuRegistrationClaimResult>;
}

type StartManagedSkuRegistrationResult =
  | { outcome: "started"; state: ManagedStockManagement }
  | {
      outcome: "already-claimed";
      state: SetupPendingManagedStockManagement;
      sameRequest: boolean;
    };
```

`StartManagedSkuRegistrationExecution` receives `catalogItemId`, `claimKey`,
and the claim port in addition to the existing provider, persistence callback,
and ID factory.

The old persistence-only start path will not remain available. The package is
private at `0.0.0`, and the blast-radius search found no active external callers;
keeping the unsafe path would violate the confirmed invariant.

## State and concurrency sequence

1. Validate the existing Commerce state and construct the proposed pending
   operation.
2. Ask the claim port to atomically create its append-only record.
3. If the result is `existing`, return the winner as `already-claimed`. Do not
   persist the losing proposal and do not call Inventory.
4. If the result is `claimed`, persist that same pending state to the owning
   Commerce record before contacting Inventory.
5. Contact Inventory with the winning operation and persist the result through
   the existing retry-safe state machine.
6. If claim authority or claim recovery is ambiguous, throw
   `REGISTRATION_CLAIM_UNAVAILABLE` before any persistence callback or provider
   call. The caller maps that code to: `Inventory setup is temporarily
   unavailable. Please try again.`

The adapter treats only an exact named unique-index violation as concurrency
proof. After a `claimKey` conflict it must query exactly one valid winner. Zero,
multiple, malformed, or mismatched records fail closed.

The adapter proves both declared unique indexes are live before accepting a
claim. An in-process mutex or ordinary last-write-wins `put` is never accepted
as atomic authority.

## Feedback contract

The domain exposes pure feedback generation that receives a current pool name
from the future setup/discovery adapter; the authoritative binding continues to
persist only opaque provider, pool, and location identities.

- Pending: `This product is already being connected to {poolName} in another
  session. Refresh to check its status.`
- Complete: `This product was connected to {poolName} in another session.
  Refresh to review its inventory settings.`
- Action label: `Refresh status`

No pool display name is persisted as stock or binding authority.

## Blast radius and proof

Affected source contracts:

- `startManagedSkuRegistration` and `StartManagedSkuRegistrationExecution`;
- inventory-provider root and feature exports;
- plugin storage declarations;
- the local retry proof tool and registration tests;
- feature map and registration contract documentation.

Risk classification:

- exported start contract: medium;
- new EmDash storage collection and unique indexes: high;
- pure feedback formatter: low.

Required proof:

- a failing unit test before implementation;
- same-request contenders converge on one operation and one provider call;
- different-pool contenders retain the winner and report `sameRequest: false`;
- missing or ambiguous atomic authority causes zero provider calls and leaves
  the prior state untouched;
- corrected resubmission uses a distinct generation key and operation ID;
- exact EmDash 0.35 `PluginStorageRepository` multi-process proof;
- local Wrangler/D1 unique-index proof;
- complete `bin/verify-commerce full`, feature audit, and diff checks.
