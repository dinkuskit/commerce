# Review Record — `shopper-accounts-v1-20261020` (Round 1)

- **PR**: `dinkuskit/commerce#152`
- **Reviewed SHA**: `6f2646665d3983b4bc1d7c026496de9892e523ca`
- **Reviewer**: ClawSweeper (`issuecomment-6305823338`, run `39527536105`) + JevSweeper (`jev-1.13.0`)
- **Result**: `findings` (`required_fix`)

## JevSweeper Adjudication

1. **`[P1]` Atomically consume the exact OTP revision before minting a session** (`src/features/customers/account.ts`) — `repair` (`confidence: 1.00`)
   - Replace unconditional `delete(emailKey)` after code verification with revision-checked `compareAndSet` marking the exact challenge revision consumed before minting a session.
2. **`[P1]` Reserve verification attempts atomically before checking codes** (`src/features/customers/account.ts`) — `repair` (`confidence: 1.00`)
   - Atomically increment and claim the attempt budget via `compareAndSet` on `stored.revision` before evaluating the OTP hash, failing closed on CAS contention.
3. **`[P2]` Preserve resend cooldown state after exhausting or consuming a code** (`src/features/customers/account.ts`) — `repair` (`confidence: 0.98`)
   - Keep `customer_login_codes` records on exhaustion/consumption (`consumed: true` / `attempts >= 5`) rather than deleting them so `issuedAt` enforces the 30-second resend cooldown window.
4. **`[P2]` Preserve explicitly cleared profile fields across reads** (`src/features/customers/account.ts`) — `repair` (`confidence: 0.98`)
   - Seed `delivery` and `phone` from historical orders only when creating the `CustomerRecord` for the first time (`!existing`), so explicitly cleared `delivery: null` or `phone: null` fields are not re-populated from historical orders on subsequent reads.
5. **`[P2]` Sort shopper orders by payment time before order number** (`src/features/orders/store.ts`) — `repair` (`confidence: 0.97`)
   - Sort `listOrdersForEmail` by payment timestamp (`paidAt`) descending first, then by `number` descending, then by `orderId` descending.
6. **Production-path & compatibility proof** (`tests/integration/shopper-accounts-runtime.test.mjs`)
   - Add real `WorkerdSandboxRunner` + SQLite `PluginStorageRepository` integration proof covering allowed shopper access, cross-shopper exclusion, consumed/replaced/exhausted OTP rejection before session persistence, signed-out session rejection before storage reads, and fresh-install + pre-PR SQLite upgrade compatibility.
