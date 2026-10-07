# Registry-safe Commerce admin

Confirmed scope: Products and Commerce Settings → Catalog over the existing
catalog kernel. Host-rendered Block Kit JSON replaces plugin React. No browser
plugin code, cart, payment operations, public product-page rendering, Inventory
transport, or public release is included.

## Delivery

- Exact EmDash 1.2.0; plugin CLI 0.13.3; Block Kit types 1.2.0.
- `npm run build` creates the library and dist/sandbox artifact. The sandbox
  descriptor is exported at @dinkuskit/commerce/descriptor and code at
  @dinkuskit/commerce/sandbox. Both are local artifacts until publication.
- emdash-plugin.jsonc declares publisher smokyco.bsky.social's DID, this
  Commerce repository, no extra capabilities, no hosts, and isolated storage.
- The legacy native entry remains API-only for existing kernel consumers. It
  is not the public install path. No native React admin export remains.

## Clerk operations

Products adds Name + SKU, defaults Manage stock off, and opens the new product.
Name is the customer-facing title/H1 contract, not an internal label. Product
selection and list pagination are Block Kit interactions. A single Save sends
Regular, Sale, Manage stock, and manual stock status through the existing
application operation. Conditional radio visibility is handled by the host.
Enabling stock persists setup-required, without configuring Inventory. Disabling
restores dormant manual status. Stored prices keep their existing exact Money
contract. Refused prices remain in the fields. Creation retries retain their
command ID, so replay does not create another product. Thrown Save failures
retain submitted product fields or the settings choice and keep Save available
without reading storage again. The response says Save was not confirmed, since
a transport/storage failure must not imply an atomic rollback or success.

Commerce currently uses flat plugin page links, labeled
Commerce Products and Commerce Settings. Commerce Settings has a Catalog
section and its own Save for Hide out-of-stock products.
This is the current agreed placement, not a permanent navigation constraint.
The private admin route requires content:edit_any and POST; EmDash supplies
session/token authorization, CSRF protection, and Block Kit response validation.
Inputs are validated again at the plugin and kernel boundaries.

## Storage compatibility

The Registry CLI requires lowercase underscore collection identifiers. Sandbox
collections use snake_case; native collections remain camelCase. Record schemas,
product IDs, price semantics and stock state transitions are unchanged. Kernel
creation accepts the trusted host collection name for **exact named unique
constraint recognition**; this is not accepted from the clerk. No constraint
failure becomes a generic success. Missing active indexes still refuse writes.

This is a fresh-install artifact, not a migration. Never replace a populated
native installation with it: migration needs explicit design and upgrade proof.
Inventory registration/provider hosting stays separate. Its kernel remains in
the library; the sandbox admin does not offer Configure Inventory or install
popups. Managed availability without setup remains unavailable, not zero.

## Reproducible proof

1. npm ci, npm run build, npx playwright install chromium.
2. npm run test:sandbox. Override COMMERCE_PROOF_PORT if 64525 is occupied.
3. The verifier makes a fresh SQLite DB per run under .tmp/sandbox-proof,
   configures the built descriptor under sandboxed (never plugins), and runs
   @emdash-cms/sandbox-workerd 0.9.3 on a disposable EmDash 1.2.0 site.
4. Host provisioning must create the catalog unique indexes before clerk create.
   The browser exercises creation and command replay, price refusal, stock
   toggles, reload persistence, settings and duplicate SKU rejection. Scoped
   SQLite write-refusal triggers exercise thrown failures for product/settings
   Save, retained inputs, unchanged stored values and successful retry. An
   anonymous context attempts a write. Real SQLite records and the availability
   resolver prove persisted policy without an Inventory service.
5. Screenshots and the test receipt stay under that run directory for inspection.

This proves local sandbox installation and operation. It does not prove public
Registry discovery/consent/install, an existing native upgrade, or any live
site. PR 2768 remains open, so Cloudflare development/production maintenance
proof is `NOT_RUN` and no Cloudflare claim is made here. Publication is not
authorized.
