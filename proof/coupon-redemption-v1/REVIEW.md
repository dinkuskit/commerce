# Parent source review

The prior parent/native review was bound to
`git:b4dbe7adb2e7f29edcfd6c50b460c38b1a0cf835`. It accepted two source findings
in this slice: the P1 monotonic-rule-version issue and the P2 nullable-attempt
`get` issue. The current working tree preserves the already-verified P1 fix and
repairs P2 by returning `null` for absent coupons or attempts while retaining
record validation, corruption fail-closed behavior, and deep-frozen clones.

Parent accepted both findings, inspected the narrow source repairs and real
SQLite regressions, and accepted the repaired source for fresh official review.
Its source identity is the SHA-256 of `source-manifest.sha256`; that manifest
covers source, tests, exports, feature audit, map, and the adoption contract.
Using Node 22.23.2 through `mise exec`, current verification passed: 18 focused
coupon tests, 233 full unit tests, build, typecheck, and repository audit.
Real EmDash SQLite tests cover missing-coupon lookup, missing-attempt lookup,
present-attempt cloning, corrupt-record fail-closed lookup, independent
connections, a child-process final-slot race, restart replay, cap edits, code
uniqueness, free completion, and frozen retry behavior.

Fresh exact-commit official review, remote CI, and human merge approval remain
pending.

Checkout and order creation, the Payments bridge, merchant and shopper UI,
and runtime storage/route/permission adoption remain owned host work. This
module is a trusted unmounted API and does not prove a complete purchase flow.
Shipping and tax remain outside coupon evaluation. The host supplies the
final overall total; a qualifying zero-total order consumes through durable
Commerce order/receipt proof with no fabricated payment identity.

Parent also accepted the second Spark review P2 on `git:54eb36d9824842aec6a7f80c4cb38ecabf80a84a`. The three-line free-session guard precedes unknown and terminal replay. Parent inspected the real SQLite pre-fix failure and 18/233 passing logs; it prevents malformed durable writes while preserving sessionless release and verified free completion. This source is accepted for fresh exact-commit review, without merge authority.
