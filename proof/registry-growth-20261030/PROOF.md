# Commerce Registry listing refresh

Prepared on 2026-10-30 from `b3494cbcb932680c16dda0bebc6a6ffd68456a4d` on
`codex/registry-growth-20261030`. This is listing source and packaging work;
it does not publish a Registry record or change a running store.

## Change and scope

- Display name: **DinkusKit Commerce**. The stable slug, publisher DID, version,
  repository, security contact, capabilities, hosts, storage and admin contract
  are unchanged.
- The DinkusKit author link goes to `https://dinkuskit.com`; the separate source
  link still goes to `https://github.com/dinkuskit/commerce`.
- Five search keywords and short Markdown sections explain benefits,
  installation, limitations, documentation, demo and GitHub contribution paths.
- An existing brand icon and two real, synthetic-data demo screenshots are
  declared as release artwork. The screenshots are product listing assets,
  not newly committed test captures or claims of a production store.
- Both prebundle and release-preparation staging copy the listing sources so
  the file references remain available in their temporary source directories.

## Image provenance

| Asset | Public source | SHA-256 |
| --- | --- | --- |
| `assets/listing/icon.webp` | `dinkuskit/dinkuskit` commit `920aea3f012a14beb90d1be7264121dd7a8dd105`, `public/brand/commerce.webp` | `1ab489d54413b22f52d5c3344041f6e341c112ae88d598db2ca902f15c7c6b35` |
| `assets/listing/product-panel.png` | This repository at the base above, `.grilltrack/proof/one-product-screen-20261023/registry-upgrade/new-panel.png` | `32799399826e017b39af864e3a68aa1f80a5b9844ae747b6d042d5d496fa88e2` |
| `assets/listing/commerce-settings.png` | Same base, `.grilltrack/proof/one-product-screen-20261023/registry-upgrade/new-settings.png` | `9976a7b280cfddcaa59514632b43972b4bf7aa79318ecf1eea275b5d575aba7d` |

The screenshots were visually inspected. They show EmDash Dev Site, synthetic
Red hat/Blue scarf/Old cap records and local demo settings. No customer data,
credentials, payment details or private browser chrome are present. They were
copied without image edits. The source proof documents the actual workerd
Registry upgrade from Commerce 0.5.0 and the product panel later released in
0.6.0; it is older UI evidence, not proof of a fresh installed 0.6.0 transaction.
The listing explicitly labels these as a local synthetic demo.
`sips` identifies the icon as 256 × 256 WebP and both screenshots as
1440 × 1000 PNG. All are below 1 MiB and 8192 pixels per dimension.

## Verification

- Node `v24.22.0`; `npm ci`; pinned `./scripts/agent-skills` installation;
  `./scripts/grilltrack --project . validate` returned `valid`.
- The pinned `@emdash-cms/plugin-cli` is `0.13.5`.
- `npm run build` passed manifest validation and official bundle validation.
  Backend: 130676 bytes, 396 bytes below the per-file limit; SHA-256
  `a630ca239b3573cd5943cb430fb8e26702c946ba6d7c38438fcc86ac01c98f92`.
- `node scripts/prepare-emdash-release.mjs dinkus-commerce@0.6.0` passed local
  official release preparation. No publish command ran.
- Node assertions compared the base/current manifest: all existing keys except
  `name`, `description`, and `author.url` are structurally unchanged. The
  description is 124 graphemes; the four Markdown sections are 897, 639, 1036,
  and 84 graphemes, all below 2000 and 20000 UTF-8 bytes.
- Node assertions proved all seven declared text/image files are copied
  byte-for-byte into `.tmp/sandbox-source`; beta naming remains
  `DinkusKit Commerce Beta` with slug `dinkus-commerce-beta`.
- The staging regression and release workflow tests pass (18 tests). The
  official stable/beta release-preparation tests also pass (6 tests), including
  byte-for-byte prepared backend and attestation-output checks.
- The backend hash is identical before and after adding the staging helper.
  This comparison isolates the staging change; it is not a rebuilt-base
  runtime comparison.
- `bin/verify-commerce full` passed: 853 unit/workflow tests, 110 integration
  tests, 10 storefront browser tests, 3 packaged browser tests, native consumer
  proof, and 2 merchant-settings browser tests. Typecheck and public
  repository/feature audits passed as part of that gate. The final local log
  is `.tmp/registry-growth-20261030/full-final.log`.

An initial full run exposed the new listing references missing from synthetic
release fixtures; their setup now carries the declared listing sources. It also
rejected this task's ignored `runs/` directory under the repository's public
path audit. Only this task's newly created output was moved to `.tmp/`; the
public path audit now passes. These are preparation fixes, not relaxed checks.

Generated build and verifier logs are local-only under
`.tmp/registry-growth-20261030/`; generated release archive is local-only under
`.emdash-release/`. They are not source assets.

## Publication boundary

`update-package` is the separate publisher operation for name, description,
author, keywords and sections. Existing profiles do not refresh merely because
a new release is published. The pinned CLI's direct `publish` path uploads
declared `release.artifacts`; its delegated `release prepare` path currently
returns only a code bundle and does not upload those image blobs. Successful
local preparation therefore does **not** prove the existing GitHub release
action will publish this artwork.

Artwork needs a separately approved, supported publication path and a new
version: the CLI refuses replacement of existing release records by default.
This change does not overwrite 0.6.0, broaden publishing credentials, change
the release action, or treat a prepared bundle as published media. Stable and
beta profiles require their own intentional update; this PR does not mutate
either public listing.

## References

- [Current Commerce reference](https://dinkuskit.com/docs/reference/commerce)
- [Commerce 0.6.0 release](https://github.com/dinkuskit/commerce/releases/tag/v0.6.0)
- [EmDash manifest fields](https://docs.emdashcms.com/plugins/creating-plugins/manifest/)
- [EmDash publishing](https://docs.emdashcms.com/plugins/creating-plugins/publishing/)

Docs: up to date. The added listing sections cover this metadata-only change;
the versioned product reference describes unchanged runtime behavior.
