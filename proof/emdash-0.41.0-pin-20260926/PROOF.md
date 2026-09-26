# EmDash 0.41.0 pin proof

- Source branch: `openclaw/pin-emdash-0.41.0`
- Scope: exact EmDash 0.41.0 development/runtime peer. No kernel behavior. Manage Stock toggle is not in this PR.
- Release: `emdash@0.41.0` published 2026-09-26T10:47:16Z, release commit `eab84af73ae6adc87930e2acff39e2916c3719ff`.

## Verification

- `node --version` — `v24.16.0`
- `npm --version` — `11.13.0`
- `npm config get ignore-scripts` — `false`
- `npm install` (lockfile refresh) then `npm ls emdash --depth=0` — exact `emdash@0.41.0`
- `CI=1 bin/verify-commerce full` — passed after that install (typecheck, 105 unit tests, feature/repo contracts, 19 integration tests including Wrangler/D1). HTTP_PROXY/HTTPS_PROXY/ALL_PROXY stripped for the verifier spawn.
- Redacted terminal evidence: `terminal.txt` in this proof directory.

## Findings

- Kit LSR is `emdash@0.41.0`. Commerce `main` was `0.40.1`. This PR is the pin-only follow-up; parked [commerce #17](https://github.com/dinkuskit/commerce/pull/17) is unchanged.
- `dinkuskit.emdashCompatibility.apiPeer` is `0.41.0`. Mounted-site still fail-closes on **stock** 0.41.0. Public fork contract is unchanged: `requiredCommit` `4c1f21900f3a28e9a270e64111f4979bce74926e` ([emdash#2768](https://github.com/emdash-cms/emdash/pull/2768), still OPEN / CHANGES_REQUESTED; those two commits are not in `emdash@0.41.0`).
- SQLite `_plugin_storage.revision TEXT NOT NULL DEFAULT '0'` was already on `main` from the 0.40.1 pin. No fixture change in this PR.
- Dev `react` / `@types/react` moved `19.2.8` / `19.2.2` → `19.3.0` so npm 11.13 can resolve `emdash@0.41.0` without `--legacy-peer-deps`. No product React runtime change.
- Historical receipts under `proof/emdash-0.35-baseline-20260827/`, `proof/commerce-admin-products/`, and `proof/commerce-owned-product-price/` were left alone.

## Gates

- No catalog, inventory, admin, or storefront behavior change.
- No npm publish, Worker deploy, lab move, or merge of EmDash 2768.
- Merge remains human-gated.
