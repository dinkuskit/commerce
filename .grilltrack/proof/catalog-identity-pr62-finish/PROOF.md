# Matched installed browser proof for PR62

Both detached main at `e5a918969cf2804a7e6df40614b8057562ae7c91` and the candidate runtime at `e45e9bd81cacb2e75f863f7ee089645fd4e7b163` passed `npm run build` and `npm run test:sandbox:coupons` under Node 22.23.2 (the repository pin), npm 10.9.8 and Playwright 1.61.1. The candidate repair changes only decision lineage, documentation and this proof; runtime and test sources are unchanged from that candidate revision.

Both used the same lockfile, fixture and installed profile with separate physical dependency trees, fresh disposable databases and sequential runs on the same port. Both completed the packaged coupon scenario covering validation, conflicts, reload and forbidden actions. The retained screenshots show the same synthetic public product added to the cart. Payments are intentionally unconfigured in this fixture.

The extracted backend is 128,497 bytes on main and 129,476 on the candidate: +979 bytes, leaving 1,596 bytes under the 131,072-byte cap. Exact hashes and run identifiers are in `measurements.json`. The earlier 128,485-byte historical artifact is not this baseline. The earlier 210,216-byte local main measurement used a dependency layout that did not reproduce the official build; this physical-dependency pair replaces it for interpreting the delta.

The prior Node 22.14.0 run reported `statement.columns is not a function`. Node documents that API as added in 22.16.0; the older runtime was below the repository requirement. Both pinned-runtime runs now complete migration and the browser test. This does not establish the old failure as a source defect on main.

Duplicate-page tests remain a Commerce host-contract stand-in. Actual host enforcement remains Template resolver #34; this browser proof does not claim that work is implemented.

The ledger recovery uses GrillTrack's canonical validated writer, keeps all 50 decisions and existing history, moves the external Template issue to context, and appends the recovery event. `grilltrack_ledger.py validate`, `npm run audit:repo`, and `git diff --check` pass.
