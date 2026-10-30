# EmDash 1.4 compatibility migration

This migration repins Commerce from EmDash 1.2.0 to the published EmDash
1.4.0 composition (GrillTrack decision `emdash-1-4-compatibility-20261030`).
Checkout, catalog authority, managed-stock, guest-route and capability policy
do not change. No store runs Commerce yet, so nothing carries a migration shim.

## Current package contract

- `emdash`, `@emdash-cms/auth` and `@emdash-cms/blocks`: `1.4.0`.
- `@emdash-cms/plugin-types`: `0.6.0`, unchanged (no newer release).
- `@emdash-cms/plugin-cli`: `0.13.5`.
- `@emdash-cms/sandbox-workerd`: `0.9.6`.
- The runtime peer stays exact: `emdash` `1.4.0`.
- The manifest records the published `emdash@1.4.0` npm integrity:
  `sha512-dp56A8E5KCVSFVY6NSWbzgmgsUNWp7U1RX3f4qQKsY8WdB211pI3adAkLoG4R07KZ7zihxYz24DH9z5k4gLmhQ==`.

The [EmDash 1.2 compatibility record](./emdash-1-2-compatibility.md) is kept
as version-bound evidence and is not rewritten. Notes elsewhere that describe
EmDash 1.2.0 behaviour are still accurate on 1.4.0 unless this record says
otherwise.

## What 1.4 changes for Commerce

- **Database:** EmDash 1.3.0, 1.3.1 and 1.4.0 add no core migrations. The newest
  is still `091_redirect_artifacts`.
- **Registry bundle:** the backend builds byte-for-byte the same as on 1.2.0:
  130676 bytes, 396 bytes below the 131072-byte file cap, sha256
  `a630ca239b3573cd5943cb430fb8e26702c946ba6d7c38438fcc86ac01c98f92`.
- **Block Kit:** the `@emdash-cms/blocks` element types are identical to 1.2.0.
  A toggle still has no `disabled` field, and plugin pages still render no
  `media_picker`, so Commerce's own image chooser and its disabled-slider
  fallback stay.
- **Block Kit forms render as field groups.** A `form` block is now a
  `role="group"` element named after its submit button instead of an HTML
  `<form>` (emdash-cms/emdash#4183). Commerce's panels are unchanged. The
  browser proofs find a form through `BLOCK_FORM` in
  `tests/sandbox/product-page.mjs`.
- **Audited auth build:** `@emdash-cms/auth` 1.4.0 adds one role-table line,
  `content:edit_own_drafts` for Contributors (emdash-cms/emdash#4133). The
  coupon build transform's package and `dist/index.mjs` hashes move to 1.4.0.
  The other audited sources and initializers are byte-identical.
- **Store side:** fixes that matter to shoppers arrive with the store's own
  EmDash (the template store), not with this package. They include sandboxed
  `email:send` on Cloudflare (#4281), Access session writes (#4157) and stale
  cached pages after delete or unpublish (#4243).

## Verification

On Node 24 with the repinned lockfile:

- `npm test`: 851 of 852 pass. The remaining failure, the packaged-consumer
  teardown smoke, fails the same way on main in the same container.
- `npm run test:integration`: 110 of 110 pass, including the two-process
  Wrangler/D1 claim proof.
- `npx tsc --noEmit`, `node scripts/repo-contract.mjs` and
  `node scripts/check-features.mjs` are clean.
- `npm run test:sandbox`: 10 of 10 pass on real workerd and native hosts.
- `npm run test:sandbox:orders`, `npm run test:consumer:native` and
  `npm run test:settings` pass.

This is a local proof. Journeys on the beta store, after the template store
moves to 1.4.0, are the gate for the stable release.
