# Atomic managed-SKU registration claim proof

Date: 2026-08-29

Commerce baseline: `4d8cd830d4aed625db54c2a79aaba3fbc75fe15a`

EmDash runtime and API peer: `0.35.0`

Inventory registration candidate: exact PR #12 head
`670c539303ba77db916f50012070bdd83ead4e4e`

## Confirmed slice

Commerce now owns an append-only first-registration claim for one catalog
product setup generation. The claim is acquired through a provider-neutral
port backed here by an EmDash storage adapter with unique `claimKey` and
`operationId` indexes. Exactly one contender may persist the winning claim and
contact Inventory. Every loser receives the stored operation and winning pool
request without persisting its proposal or calling Inventory.

The adapter proves both exact named unique indexes before accepting a claim.
Missing, malformed, ambiguous, or mismatched authority fails closed before the
Commerce state callback or Inventory provider runs. Corrected submissions after
a definitive rejection derive a new append-only generation key and still
require a new operation ID.

Pool-specific pending/complete feedback, `Refresh status`, and the exact
temporary-unavailability copy are exported as provider-neutral domain
contracts. Pool display names remain presentation input, not persisted stock or
binding authority.

## TDD receipt

The focused claim orchestration test first failed because the concurrent
feedback export did not exist. The storage-adapter test then failed because the
claim-port export did not exist. The separate-process integration test first
failed because the exact EmDash claim fixture did not exist. Each failure was
observed before its minimal implementation was added.

During source review, a final contract test first failed because the exact
temporary-unavailability feedback export did not exist. That repair also
separated invalid presentation input from a genuine claim-authority outage.

Focused green result:

```text
13 passed, 0 failed
```

It covers same-request and different-pool contenders, one provider call,
unavailable authority, malformed winners, corrected generations, exact copy,
one-operation reuse protection, ambiguous winner recovery, and exact named
constraint classification.

## Full verification

Command:

```text
mise x node@22.23.2 -- bin/verify-commerce full
```

Result:

- TypeScript no-emit check passed.
- Unit, contract, workflow, and feature tests: 56 passed.
- Integration tests: 12 passed.
- Public repository contract: clean.
- Feature contract: clean.
- Diff whitespace check: clean.
- Exact EmDash 0.35 two-process claim: one claimed, one joined, one persisted
  claim, one operation, one winning pool.
- Missing either declared claim index: fail closed with zero real claim rows.
- Two raw Wrangler/D1 processes: one write succeeded, one named-constraint
  rejection, one persisted claim.

Additional durable compatibility command:

```text
mise x node@22.23.2 -- npm run proof:registration-retry:real -- \
  <exact-inventory-pr12-worktree>
```

It used EmDash 0.35's real `PluginStorageRepository` and Inventory PR #12's
exact registration implementation. An intentionally lost first response left
one durable Commerce claim and pending operation; reopening both stores made
zero automatic provider calls, and explicit retry replayed the same Inventory
command to one active SKU without minting another identity.

The captured public-safe receipts are in [`RUNTIME.txt`](RUNTIME.txt). The
reviewed source is bound by
[`source-manifest.sha256`](source-manifest.sha256).

## Scope and remaining integration work

This proof does not claim admin UI, live Inventory transport, pool discovery,
binding persistence, stock mutation, checkout, delivery, deployment, or
production behavior.

If the winning process stops after the claim commits but before the catalog
item persists `setup-pending`, the append-only winner remains recoverable and a
later start returns it as `already-claimed`. Reconciliation of that returned
state into the future catalog route/UI is intentionally not implemented in this
domain slice. Likewise, later disable/re-enable generations need a separate
durable generation contract; this proof covers first registration and corrected
resubmission after definitive rejection.
