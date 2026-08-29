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

## Fidelity and remaining risk

The provider is a deterministic in-memory test double; no live Inventory or
Cloudflare transport is claimed. The orchestration awaits a caller-supplied
durable persistence function before every provider call, but this slice does
not implement or prove the cross-process compare-and-set adapter needed to
choose one operation when two simultaneous first setup submissions race. That
gap is retained as the next recommended grill.
