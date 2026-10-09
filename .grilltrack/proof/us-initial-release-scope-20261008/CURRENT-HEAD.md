# Current-head proof after main merge (#68)

This file supersedes the bundle-size and installation-gate statements in
`MAIN-INTEGRATION.md` in this folder, which recorded the stack before #75 moved
coupons out of the Registry build.

Source: branch `codex/commerce-us-release-scope-20261008` with `main` at
`be52f8f` merged in (#68 merchant settings on top of #75, #74 and #73).

This PR changes no runtime code. It records two locked policy decisions,
`initial-physical-delivery-coverage-001` and
`initial-foreign-billing-us-delivery-001`, replayed through the GrillTrack CLI
onto main's ledger with identical question, choice, rationale, dependency and
context bodies. Destination enforcement and address capture remain separate.

## Checks on this head

- `npm run build:sandbox`:
  `registry_bundle=pass backend_bytes=110484 headroom_bytes=20588`
  `backend_sha256=30548e4f5e18800696e7f90ac4907aa5a1b60cc07cc42e2cb90dee5870eb74d3`
  (identical to main, since no runtime file changes).
- `bin/verify-commerce quick`: 397 unit tests pass,
  `public_repository_contract=clean`, `feature_contract=clean`.
- `./scripts/grilltrack validate`: valid.

Local proof only. Not Registry publication.
