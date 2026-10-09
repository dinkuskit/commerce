# Current-head proof after main merge (#73)

This file supersedes the bundle-size and distribution-gate statements in
`PROOF.md`, `MAIN-INTEGRATION.md` and `VARIANT-INTEGRATION.md` in this folder.
Those files record the branch before #75 moved coupons out of the Registry
build; their oversized-backend and blocked-gate findings no longer hold.

Source: branch `codex/commerce-country-settings-20261008` with `main` at
`422f57d` merged in (#75 coupon deferral, #74 CLI, #73 JSON-LD and store
policies).

## Registry bundle

`npm run build:sandbox` (runs `scripts/check-registry-bundle.mjs`):

```
registry_bundle=pass backend_bytes=110484 headroom_bytes=20588
backend_sha256=30548e4f5e18800696e7f90ac4907aa5a1b60cc07cc42e2cb90dee5870eb74d3
```

The backend is under the unchanged 131,072-byte per-file cap by 20,588 bytes.
No cap increase or custom size transform. The installed-coupon validation that
earlier failed before browser startup no longer applies: the Registry build no
longer carries coupons (decision `registry-coupons-deferred-20261008`).

## Checks

- `bin/verify-commerce quick`: 397 unit tests pass, typecheck passes,
  `public_repository_contract=clean`, `feature_contract=clean`.
- `./scripts/grilltrack validate`: valid. Main's ledger is kept as is and
  `merchant-country-settings-001` and `merchant-phone-requirement-001` are
  replayed through the CLI.
- `tests/merchant-settings.playwright.config.mjs`: 2 of 2 pass (registry and
  native projects) on this head with local Chromium.

Local proof only. Not Registry publication.
