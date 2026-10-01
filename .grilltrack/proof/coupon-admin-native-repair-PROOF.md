# Coupon admin native repair proof

This is the final bounded repair of the existing uncommitted coupon-admin
slice, not an independent clean review. No commit, push, PR, merge, deploy,
production mutation, or review dispatch occurred.

## Exact boundary

Owned presentation and concurrency changes are in `src/admin/coupons-page.ts`;
the focused browser exercise is `tests/sandbox/coupon-native.spec.mjs`.
The existing admin adapter/contract/routes and `src/admin/native.ts` remain
part of the same parent slice. No Commerce kernel, shared domain, host
config, dependency, theme, sidebar, or manifest source was changed.

The page now uses self-contained standard HTML styles, inherited host colors,
visible input/button boundaries, separated labels, responsive flex wrapping,
distinct list/edit/usage groups, full offset text fields, and disabled controls
while requests are pending. Load/recovery uses request and selection refs,
preserves drafts, updates CAS revision only for the requested coupon, and
surfaces recoverable failures.

## Environment and claims

The intended fixture is neutral synthetic data on actual EmDash `1.0.1`, using
the supported dev-bypass host, real plugin routes, real SQLite storage, and
real `createCouponAdmin`/`createCouponAttemptOwner`. The fixture is not a
mock pretending to be installed. The host remains a serial production
descriptor/storage/routes mount pending; Registry publication is not proved.
No payment bridge, charges, customer data, or secrets are involved.

## Verification record

Passed:

- `npm run typecheck`
- `npm run audit:repo`
- `git diff --check`
- `node --check` for the focused unit, Playwright config, and browser spec
- source build phase `node scripts/build.mjs`

Blocked by pre-existing local toolchain state:

- `npm run build`, `npm run test:unit`, and the Playwright web server stop
  before project execution because the installed pinned EmDash/Rolldown
  toolchain cannot load `@rolldown/binding-wasm32-wasi`.
- Direct coupon domain tests also stop before test execution because macOS
  rejects the installed `better-sqlite3` binary with
  `ERR_DLOPEN_FAILED` (non-platform file and process have different Team IDs).

Therefore this repair makes no false claim of a new browser pass. The parent
browser screenshots remain historical evidence only; new requested screenshots
and browser counts/stale-recovery assertions are present in the focused spec
but require a healthy pinned install to execute.

## Planned proof artifact provenance

The next successful run should write local artifacts under
`.grilltrack/work/coupon-admin-browser-proof/<run>/`, including
`coupon-empty-before.png`, `coupon-created-percent.png`,
`coupon-created-fixed.png`, `coupon-usage-real-attempts.png`,
`coupon-disabled-persisted.png`, `coupon-final-after.png`, and
`coupon-storage-evidence.json`. These are local paths, not immutable media
links; the chosen media will be uploaded to the parent shelf later.
