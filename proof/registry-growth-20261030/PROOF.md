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

## Delegated media release path

The media helper and tests were adapted source-by-source from the public
Payments pilot at `ce4855646c1e4b81e8392827a62d1ea9825155bf`. No history,
credentials or unrelated product files were imported.

- The prepared effective stable/beta manifest is retained next to the tarball.
- `scripts/registry-release-media.mjs` validates the real bundle and local
  inputs before GitHub mutation, reuses identical release assets, refuses
  conflicts and never passes `--clobber`. A missing beta release can be
  created as a prerelease after tag verification; missing stable releases fail.
- The source record pins image URLs to the same source SHA and carries the
  package/provenance checksums through the supported `release-file` input of
  the existing pinned EmDash action. The service, OIDC identity, provenance
  policy and approval path remain unchanged.
- The PDS verifier checks expected image counts, checksums, byte sizes and
  MIME types for both newly published and already-listed retry records.
- Only the reusable publisher job and its caller gain `contents: write`,
  required to upload the immutable release artifacts. This permission change
  is part of the human merge decision; no workflow was run for this proof.

Focused media/release/preparation checks passed 51 tests. A separate smoke
used the real prepared Commerce tarball and official parser with mocked
GitHub uploads: one icon and two screenshots were retained, with two mock
uploads for package and provenance. The provenance document in that smoke
was synthetic; it proves record construction, not a signed live release.
Logs are `media-focused.log`, `media-prepare.log`, and `media-release.json` in
the local run directory. The earlier full browser proof was at `ce921fe`; the
media port changes no `src/` files or plugin runtime behavior.

After the port, `bin/verify-commerce quick` passed again (862 tests,
typecheck, build and public repository/feature audits), and
`npm run proof:release-authority` passed all 15 synthetic release scenarios.
The real-image expected-record check also passed for the icon and both
screenshots. All GitHub release uploads in media tests were mocked; no
workflow, tag, release, artifact upload, or PDS write was triggered.

## Publication boundary

[Native review](https://github.com/dinkuskit/commerce/pull/225#issuecomment-6528581958)
identified a retry collision when a package had already been
uploaded but the delegated publish timed out: a fresh archive could have
different bytes under the same version filename. The regression reproduced
`Release asset conflict` before the fix. Package asset names now include the
archive SHA-256, as provenance names already did. The mocked same-tag retry
test proves distinct package URLs for changed archive bytes, unchanged first
upload bytes, and zero new uploads for an identical rerun. No-clobber and all
tag, identity and approval gates remain unchanged.

After this repair, the focused media/release/preparation suite passed 52 tests,
the real-tarball media smoke passed with mocked uploads, and public
repository/feature audits passed. Plugin runtime, manifest and image bytes
did not change, so the existing runtime/browser proof is retained. Logs are
`media-retry-before.log` and `media-retry-focused.log` in the local run root.

`update-package` is the separate publisher operation for name, description,
author, keywords and sections. Existing profiles do not refresh merely because
a new release is published. The pinned CLI's direct `publish` path uploads
declared `release.artifacts`; its delegated `release prepare` path returns a
code bundle. The new source-record step carries the declared images through
the supported delegated action; successful local tests still do not prove a
live image upload or public listing render.

Artwork needs a separately approved, supported publication path and a new
version: the CLI refuses replacement of existing release records by default.
This change does not overwrite 0.6.0, add a publisher credential, replace the
pinned release action, or treat a prepared bundle as published media. Profile
updates are separate from release publication. The campaign coordinator
reported applying and verifying the stable profile copy separately; this
worker did not perform that publication. This source change prepares the
artwork path for a separately approved beta release, not a stable rollout.

## References

- [Current Commerce reference](https://dinkuskit.com/docs/reference/commerce)
- [Commerce 0.6.0 release](https://github.com/dinkuskit/commerce/releases/tag/v0.6.0)
- [EmDash manifest fields](https://docs.emdashcms.com/plugins/creating-plugins/manifest/)
- [EmDash publishing](https://docs.emdashcms.com/plugins/creating-plugins/publishing/)

Docs: up to date. The added listing sections cover this metadata-only change;
the versioned product reference describes unchanged runtime behavior.
