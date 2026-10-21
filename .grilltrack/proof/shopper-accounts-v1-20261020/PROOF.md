# Proof: Shopper Accounts (`shopper-accounts-v1-20261020`)

- **Repository**: `dinkuskit/commerce`
- **Decision ID**: `shopper-accounts-v1-20261020`
- **Decision Branch**: `codex/shopper-accounts-decision-20261020` (`1a0fc40`)
- **Implementation Branch**: `codex/shopper-accounts-v1-20261020`
- **Worktree**: `/Users/bobbybones/Developer/worktrees/commerce-shopper-accounts-v1-20261020`

## Delivered Surface

1. **Identity & Storage Boundary (`dinkus.customers`)**:
   - Store-local shopper accounts in `@dinkuskit/commerce` plugin storage (`customers`, `customer_login_codes`, `customer_sessions` on Registry/sandbox; `customers`, `customerLoginCodes`, `customerSessions` on native), completely outside EmDash CMS `users`.
   - Declares `"email:send"` in `emdash-plugin.jsonc` and native `createPlugin()`.
2. **Passwordless 6-Digit Email OTP Sign-In & Origin-Bound Capability**:
   - `account/sign-in/start` (`POST`): Validates same-origin write headers (`origin` / `sec-fetch-site`), normalizes email, enforces a 30-second cooldown across active, consumed, and exhausted challenge records, stores a SHA-256 hashed 6-digit code (`10`-minute TTL, max `5` attempts, `consumed: false`), and sends the code via `ctx.email.send(...)` (retiring/restoring only `cas.revision` via `compareAndSet` if email delivery throws).
   - `account/sign-in/verify` (`POST`): Atomically claims the attempt budget (and sets `consumed: true` on match) via `compareAndSet` on the exact challenge revision before branching or minting a session, failing closed with `CONTENTION` on concurrent races and `CODE_INVALID` on exhausted/consumed/replaced codes. Mints an origin-bound session token (`<sessionId>.<secret>`, SHA-256 hashed at rest, `x-commerce-customer-session` header, `retention: "json-body"`), and returns the shopper profile.
   - `account/sign-out` (`POST`): Revokes the active customer session record.
3. **Automatic Order History Linking & Saved Shipping Address**:
   - `account/orders` (`GET`): Authenticates `x-commerce-customer-session` before any `orders` or `customers` storage read and returns all orders in `orders` matching the verified email (compared case-insensitively via `listOrdersForEmail` after guarding `typeof email === "string"`), sorted by `paidAt` timestamp descending first (then order `number` descending, then `orderId` descending), projecting shopper-safe order facts (`orderId`, `receiptId`, `number`, `status`, `paidAt`, `total`, `lines`, `choices`, `pricing`, `delivery`, `phone`, `completed`).
   - `account/profile` (`GET`, `POST`): Auto-seeds `delivery` and `phone` from the newest order by payment time only while those fields are `undefined` (detecting field changes independently of timestamp second granularity), and preserves explicitly cleared `delivery: null` or `phone: null` fields across subsequent profile/orders/sign-in reads.

## Round 1 & Round 2 Review Repairs (`REVIEW-1.md`, `REVIEW-2.md`, `Fixes #154`)

1. **`[P1]` Atomic OTP revision consumption before session minting (`#154`)**: Replaced unconditional `delete(emailKey)` in `verifyShopperSignIn` with revision-checked `compareAndSet` marking `consumed: true` on `stored.revision` before minting a session. Added deterministic two-party `getVersioned` barrier regressions in both `tests/features/customers/shopper-accounts.test.mjs` and `tests/integration/shopper-accounts-runtime-cases.mjs` (`WorkerdSandboxRunner` + SQLite `PluginStorageRepository`) proving two simultaneous valid-code submissions against the same challenge produce `[true, false]` and `sessionsCreated === 1`, and proving stale/expired verification cannot delete a newly issued replacement challenge.
2. **`[P1]` Atomic attempt reservation before code evaluation**: `verifyShopperSignIn` atomically claims `attempts: challenge.attempts + 1` on `stored.revision` via `compareAndSet` before branching on code match or minting a session, failing closed with `CONTENTION` on concurrent races.
3. **`[P2]` Resend cooldown preserved across exhaustion and consumption**: `customer_login_codes` records remain in storage with `issuedAt`, `attempts`, and `consumed` rather than being deleted on verification or 5-attempt exhaustion, so `startShopperSignIn` enforces the 30-second `LOGIN_CODE_COOLDOWN_SECONDS` window even after 5 wrong guesses.
4. **`[P2]` Explicitly cleared profile fields preserved across reads**: `CustomerRecord` persists `phone: null` and `delivery: null` when cleared via `POST account/profile`, and `ensureCustomerProfile` only seeds from historical orders when a field is `undefined`.
5. **`[P2]` `paidAt`-first order chronology**: `listOrdersForEmail` sorts by `paidAt` timestamp descending before order `number` so older payments that receive a higher order number on delayed/retried handoff do not sort ahead of newer orders or overwrite default address seeding.
6. **`[P2]` Revision-fenced first-send failure cleanup**: When `sendEmail` throws on the initial challenge (`!existing`), `startShopperSignIn` retires only `cas.revision` via `compareAndSet(emailKey, cas.revision, { ...record, issuedAt: 0, expiresAt: 0, consumed: true })` instead of calling unconditional `delete(emailKey)`, so a replacement challenge issued after the 30-second cooldown survives a delayed first-send error.
7. **`[P2]` Legacy non-string order contact email guard**: `listOrdersForEmail` guards `typeof rawEmail === "string"` (and `projectShopperOrder` guards `typeof phone === "string"`) so admitted pre-upgrade legacy order rows with non-string `contact.email` values do not break shopper sign-in or order history reads.
8. **`[P3]` Timestamp-independent profile seed change detection**: `ensureCustomerProfile` checks `!current || seededDelivery !== current.delivery || seededPhone !== current.phone` directly instead of comparing `updatedAt` strings, persisting newly seeded order details even when an order arrives within the same second as initial profile creation.

## Production-Path & Upgrade Compatibility Proof (`tests/integration/shopper-accounts-runtime-cases.mjs`)

- Exercises the compiled `dist/sandbox/plugin.mjs` + `dist/sandbox/manifest.json` inside `WorkerdSandboxRunner` backed by `BetterSqlite3` + `Kysely` + `PluginStorageRepository` and the real `email/send` workerd bridge:
  - **Existing-install upgrade compatibility**: Seeds a pre-PR EmDash 1.2.0 SQLite database (without `customers`, `customer_login_codes`, `customer_sessions`, or `email:send`) with `catalog_items`, `catalog_prices`, `catalog_manual_availability`, and `orders` (`ord_newer_paid` `#1001` at `2026-10-20T15:30:00.000Z`, `ord_older_retried` `#1002` at `2026-10-18T08:15:00.000Z`, `ord_other_shopper` `#1003`, and legacy non-string contact row `ord_legacy_nonstring_contact` `#1000` with `{ contact: { email: 12345, phone: 67890 } }`), upgrades in place to the current manifest/bundle, confirms existing catalog/order data survives, and runs the shopper account lifecycle.
  - **Fresh-install under both `COMMERCE_REGISTRY_RUNTIME_ID` (`r_gshdrqaldna3r7sn`) and `INSTALLED_COMMERCE_PLUGIN_ID` (`dinkus-commerce`)**: Loads the compiled bundle under both canonical installation IDs, verifies that replaced OTP codes fail closed with `0` session rows in SQLite, and proves concurrent two-party barrier submissions of the same valid OTP code produce `concurrentVerifications = [true, false]` and `1` session row in SQLite.
  - **Authority chain & signed-out isolation**: Verifies cross-origin rejection (`ORIGIN_DENIED` with `0` emails sent), 5-attempt budget exhaustion + preserved `RATE_LIMITED` cooldown in SQLite, allowed shopper access with `paidAt`-first order sorting (`#1001` before `#1002`) and cross-shopper exclusion, `null` preservation after clearing `phone`/`delivery`, and `SESSION_DENIED` after sign-out with SQLite query logging proving `["customer_sessions"]` is the only collection touched.

## Verification Results

- `bin/verify-commerce quick`: **PASSED**
  - `tsc --noEmit`: 0 errors
  - `npm run build:sandbox`: `registry_bundle=pass` (`public_routes=12 routes=14`)
  - `npm run test:unit`: `624/624` passed (including `tests/features/customers/shopper-accounts.test.mjs` and `tests/route-auth.test.mjs`)
  - `npm run audit:repo`: `public_repository_contract=clean`, `feature_contract=clean`
- `npm run test:integration`: **PASSED** (`101/101` passed, including `tests/integration/shopper-accounts-runtime-cases.mjs`)
- `npm run test:consumer:native`: **PASSED** (`native_npm_consumer=pass declared-exports installed-native-admin foreign-origin-denial`)
