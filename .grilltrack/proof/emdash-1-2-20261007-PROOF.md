# EmDash 1.2 compatibility proof

Source identity: `sha256:88d93dcb56d6fb03f410541cbdc7e21adde973d106840b409d081937dca6b9b3` (canonical sorted repository path/content SHA-256
pairs excluding lifecycle and proof files).
Baseline: `76c440c2f4fb7bc1d443b1ad7808a87e67ade52a`.

- Exact existing pins: EmDash/Auth/Blocks 1.2.0, plugin-types 0.6.0,
  CLI 0.13.3, sandbox-workerd 0.9.3. Admin resolves 1.2.0 and verifier 0.3.4;
  registry client/lexicons remain 0.7.0. No unused direct packages added.
- `npm run typecheck`, `npm run test:unit`: PASS, 301 tests, including
  original versus optimized permission outcomes and hash-failure guards.
- `npm run test:integration`: PASS, 37 tests. Actual compiled workerd/SDK
  storage preserves zero/positive orders, coupon-once, authorization, stock
  fail-closed, retry/CAS and restart. Added admin-price/storefront/checkout
  consistency test uses one original storage owner; prepare does not freeze price.
- `npm run test:sandbox`: PASS, 5 tests; both guest host formats retain no-store,
  no Payments start, tampered-cart/capability denial and private admin access.
- `npm run test:sandbox:native-local-stock` and `npm run test:sandbox:coupons`:
  PASS, one browser each. Native Coming soon slider and synthetic admin forms
  were visibly inspected on EmDash 1.2.0.
- `npm run audit:repo`, `git diff --check`: PASS.
- Published 1.0.1 schema -> 1.2.0 local SQLite probe applies only migrations
  090/091, preserving content revisions, media, options, and plugin rows.
  Repeated migration is a no-op; no existing site was reseeded or modified.
- Actual installed core cache guard rejects shared caching for signed-in,
  private, and no-store responses; anonymous public response stays eligible.
  This isolated guard probe supplements local HTTP checks and is not deployed
  edge cache qualification.
- Official unsigned `bundlePlugin` validation: PASS. Backend 130953/131072 bytes;
  SHA-256 `0f017b32c89f7846437c291f0b48699977617092fced426aef2016692af1c184`.
  npm and Registry archive backends are byte-identical. Production capabilities
  and allowed hosts remain empty. No limit bypass.

Parent standards/source-intent adjudication: clean. The initial old sandbox
prepare expectation was replaced by explicit 1.2 trusted-site capability and
unchanged fail-closed start checks. The audited new pure schema initialization
was required to retain Registry size compatibility; exported permissions stay
unchanged. Historical 1.0.1 proof is preserved.

Limits: synthetic transport and local installed host proof; no public Registry
install, deployed cache, real credentials/grants, provider calls, publication
or deployment. Native/Registry namespace continuity remains separately scoped.
