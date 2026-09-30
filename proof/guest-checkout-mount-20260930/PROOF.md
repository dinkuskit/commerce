# Guest checkout runtime mount

- Track `gt-join-edee28c3ffe5d322451dacd0140b8af8`
- Decision `commerce-guest-runtime-mount-001`
- Retained checkout locks: `checkout-guest-001`, `checkout-hosted-first-002`,
  `checkout-stock-hold-003`, `checkout-payment-window-004`
- Base `e3d398bde103d23417c7c1a954834dadf419ec4b` (parent36 frozen draft)
- Review candidate submitted on the focused branch; exact PR head binds this proof
- Source inventory: `proof/guest-checkout-mount-20260930/source-manifest.sha256`
  (excludes only this directory and
  `proof/checkout-payment-window-20260930/` to avoid circular hashes)
- Manifest digest:
  `93cb0774c20c11ad58c23d2592a12933a527a394a8cda93dc9282183d2c12ac4`
- Public contract digest:
  `7bcd54f582134d6cca5f584d63a07cb46192b00bd062b2dc4dbc324e477c6b6e`
  (`docs/implementation/guest-checkout-public.md`)

## Initial failure history

Initial candidate was not admitted. Parent independently reproduced, against
real SQLite and compiled routes:

1. A known-site capability was accepted with runtime `siteUrl: ''`.
2. Discarding the first start response and repeating without a capability
   header created a different attempt and two durable carts.

Existing tests missed both. Public routes skipped host CSRF with no
same-origin guard. Unexpected errors rethrew raw source strings.

## Required repairs now proven

A. Mint and authorize require a trusted canonical HTTP(S) site origin from
   host constructor `siteUrl` and/or runtime `ctx.site.url`. Empty, missing,
   malformed, and conflicting scope fail closed. Native exposes both top-level
   `options.siteUrl` and `checkout.siteUrl`; contradictory known origins fail closed
   (`UNAVAILABLE`) before storage or provider access. Constructor may fill empty
   runtime and cannot mask a present public/malformed/conflicting runtime URL.
   Default Registry missing `ctx.site.url` is explicit host `UNAVAILABLE`.
   No competing Inventory store identity is minted.

B. `POST checkout/guest/prepare` mints a server capability under durable CAS
   with no attempt, reservation, or provider call. Start/status are
   capability-required. Lost prepare leaves unused capabilities only.
   Lost first start with a pre-retained capability retries the same frozen
   attempt. No browser-generated ID/query/header flag is authority.

C. Public native and Registry writes admit same-origin `request.url` plus
   declared `Origin` / `Sec-Fetch-Site` headers. Cross-origin and unsupported
   missing-origin requests fail closed before capability writes. EmDash 0.41
   Astro may also reject cross-origin POSTs before plugin JSON. Trusted
   wrappers must send `Origin` matching the site origin. Kernel auth still
   protects direct callers.

D. Unexpected provider/storage failures return guest-safe `UNAVAILABLE`
   without raw provider, storage, or secret strings. Terminal failures are
   not swallowed into fake paid.

E. Unavailable projections keep the immutable attempt and frozen price
   binding and never leak `paymentId`, provider secrets, or raw errors.
   Default production still exposes no fake Payments adapter. Registry
   cannot invoke Payments; missing site is an honest host gate.

F. Constructor options snapshot immutability: `createPlugin` takes a frozen shallow
   snapshot (`Object.freeze({ ...options.checkout, ... })`) without mutating caller
   options or throwing `TypeError` on frozen caller objects. Synthetic test fixtures
   use setup-time injection or closure delegates instead of late mutation of production options.

G. Expired and terminal redirect suppression: Guest projection suppresses `redirectUrl`
   (`null`) when in `released` or `releasing` phases or when real provider expiry has elapsed
   (`now >= attempt.session.expiresAt`), preventing late consumer navigation to expired sessions.

## Registry trusted scope

EmDash 0.41 `readSiteInfo` uses `deps.siteInfo.url`, then the options-table
value `emdash:site_url`. `buildDependencies` does not set `deps.siteInfo`, so
an existing options row is a normal host path. The worker keeps the site
snapshot from cold start. A later `options.set` does not refresh it. That is
why the default browser server, which starts before tests and only then hits
dev-bypass, still prepares as `UNAVAILABLE`. That result is fail-closed
missing scope. It is not a permanent host blocker and it is not a configured
shopper checkout.

Configured proof, this candidate: migrate a fresh database with the EmDash
SDK, insert synthetic `emdash:site_url` `http://127.0.0.1:20121` before the
first request, and start a Registry/workerd server on that port. The same
`EMDASH_SITE_URL` environment value on a second server at port 20123, with
no options row, stays missing. No shared server was killed. No
`node_modules` patch and no production Payments adapter.

| Server | Prepare | Capability rows | Carts | Inventory rows | Start |
| --- | --- | --- | --- | --- | --- |
| options row before cold start | minted | 1 | 0 | 0 | `PAYMENTS_UNAVAILABLE`, `ok: false`, HTTP 200 sandbox envelope |
| no options row | `UNAVAILABLE` | 0 | 0 | 0 | not called |

Direct-kernel repair: `requireTrustedSiteOrigin` now passes constructor,
runtime, top-level, and checkout sources, including both the retained runtime
copy and the host copy. A present empty or malformed copy is not replaced by
the other copy. Before the fix the new regression was 2 failed (conflicting
prepare minted; an existing secret was authorized). After the fix those 2
passed, with zero capability writes on the bad prepare and zero carts on the
denied authorize.

## Changed APIs and routes

- `POST checkout/guest/prepare` public
- `POST checkout/guest/start` public, capability-required
- `POST checkout/guest/status` public, capability-required
- Declared headers: `origin`, `sec-fetch-site`,
  `x-commerce-guest-capability`
- `ORIGIN_DENIED` guest-safe error
- Kernel `prepareGuestCheckout`
- Constructor `siteUrl` on `createPlugin` / `dinkusCommerce` /
  `checkout.siteUrl` is additive trusted scope
- Public contract: `docs/implementation/guest-checkout-public.md`

Frozen timing port is unchanged: `payment-window.ts` and
`docs/implementation/checkout-payment-window.md` were not rewritten.
`types.ts` only gained guest header/error surface.

## Verification

### Historical exact run

Node `v22.23.2`. This run is the earlier guest-auth candidate. It is not a
result for the source after the direct-kernel repair.

| Check | Result | Raw log |
| --- | --- | --- |
| unit | 202/202 | `21-verify-full.log` |
| integration | 21/22, one D1 failure | `21-verify-full.log` |
| D1 retry | 3/3 | `22-d1-atomicity-retry.log` |
| browser first full | 2 failed, 3 passed | `23-sandbox.log` |
| guest browser retries | 2 failed; then 1 failed and 1 passed; then 2 passed | `24`, `25`, `26` |
| later browser full | 5/5 | `27-sandbox-full.log` |
| native-local-stock | 1/1 | `28-native-local-stock.log` |

A later full-success claim of 204/204 unit, 22/22 integration, and a first
browser run of 5/5 was not backed by new raw logs. It is withdrawn. The
first saved browser full run was not 5/5.

### This candidate

Node `v22.23.2`. Focused commands only. Integration, the five-test browser
suite, and native-local-stock were not rerun, so they are not claimed for
this source.

| Check | Result | Raw log |
| --- | --- | --- |
| direct kernel before fix | 2 failed | `29-direct-kernel-scope-before.log` |
| direct kernel after fix | 2 passed | `30-direct-kernel-scope-after.log` |
| unit | 206/206 | `31-unit-full.log` |
| typecheck | pass | `33-typecheck.log` |
| audit:repo + audit:features | clean | `34-audit.log` |
| configured Registry scope | proven | `37-configured-registry-scope.log` |
| integration | not rerun | historical logs only |
| browser suite | not rerun | historical logs only |
| native-local-stock | not rerun | historical log only |

Actual Stripe **NOT_RUN**. No shipped fake production adapter. No v1-ready
or clean-review claim. The inventory digest above is this candidate.
Parent finalizes the pin.

Parent independently rebuilt and passed all 206 unit tests, typecheck, public
audits, and the native guest-storage integration check (1/1) on Node 22.23.2.
The first parent integration invocation raced with the build removing `dist`;
the retry after build completion passed. Both raw outputs are retained.
Parent also independently configured the actual Registry/workerd site before
cold start: prepare minted one capability, start reported `PAYMENTS_UNAVAILABLE`,
and carts and Inventory configuration remained empty. The owned server exited
and its port was free. A direct kernel probe refused conflicting scope without
writing a capability; frozen caller options constructed successfully.
These focused checks do not constitute a new full integration/browser run.

## Screenshot digests

The generic homepage captures below are historical and are excluded from the
current checkout proof because they do not show checkout behavior. This change
adds backend routes; current proof uses HTTP responses and durable storage.
The separate slider UI evidence remains attached to frozen draft #36.

| File | SHA-256 |
| --- | --- |
| `guest-checkout-sandbox-unavailability.png` | `ea374cf1f9c0f02e17a7718a4f4c2437cedf4a90c93beead6328319c0805521d` |
| `guest-checkout-native-unavailability.png` | `15eb35a7d51292660c2502e8c2ec8b638acb8d063e2ca67f344e2ef2ea07230c` |

## Bounds

- Draft PR submission only; no merge, release, or deploy
- No live Stripe, Inventory quantity, or receipt send
- No secret/env/credential inspection
- No cookie or querystring bearer capability
- No v1-ready, clean review, or closeout claim
- Shipping/contact/coupon/bundle remain queued human follow-ups
