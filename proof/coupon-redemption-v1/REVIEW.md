# Parent source review

The source identity is the SHA-256 of `source-manifest.sha256` in this directory.
The manifest covers the coupon module, coupon tests, package export, feature
audit, feature map, and adoption contract. Ledger and review metadata are
excluded to avoid a recursive identity.

Accepted findings were repaired: separate counting authorities and synthetic
rules, mutable/incomplete quote snapshots, stale rule rejection of identical
retries, terminal hold resurrection, malformed/free/payment proof admission,
concurrent duplicate free completion, date inference, code lookup and unique
edits, corrupt stored arithmetic, minimum-spend capacity consumption, and an
unsupported permission label. No required source fix remains in this slice.

Independent parent verification uses Node 22.23.2: build, typecheck, repository
audit, ledger validation, and diff whitespace check passed. All 15 coupon tests
and all 230 unit tests passed. Real EmDash SQLite tests exercise independent
connections, a child-process final-slot race, restart replay, cap edits, code
uniqueness, free completion, and frozen retry behavior.

The source is accepted for pull-request review. Exact-commit Spark-2 review,
native ClawSweeper, remote CI, and human merge approval remain pending.

Checkout and order creation, the Payments bridge, merchant and shopper UI,
and runtime storage/route/permission adoption remain owned host work. This
module is a trusted unmounted API and does not prove a complete purchase flow.
Shipping and tax remain outside coupon evaluation. The host supplies the
final overall total; a qualifying zero-total order consumes through durable
Commerce order/receipt proof with no fabricated payment identity.
