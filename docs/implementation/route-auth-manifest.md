# Route auth declarations and public route manifest

Issue #79. EmDash mounts every Commerce route under
`/_emdash/api/plugins/dinkus-commerce/...`, next to admin routes. Stores keep
`/_emdash*` behind Cloudflare Access and, with checkout on, bypass Access only
for the exact public shopper paths listed here.

## Rule

- Every route in `src/plugin.ts` (Registry/sandbox) and `createPlugin()`
  (native) sets `public: true` or `public: false`. There is no implicit default.
- An admin route (`public: false`) names an EmDash permission. EmDash requires
  a signed-in user or API token with that permission, and the CSRF header,
  regardless of Cloudflare Access.
- A public route names explicit methods and no permission. Public shopper
  routes accept only whitelisted input: catalog reads accept only `cursor` or
  one `itemId`; guest checkout bodies accept only `catalogItemId`/`quantity`
  lines plus optional contact and coupon code. Prices and totals always come
  from Commerce catalog storage, never from the browser.
- `tests/route-auth.test.mjs` fails if any route lacks a declaration, if an
  admin route has no permission, or if the public set changes.

## Manifest

The build writes `dist/sandbox/route-manifest.json`, exported as
`@dinkuskit/commerce/route-manifest`. It is generated from the built plugins
by `scripts/route-manifest.mjs` (called from `check-registry-bundle.mjs`), so
it adds nothing to the sandbox backend.

```json
{
  "schema": "dinkus-commerce/route-manifest@1",
  "plugin": "dinkus-commerce",
  "artifact": { "package", "version", "file": "backend.js", "bytes", "sha256" },
  "routes": [{ "name", "path", "public", "methods", "surface": "registry", "auth": "public" | "emdash", "permission"? }],
  "publicRoutes": ["/_emdash/api/plugins/dinkus-commerce/..."],
  "native": { "routes": [...], "publicRoutes": [...] }
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
| `GET` | `/_emdash/api/plugins/dinkus-commerce/policies/public` |
| `POST` | `/_emdash/api/plugins/dinkus-commerce/checkout/guest/prepare` |
| `POST` | `/_emdash/api/plugins/dinkus-commerce/checkout/guest/start` |
| `POST` | `/_emdash/api/plugins/dinkus-commerce/checkout/guest/status` |

The native plugin mounts the same set without `policies/public`. Never open a
`/_emdash/api/plugins/dinkus-commerce/*` wildcard.
