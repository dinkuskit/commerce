# Route auth declarations and public route manifest

Issue #79. EmDash mounts every Commerce route under
`/_emdash/api/plugins/dinkus-commerce/...`, next to admin routes. Stores keep
`/_emdash*` behind Cloudflare Access and, with checkout on, bypass Access only
for the exact public shopper paths listed here.

## Rule

- Every route in `src/plugin.ts` (the Registry/sandbox build, Commerce's one
  plugin build) sets `public: true` or `public: false`. There is no implicit default.
- An admin route (`public: false`) names an EmDash permission. EmDash requires
  a signed-in user or API token with that permission, and the CSRF header,
  regardless of Cloudflare Access.
- A public route names explicit methods and no permission. Public shopper
  routes accept only whitelisted input: catalog reads accept only `cursor` or
  one `itemId`; the guest cart accepts only whole-cart writes of
  `catalogItemId`/`quantity` (or `productId`/`options`/`quantity`) lines with
  the version it read; start accepts only contact and an optional coupon code. Prices and totals always come
  from Commerce catalog storage, never from the browser.
- `tests/route-auth.test.mjs` fails if any route lacks a declaration, if an
  admin route has no permission, or if the public set changes.

## Manifest

The build writes `dist/sandbox/route-manifest.json`, exported as
`@dinkuskit/commerce/route-manifest`. It is generated from the built Registry
plugin by `scripts/route-manifest.mjs` (called from `check-registry-bundle.mjs`),
so it adds nothing to the sandbox backend. It has no `native` section any more:
the package root is a library, not a plugin entry
(`commerce-remove-native-entry-20261101`).

```json
{
  "schema": "dinkus-commerce/route-manifest@1",
  "plugin": "dinkus-commerce",
  "artifact": { "package", "version", "file": "backend.js", "bytes", "sha256" },
  "routes": [{ "name", "path", "public", "methods", "surface": "registry", "auth": "public" | "emdash", "permission"? }],
  "publicRoutes": ["/_emdash/api/plugins/dinkus-commerce/..."]
}
```

`artifact.sha256` is the digest of the Registry `backend.js` the manifest
describes. Each route uses the same `{ path, public, methods, surface, auth }`
shape Template Store's `verify-access-routes` accepts for plugin manifests.

Public Registry/sandbox paths today:

| Method | Path |
| --- | --- |
| `GET` | `/_emdash/api/plugins/dinkus-commerce/catalog/public` |
| `GET` | `/_emdash/api/plugins/dinkus-commerce/catalog/public/item` |
| `POST` | `/_emdash/api/plugins/dinkus-commerce/checkout/guest/prepare` |
| `POST` | `/_emdash/api/plugins/dinkus-commerce/checkout/guest/start` |
| `POST` | `/_emdash/api/plugins/dinkus-commerce/checkout/guest/cart` |
| `GET` | `/_emdash/api/plugins/dinkus-commerce/checkout/guest/readiness` |
| `POST` | `/_emdash/api/plugins/dinkus-commerce/account/sign-in/start` |
| `POST` | `/_emdash/api/plugins/dinkus-commerce/account/sign-in/verify` |
| `POST` | `/_emdash/api/plugins/dinkus-commerce/account/sign-out` |
| `GET` | `/_emdash/api/plugins/dinkus-commerce/account/orders` |
| `GET,POST` | `/_emdash/api/plugins/dinkus-commerce/account/profile` |

Never open a
`/_emdash/api/plugins/dinkus-commerce/*` wildcard.
