# Commerce sandbox admin proof — 2026-09-26

## Exact source

Source snapshot: [source.sha256](source.sha256), SHA-256
4e72b33f1276713b19a5b44c83c9782fd802515abb21088af38cc92b0e50b405.
It binds source, tests, build/config and locked dependencies independently of
later documentation/ledger commits. All captures below use that same source.

## Reproduction and outcome

Node 22.23.2; exact EmDash 0.41.0; plugin CLI 0.12.0; Block Kit 0.41.0;
workerd sandbox runner 0.8.2. Fresh SQLite host on 127.0.0.1:64525; no live
shop, no public registry changes, no Inventory service or payment connection.

Run npm ci, install Chromium, then CI=1 bin/verify-commerce full with localhost
excluded from proxying (gateway verification also removes inherited proxy
variables). See [full.txt](full.txt): exit 0, typecheck/build/manifest validation,
122 unit tests, 19 integration tests, repository/feature audit, and one real
workerd/SQLite browser workflow. Final browser run: 1790471641291.

The host installs the built descriptor into sandboxed, not native plugins.
The released CLI builds the artifact from emdash-plugin.jsonc + src/plugin.ts;
plugin code runs in the workerd isolate. EmDash renders Block Kit in the browser.
The unique indexes are host-provisioned; create waits for them and the kernel
proves their actual enforcement. No alternate mock storage is installed.

## Observable operations

- Anonymous write denied; settings unchanged.
- Name + SKU creates one unmanaged draft. Exact command replay returns it,
  never a second record. Duplicate SKU is refused with typed inputs retained.
- Missing Regular stays non-listable. Regular 12 / Sale 10 persists as USD
  Money minor strings 1200 / 1000. Invalid precision and Sale above Regular
  are refused, preserving the stored pair and typed fields.
- Manage stock hides manual radios; Save persists setup-required. Reload keeps
  it on. Off restores dormant Out of stock, leaves prices intact, and contacts
  no Inventory service. Managed-without-setup availability is unavailable.
- Commerce Settings → Catalog persists Hide out-of-stock products across reload.
  The real kernel resolver, reading the actual SQLite records, changes listing
  policy without inventing stock. Admin still offers the product.
- Real SQLite write-refusal triggers cause thrown product/settings saves.
  Forms, choices and Save remain available; stored values remain unchanged;
  removal of the failure lets the clerk retry successfully.
- Desktop and mobile captures inspected; no overflow or hidden required controls.

## Review regression: red → green

[recovery-red.txt](recovery-red.txt) demonstrates the old adapter failure:
price storage rejects the write, then Regular textbox is absent instead of
retaining 13.25. The repair extracts render-only form responses; catch recovery
never depends on another storage read and says Save was not confirmed.
[recovery-green.txt](recovery-green.txt) and the final full run pass both product
and settings failures plus retry. No test-only production injection was added.
The scoped failure trigger exists only inside the disposable proof DB.

## Media provenance and limits

Nine PNGs were captured after Playwright assertions, with animations disabled,
at 1440×1000 or 390×844. They contain synthetic Red hat / RED-HAT and Dev Admin,
not customer data. No cookie, token, private portal URL, or local path is visible.
No pixel redaction needed. Media bytes/hashes and the final product git SHA are
recorded in the dinkus-pr-assets release linked from the PR, not committed here.

No public storefront screenshot is claimed: this change rebuilds admin delivery;
it does not add an H1 renderer or storefront page. Real resolver/storage proof
covers the public availability contract. No native-to-sandbox data migration,
Registry discovery/consent/install, mounted Cloudflare index fix, publication,
live deployment, or checkout compatibility is claimed. Native API storage remains
camelCase; fresh sandbox storage is snake_case. Do not substitute on an existing
populated native store.

Review/adjudication: [sandbox-admin-review](../../docs/implementation/sandbox-admin-review.md).
