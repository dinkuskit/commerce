# Retry-safe managed-SKU registration proof

Date: 2026-08-28

Commerce baseline: `1bd201fd828ef27f5f0561a1de45df29e8bb0e5d`

Inventory candidate: PR #12 exact head
`670c539303ba77db916f50012070bdd83ead4e4e`

## Confirmed slice

Commerce persists one hidden registration operation before the provider call,
keeps ambiguous outcomes setup-pending across reloads, retries only through the
explicit API with the same operation identity, activates only from a valid
identity-bearing result, and converts a terminal rejection into
setup-needs-attention. Corrected resubmission requires a new operation ID.

Live provider transport, visual UI, background scheduling, stock mutation,
reservations, deployment, and production data are excluded.

## TDD receipt

Baseline before the change:

```text
mise x node@22.23.2 -- npm run test:unit
37 passed, 0 failed
```

Red command:

```text
mise x node@22.23.2 -- npm run build
mise x node@22.23.2 -- node --test tests/features/inventory-provider/registration-orchestration.test.mjs
```

Observed red result:

```text
SyntaxError: The requested module '../../../dist/features/inventory-provider/index.js'
does not provide an export named 'retryManagedSkuRegistration'
1 failed
```

Green focused result after the minimal implementation:

```text
6 passed, 0 failed
```

## Full verification

Command:

```text
mise x node@22.23.2 -- bin/verify-commerce full
```

Result:

- TypeScript no-emit check passed.
- Unit, public-contract, workflow, and feature tests: 43 passed.
- Public repository and feature audits: clean.
- Integration tests: 7 passed.
- Two-process Wrangler/D1 canonical-SKU uniqueness proof passed.
- Exact EmDash 0.35 unique-index fail-closed checks passed.
- Two-process SQLite SKU conflict and command replay proofs passed.

Additional integrity commands:

```text
sha256sum -c proof/retry-safe-registration/source-manifest.sha256
git diff --check
python3 /home/smoky/.codex/skills/grilltrack/scripts/grilltrack_ledger.py --project . validate
```

## Runtime behavior

[`RUNTIME.txt`](RUNTIME.txt) is a synthetic, redacted execution receipt. It
shows that an ambiguous call left one persisted pending operation, a reload
made zero provider calls, explicit retry reused the exact operation and became
active, and terminal rejection preserved its operation in needs-attention.

[`REAL_RUNTIME.txt`](REAL_RUNTIME.txt) is the after-fix durable compatibility
receipt requested during PR #11 review. It uses EmDash 0.35.0's real
`PluginStorageRepository` over SQLite for the Commerce catalog and Inventory
PR #12's exact reviewed head `670c539303ba77db916f50012070bdd83ead4e4e`
with its real local SQLite store and `createRegisterManagedSku` implementation.
The harness loses the first response only after Inventory commits, closes both
stores, reopens them, observes Commerce still setup-pending without calling the
provider, and explicitly retries the same operation. Inventory replays the
stored `registered` result without minting another identity; Commerce persists
active state, and a second full reopen observes one catalog item and one
Inventory SKU.

Command:

```text
mise x node@22.23.2 -- npm run proof:registration-retry:real -- <exact-inventory-pr12-worktree>
```

Result:

```text
LIVE_PROOF {"case":"emdash-inventory-registration-retry","emdash":"0.35.0","inventoryHead":"670c539303ba77db916f50012070bdd83ead4e4e","firstProviderCalls":1,"automaticProviderCallsOnReload":0,"pendingPersistedAcrossReopen":true,"retryOperationIdReused":true,"retryProviderCalls":1,"inventoryIdsMintedOnRetry":0,"terminalInventoryOutcome":"registered","finalStockManagement":{"mode":"managed","status":"active","inventorySkuId":"inventory_registration_retry_proof"},"commerceCatalogItems":1,"inventorySkuRows":1,"commandResultRows":1,"balanceRows":0,"receiptRows":0,"commerceStoreReopens":2,"inventoryStoreReopens":2,"dataClassification":"synthetic-local"}
```

The product data and principal are synthetic and redacted. No credential,
tenant, production resource, deployment, or live network transport was used.
The storage and provider implementations are real exact-source components, not
in-memory doubles.

## External review adjudication

ClawSweeper reviewed exact PR head
`f1c3645cd01e07bf1b05e6fabee7190d35024531` and requested two changes.

- `required_fix`: accepted the missing real durable behavior proof. The
  EmDash-plus-Inventory receipt above and its reusable exact-head harness close
  that evidence gap.
- `reject_false_positive`: the requested wholesale deletion of
  `.grilltrack/archive/managed-sku-compatibility-repair-20260828` is not a
  private-ledger cleanup. GrillTrack generated it from already-public Commerce
  state when this successor track began. The repository contract explicitly
  makes `.grilltrack/ledger.json` source-priority authority, and the archive
  preserves that same repository's public product-decision lineage. It contains
  no credentials, tenant/customer data, private repository coordinates, or
  private operating rationale.

## Fidelity and remaining risk

The unit receipt still uses a deterministic in-memory test double, while the
after-fix receipt additionally proves exact real EmDash persistence and the
real Inventory PR #12 implementation across process-local store reopen. No live
Cloudflare transport is claimed. The orchestration awaits a caller-supplied
durable persistence function before every provider call, but this slice does
not implement or prove the cross-process compare-and-set adapter needed to
choose one operation when two simultaneous first setup submissions race. That
gap is retained as the next recommended grill.
