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
   - `account/sign-in/start` (`POST`): Validates same-origin write headers (`origin` / `sec-fetch-site`), normalizes email, enforces a 30-second cooldown, stores a SHA-256 hashed 6-digit code (`10`-minute TTL, max `5` attempts), and sends the code via `ctx.email.send(...)`.
   - `account/sign-in/verify` (`POST`): Consumes the single-use 6-digit code in constant time, mints an origin-bound session token (`<sessionId>.<secret>`, SHA-256 hashed at rest, `x-commerce-customer-session` header, `retention: "json-body"`), and returns the shopper profile (auto-seeded from their newest order when unset).
   - `account/sign-out` (`POST`): Revokes the active customer session record.
3. **Automatic Order History Linking & Saved Shipping Address**:
   - `account/orders` (`GET`): Authenticates `x-commerce-customer-session` and returns all orders in `orders` matching the verified email (compared case-insensitively via `listOrdersForEmail`), newest first, projecting shopper-safe order facts (`orderId`, `receiptId`, `number`, `status`, `paidAt`, `total`, `lines`, `choices`, `pricing`, `delivery`, `phone`, `completed`).
   - `account/profile` (`GET`, `POST`): Reads or updates the shopper's single default `CheckoutDeliveryAddress` (validated against `normalizeCheckoutDelivery` and the store's `shippingCountries`) and optional phone (`requirePhoneNumber` enforced).

## Verification Results

- `bin/verify-commerce quick`: **PASSED**
  - `tsc --noEmit`: 0 errors
  - `npm run build:sandbox`: `registry_bundle=pass backend_bytes=129404 headroom_bytes=1668 backend_sha256=ea45bbc2ee08e2033b0cb845a41526694880670ef4aa823daaa567571d5b0feb` (`public_routes=12 routes=14`)
  - `npm run test:unit`: `621/621` passed (including `tests/features/customers/shopper-accounts.test.mjs` and `tests/route-auth.test.mjs`)
  - `npm run audit:repo`: `public_repository_contract=clean`, `feature_contract=clean`
- `npm run test:integration`: **PASSED** (`99/99` passed, including `tests/integration/registry-checkout-services.test.mjs` workerd runtime verification)
- `npm run test:consumer:native`: **PASSED** (`native_npm_consumer=pass declared-exports installed-native-admin foreign-origin-denial`)
