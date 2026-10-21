# Review Record — `shopper-accounts-v1-20261020` (Round 2)

- **PR**: `dinkuskit/commerce#152`
- **Reviewed SHA**: `8fd3828d0a68b9a0a87bfc7ab65f8a633f1a39d8`
- **Reviewer**: ClawSweeper (`issuecomment-6305823338`, Revision 2, `github-run-39531132720-1`) + JevSweeper (`jev-1.13.0`)
- **Result**: `findings` (`required_fix`) — all 5 Round 1 findings confirmed resolved; 3 bounded failure-path/legacy-order defects identified.

## JevSweeper Adjudication

1. **`[P2]` Fence first-send failure cleanup by challenge revision** (`src/features/customers/account.ts`) — `repair` (`confidence: 0.98`)
   - Replaced unconditional `delete(emailKey)` on first-send `sendEmail` failure with revision-checked `compareAndSet(emailKey, cas.revision, rollback)` retiring only `cas.revision` (`issuedAt: 0, expiresAt: 0, consumed: true`) so a replacement challenge issued after the 30-second cooldown is never deleted by a delayed first-send error.
2. **`[P2]` Guard legacy order email values before normalization** (`src/features/orders/store.ts`) — `repair` (`confidence: 1.00`)
   - Guarded `typeof rawEmail === "string"` in `listOrdersForEmail` (and `typeof phone === "string"` in `projectShopperOrder`) so pre-upgrade orders with admitted non-string `contactSnapshot.contact.email` values do not throw during order filtering or profile initialization.
3. **`[P3]` Detect profile seed changes independently of timestamps** (`src/features/customers/account.ts`) — `repair` (`confidence: 1.00`)
   - Changed `ensureCustomerProfile` to compare `seededDelivery !== current.delivery || seededPhone !== current.phone` directly instead of `nextRecord.updatedAt === current.updatedAt`, persisting newly seeded fields even when an order arrives within the same second as profile creation.
