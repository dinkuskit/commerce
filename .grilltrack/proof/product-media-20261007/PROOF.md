# Product media — 2026-10-07

Scope: GrillTrack decisions `product-media-reference-001`, `product-media-read-capability-002`, `product-media-admin-003`, `product-media-placeholder-004`, `product-media-sizes-005`, `product-media-artifact-budget-006` and `product-media-imports-deferred-007` in the active join track. Baseline `git:4a8fac510772dcce7be5280c9b9d7c0360d15e92` (main after dinkuskit/commerce#53), branch `claude/product-media-grill`, worktree `.claude/worktrees/magical-haibt-6b1d70`. Toolchain Node 22.23.2 (mise), EmDash 1.2.0, Block Kit 1.2.0, sandbox-workerd 0.9.3, plugin-cli 0.13.3.

## Outcome proven

A clerk opens a product in the installed sandbox admin, chooses an image and gallery images from a Commerce-rendered Media Library page, reorders and removes gallery images, and chooses a store placeholder in Commerce Settings. `GET catalog/public` returns `image` and `gallery[]` as `{ id, alt, width, height, placeholder }` with alt read live from the media item (alt, then caption, then product name). The server-rendered storefront fixture maps ids to public file URLs through the EmDash host and renders `srcset` through EmDash's image endpoint with Commerce preset widths. A product without an image returns the placeholder with `placeholder: true`.

## Verified host facts that reshaped decisions 1, 3, 4, 5 (maintainer re-locked option C)

- Block Kit 1.2.0 `renderElement` returns null for `media_picker` on plugin admin pages; the field rendered nothing on the real product page. Commerce therefore lists the library itself through `media:read` (`NEEDS_HOST_SUPPORT` for the native element).
- Plugin media access returns `url = /_emdash/api/media/asset/<id>/<filename>`, an admin-only route (`requirePerm` answers 401 without a user; verified anonymously). It exposes no storage key or public URL.
- Upload storage keys are `${ulid()}${ext}` minted apart from the media row id (observed id `01M4C8Z9167J0TFRVDE3MNV1AN`, key `01M4C8Z8ZW97C0XAXHQNVN2JKK.png`); the public file route serves by key only (bare id → 404, key → 200 `image/png`).
- Anonymous page requests carry only `getPublicMediaUrl` and `storage` on `Astro.locals.emdash`; `handleMediaGet(await getDb(), id)` (`emdash`, `emdash/runtime`) returns the repository item with `storageKey`.
- `/_image?href=<public file URL>&w=300&f=webp` answers 200 `image/webp` on the Node proof host.

## Implementation

- Kernel: `src/features/catalog/media.ts` (id-only `{ mediaId }` references, `catalog_media` / `catalogMedia` record, gallery max 8, no duplicates, empty record deleted, omitted fields preserved), `src/features/catalog/media-projection.ts` (live projection through `ctx.media.get`, alt chain, cached per request, preset constants and `commerceImageSrcset` / `commerceImageTransformUrl` for storefronts), `src/features/storefront-availability/placeholder.ts` (`storefront_placeholder_image` / `storefrontPlaceholderImage`), `src/features/catalog/public.ts` (image, gallery, placeholder fallback).
- Routes: native `catalog-items/save-media` and `settings/placeholder-image`; manifest and `createPlugin` declare `media:read` and the two collections.
- Sandbox admin `src/admin/index.ts`: Images section (preview, Choose/Change/Remove image), Gallery (n of 8) with Move up / Remove / Add to gallery, library chooser page (`ctx.media.list`, image/*, 12 per page, Use / Next / Cancel), Settings placeholder section; a refused choice returns the clerk to the product with the reason and changes nothing.
- Artifact budget: `scripts/build-sandbox.mjs` marks `@oslojs/*` side-effect-free; `src/admin/coupon-i18n.ts` formats the pinned compiled catalog locally instead of the `@lingui/core` runtime.
- Docs: `docs/implementation/product-media.md`, `docs/implementation/installed-public-catalog.md`, `README.md`, `FEATURE_MAP.md`, `docs/README.md`.

## Evidence

- Unit: `node --test` over every unit glob, 318 tests, 318 pass (includes `tests/features/catalog/media.test.mjs`, `tests/admin-media.test.mjs`, `tests/coupon-i18n.test.mjs`, updated `public-catalog`, `public-entry`, `v1-stock-admission`, `installed-context`, `registry-checkout-services`, `coupon-blocks.spec` assertions). Typecheck clean. `npm run audit:repo` clean.
- Browser (`npm run test:sandbox`, run `.tmp/sandbox-proof/product-media-20261007-192656`, real workerd runner, SQLite, Chromium 1440×1000): 6/6 passed, including `clerk sets product images from the Media Library and the storefront renders them` (`media_proof=pass chooser gallery-reorder placeholder public-ids storefront-srcset`). Curated captures in `browser/`: `media-chooser.png`, `product-image-chosen.png`, `product-gallery.png` (duplicate refused, clerk stays on the product), `settings-placeholder.png`, `storefront-images.png`, and the anonymous `public-catalog-media.json`. The spec uploads solid-colour PNGs through the real media API, drives every button by role, asserts `catalog_media` and `storefront_placeholder_image` rows and untouched prices, asserts the public JSON carries no `/_emdash/api/media/asset/` URL, and fetches one `srcset` candidate (200 `image/webp`).
- Full verifier pieces (same build, Node 22.23.2): `npm run test:sandbox:native-local-stock` 1/1 passed; `COMMERCE_COUPON_INSTALLED_PROFILE=1 npm run test:sandbox:coupons` 1/1 passed (installed Registry profile, product shape asserted with `image: null, gallery: []`); `node --test tests/integration/*.test.mjs` ran twice at 37/38 with a different two-process Wrangler/D1 test failing each time (`workerd bridge denies missing grants…` in the first run, `two local Wrangler/D1 processes enforce the EmDash JSON-expression SKU index` in the second), and an isolated rerun of each failing file passed that test while another D1 two-process case (`…enforce one permanent store identity`) failed once. This is the existing macOS Wrangler/D1 error-envelope masking recorded in the installed-public-catalog proof; every integration test passed in at least one run, and no media-related integration test failed. Not claimed: a single clean 38/38 integration run on this host.

## Artifact and release-size record

Backend `dist/sandbox/plugin.mjs`: 128316 / 131072 bytes (2756 bytes headroom; was 131027 with 45 bytes free). SHA-256 `77e6ab11e96057ebb4cd89198908f90b1577136c96185447299da372e033ca7d`.
Manifest `dist/sandbox/manifest.json`: 3673 bytes, SHA-256 `4eae8ee5f6e2f3423763a8c78e76f5cbc89379bc65f2ccaf6b2110a5680dd9f5`; capabilities `["media:read"]`, allowedHosts `[]`.
Lockfile SHA-256 `865ece395c6ead0ffa60825343780f12c5690d4e27fb38a48674659453705b1f` (unchanged). Build script `scripts/build-sandbox.mjs` SHA-256 `d04de85ab72d4810e561c88705308c8a827dd40f97d94146088330b56e2555ce`.
Measured levers (minified, pure-vendor attribution): `@oslojs/*` side-effect-free −5665 bytes; Lingui runtime swap −4847 bytes; the media slice adds about 7.4 KB. The audited auth transform, minify settings and coupon catalog contents are unchanged.

## Fidelity, limits and remaining risk

- Admin previews use the host's admin-only media item URL; shoppers never receive it. The chooser lists newest-first with 12 per page and no search; the Media page remains the place to upload.
- The public API carries no URLs by design; a plain client-side consumer must resolve ids through its host. The storefront fixture is server-rendered for that reason. `Astro.locals.emdash.handleMediaGet` named in decision 5 is only present on the full runtime path; the verified anonymous path is `handleMediaGet(await getDb(), id)` plus `getPublicMediaUrl(storageKey)`.
- Preset widths and the `/_image` route are constants; a site that moves `image.endpoint.route` breaks `srcset` built with the helper but never the public `src`.
- Each projected image costs one `media.get` bridge call per distinct id per request (cached within the request); 50 products with full galleries can reach several hundred calls per page.
- `media:read` is a declared-access escalation that the Registry will surface at publication; publication, merge, deployment and real Stripe traffic remain outside this slice.
- Deferred by decision 7: imports (CSV/feed), CDN offload, regeneration, video galleries, variations (variation → parent → placeholder recorded), `darkVariant`, configurable presets, cropping, native React chooser.
