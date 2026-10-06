# Coupon Registry candidate proof

The current source candidate passes the official self-contained package
validator and the complete composed verifier. `PACKAGE-CURRENT.json` binds the
source and dependency versions to the exact archive/backend hashes and bytes;
`VERIFICATION.json`, `HTTP-MATRIX.json` and `INSTALLED-PROFILE.json` record the
acceptance boundary. `SOURCE-REVIEW.json` records parent findings and dispositions.

- Composed verification: 264 unit,22 integration,5 existing browser,1 native
  development stock-toggle,1 installed coupon browser test; all pass.
- Official decompressed backend: 106,143 bytes (limit131,072).
- Actual EmDash1.0.1 workerd installed-profile HTTP/Block Kit flow proves
  create/edit/disable, invalid-draft retention, stale CAS, normalized collision,
  maximum supported fixed-money precision, usage and reload persistence.
- 51 HTTP matrix rows cover Editor coupon denial across declared pages and
  forged body privileges, lower/invalid/anonymous callers, missing/undeclared
  page context, method/CSRF policy, and genuine dispatcher scope policy. The
  coupon storage observer has a positive control; denied requests execute zero
  coupon queries. Editors retain Product create/price-save and Settings save.
- Genuine public RBAC helper bundles agree across every declared permission
  and valid/invalid roles. Compiler guards reject dependency/source drift and
  stale/dynamic catalogs. Mixed locale instances stay request-local.

The fixture seeds unsigned Registry install state and uses the real
Registry storage loader, derived plugin ID, route policy, workerd sandbox and
index materializer. It has no configured Commerce descriptor. It does not
prove authoritative publisher records, signature/aggregator admission, site
consent or a published Registry installation. Scope probes inject test scopes
into the genuine dispatcher; bearer-token authentication is not exercised.
English is the only coupon translation; the visible Arabic host layout uses
English fallback. No provider purchase, new money/order writer or network grant.

Historical evidence: `package-boundary.json` is the original 216,639-byte
oversized artifact, and `build-sandbox-failure.log` is an initial reconstructed
failure summary. Both remain historical. Initial local profile/index/observer
failures and the first RTL loading capture remain in ignored working proof;
only the final visible captures are selected for the designated asset shelf.
Formal exact-head reviews and owner merge/Registry release remain pending.

CI run 37474654247 exposed a default run-directory mismatch between the
Playwright config's server and worker evaluations. The generated run identity
is now inherited by the worker. The installed browser profile passes with
`COMMERCE_PROOF_RUN` unset; cleanup no longer masks an earlier failure by
updating a disposable database. Production/package sources and the frozen
archive remain unchanged from the composed source above.

Selected sanitized media and their hash/provenance manifest are preserved in
the immutable [83a24cdd3dff evidence release](https://github.com/dinkuskit/dinkus-pr-assets/releases/tag/commerce-pr-46-83a24cdd3dff).
The release belongs to the actual capture/build source, independently of
subsequent proof and fixture-only commits. No binary proof enters this repo.

| Claim | Selected evidence |
| --- | --- |
| Empty state and successful creation | `coupons-empty.png`, `coupon-created.png` |
| Stale revision retains draft and requires reopen | `coupon-stale.png` |
| Maximum fixed-money value survives reload | `coupon-fixed.png` |
| Usage and disable state persist | `coupon-usage.png`, `coupon-disabled.png` |
| Editor receives guarded denial | `coupon-editor-denied.png` |
| Arabic host layout renders English fallback | `coupons-arabic-direction.png` |
