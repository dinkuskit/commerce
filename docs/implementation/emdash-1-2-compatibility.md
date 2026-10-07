# EmDash 1.2 compatibility migration

This migration repins the existing Commerce integration to the published
EmDash 1.2 composition without changing Commerce checkout, catalog authority,
managed-stock, guest-route, or capability policy.

## Current package contract

- `emdash`, `@emdash-cms/auth`, and `@emdash-cms/blocks`: `1.2.0`.
- `@emdash-cms/plugin-types`: `0.6.0`.
- `@emdash-cms/plugin-cli`: `0.13.3`.
- `@emdash-cms/sandbox-workerd`: `0.9.3`.
- `@emdash-cms/registry-verification`: `0.3.4`.
- `@emdash-cms/registry-client` and `@emdash-cms/registry-lexicons`: `0.7.0`,
  unchanged.
- The manifest records the published `emdash@1.2.0` npm integrity:
  `sha512-f9s7khWeuOxX5cRimlu9o224hn9TuKnYk/0Vsu1CS9oaVn78V1+MWyfEsZc2iDv8JYWrezEZFkpy/Q6pRgVgzg==`.
- The package remains private at `0.0.0`; publication, Registry installation,
  deployed provider access, and live Stripe calls are not part of this proof.

The historical [EmDash 1.0.1 compatibility record](./emdash-1-0-1-compatibility.md)
is retained as version-bound evidence and is not rewritten by this migration.

## Compatibility proof boundary

The compiled Commerce sandbox is loaded by the published
`WorkerdSandboxRunner` against the actual SDK `PluginStorageRepository` and
`createSettingsAccess` implementations over SQLite. The proof covers:

- the current derived Registry runtime ID `r_gshdrqaldna3r7sn`;
- empty production manifest capabilities and hosts;
- capability-only guest `prepare`, with canonical pricing owned by `start`;
- zero- and positive-payable checkout, replay, coupon idempotency, wake
  reconciliation, origin and credential separation, and managed-stock
  fail-closed behavior;
- CAS and unique-index behavior through the SDK storage repositories;
- persistence across runtime and database connection restart without reseeding representative
  catalog, price, settings, order, and coupon records.

The Registry backend file-size limit remains `131072` bytes and is enforced through the
existing official SDK/runtime boundary. The measured bundle size and remaining
headroom are recorded in the ignored migration proof after the verification
run. No unsafe cap bypass or fallback renderer is used.

## Upgrade-specific checks

The configured 1.2 sandbox now supplies its trusted site URL before plugin
load. Both local host formats therefore admit same-origin `prepare`; it only
mints a capability. Without Payments configuration, `start` still returns
`PAYMENTS_UNAVAILABLE`, with no cart, payment, cookie, or shared-cache response.
Foreign origins, malformed carts, guessed capabilities, and anonymous admin
access remain denied.

The exact-source Auth build transform now audits the added Microsoft claim
schema initializer. It only constructs validators; the transform can drop it
when its provider is unused. Package, source, and initializer hash guards stay
fail-closed, and the existing emitted permission-helper equivalence test covers
valid and invalid roles. The resulting backend remains 130953 bytes, with
119 bytes below the official 131072-byte file cap.

A synthetic database created by published 1.0.1 migrations was reopened with
1.2.0. Only `090_redirect_enable_loop_guard` and `091_redirect_artifacts`
applied; existing content revisions, media, site settings, and plugin rows
were identical afterward. Repeating migration was a no-op. This is a local
SQLite version-transition probe, not a production database upgrade.

Supplemental inspection invokes the actual installed 1.2 middleware cache
guard with isolated contexts: anonymous public responses remain eligible,
while signed-in, private, and no-store responses opt out. Real local guest
HTTP checks also assert no-store. This does not qualify deployed shared edge
caching, a real identity provider, Registry publication, or a live provider.

Current verification: 301 unit tests, 37 integration tests, 5 native/sandbox
browser checks, the native development stock-toggle browser, and the installed
coupon browser pass. Local artifacts are unsigned and private; historical
1.0.1 proof stays bound to its original version.
