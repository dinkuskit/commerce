# Product media: images, gallery, placeholder, sizes and alt text

Commerce follows WooCommerce's model on top of EmDash's Media Library: the
commerce layer owns no files. A product stores references into the library,
alt text lives on the media item, sizes are named presets produced on demand,
and a store-level placeholder stands in when a product has no image.

## Stored references

- `catalog_media` (sandbox) / `catalogMedia` (native): one record per product,
  `recordKind: "catalog-media"`, `recordId = catalogItemId`, with `image`
  (`{ mediaId }` or `null`) and `gallery` (an ordered list of `{ mediaId }`,
  at most 8, no duplicates). A record with no image and an empty gallery is
  deleted rather than stored.
- `storefront_placeholder_image` / `storefrontPlaceholderImage`: one
  `active` record holding the store placeholder `{ mediaId }` or `null`.
- Commerce stores no file, URL, alt text, dimensions or mime type. Media
  writes never touch price, stock or claim records.

References are media ids only. In EmDash 1.2.0 the plugin media access
(`ctx.media`, capability `media:read`) returns the admin-only asset URL and no
storage key, upload storage keys are minted apart from media ids, and the
public file route serves by storage key only, so no plugin-visible path maps a
media id to a public URL or back. The storefront host owns that mapping.

## Reading alt text and dimensions

`GET catalog/public` resolves every reference live through `ctx.media.get`
(declared as `media:read` in `emdash-plugin.jsonc` and native `createPlugin`).
Each `image` and `gallery[]` entry is `{ id, alt, width, height, placeholder }`.
Alt resolves media alt, then media caption, then the product name, never the
filename. A reference whose media item is missing, not ready, or not an image
is skipped in the gallery; a missing primary image falls back to the store
placeholder (`placeholder: true`); with no placeholder configured `image` is
`null`. Without media access nothing is invented: `image` is `null` and
`gallery` is empty.

## Storefront rendering

The storefront host maps each `id` to its public file URL, for example
`handleMediaGet(await getDb(), id)` (`handleMediaGet` from `emdash`, `getDb`
from `emdash/runtime`) followed by
`Astro.locals.emdash.getPublicMediaUrl(item.storageKey)`, which anonymous page
requests do expose, or EmDash's `Image` component after `normalizeMediaValue`.
It then builds responsive markup with the exported helpers:

```ts
import {
  COMMERCE_IMAGE_PRESETS, // { thumbnail: 300, single: 600, gallery_thumbnail: 100 }
  COMMERCE_IMAGE_SIZES, // "(min-width: 600px) 600px, 100vw"
  commerceImageSrcset, // (src, originalWidth?, siteUrl?) -> 300/600/1200 candidates capped at the original
  commerceImageTransformUrl, // (src, width, siteUrl?) -> /_image?href=<absolute src>&w=<width>&f=webp
} from "@dinkuskit/commerce/features/catalog";
```

Sizes are produced on demand by EmDash's image endpoint (`/_image`, Astro's
default route); Commerce pre-generates no files and serves no bytes. The
presets are constants this slice; configurable presets and cropping are later
grills. `tests/sandbox-site/src/pages/index.astro` is the disposable
server-rendered consumer used by the browser proof.

## Admin

Block Kit 1.2.0 renders no `media_picker` on plugin admin pages, so the sandbox
admin lists the library itself:

- Products → product page → **Images**: the current image preview (the
  host's media item URL, visible to signed-in clerks) with *Choose image* /
  *Change image* and *Remove image*; **Gallery (n of 8)** with per-image
  *Move image N up* and *Remove image N*, plus *Add to gallery*.
- *Choose*, *Change* and *Add* open a Commerce-rendered library page
  (`ctx.media.list`, `image/*`, 12 per page, *Next*, *Cancel*, *Use
  <filename>*). Choosing saves at once and returns to the product.
- Commerce Settings → Catalog → **Placeholder image** with *Choose placeholder*
  / *Change placeholder* and *Remove placeholder* through the same page.
- Native `createPlugin` mounts authenticated `catalog-items/save-media`
  (`{ catalogItemId, image?, gallery? }`, media ids; omitted fields keep their
  value, `null` or `""` clears) and `settings/placeholder-image` (GET, or POST
  `{ image }`). The compatibility React Products and Store pages are unchanged.

A refused choice (duplicate gallery image, full gallery, unknown media id,
storage failure) leaves every stored value unchanged and reports why.

## Registry artifact

The slice fits the 131072-byte backend cap through two behavior-preserving
build changes: pure `@oslojs/*` modules are marked side-effect-free in the
sandbox Rolldown input, and `couponText` formats the pinned compiled coupon
catalog with a local interpolator instead of the `@lingui/core` runtime.
`scripts/coupon-catalog.mjs` already restricts the catalog to plain strings
and single-name placeholders; `tests/coupon-i18n.test.mjs` proves the output
equals Lingui's for every message and edge value.

## Deferred

Bulk and feed import (deduped by recorded source and content hash), CDN
offload, size regeneration, video galleries, variations (a variation image
falls back to the parent product image, then to the placeholder), a
`darkVariant`, configurable presets, cropping and a native React chooser are
not part of this slice. Import and extension work belongs to a separate media
plugin that talks to EmDash's media API and Commerce's references, never to a
store of its own.
