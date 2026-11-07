# Commerce storefront maintenance readiness

Base: `6d8e7ed737e5396eb5f7781a216c120b77844cd9`. Scope: only the local
storefront test fixture, its setup request and four boundary tests. No product,
package pin, verifier selector, production timer or installed-consumer change.

## Behavior and preservation

Pinned EmDash 1.4.0 materializes configured-plugin storage indexes from its
maintenance tick. The first Node scheduler tick can wait 60 seconds. A diagnostic
run measured 58.083s in the existing SQLite-index readiness poll.

The dev-and-loopback-only POST fixture route now invokes public
`runScheduledTasks` from `emdash/middleware` on the initialized Astro server.
It fails visibly without a runtime, on operation errors, or on unexpected
publishing. Both successful candidate runs observed the index absent before
maintenance and present after the original 90s poll. The actual index remained
unique; the fresh synthetic databases had no backup settings or last-run rows.
No SQL index is created or seeded by the fixture.

All seven original browser cases, their assertions, one worker and zero retries
remain. The four unit tests cover fallthrough, development/loopback/method/runtime
guards, successful callback handling, and operation/nonempty-publishing failures.
Setup now explicitly drives the same maintenance path instead of waiting for an
automatic tick. This does **not** verify production periodic cadence. Existing
Commerce/Inventory retry and background-check contracts remain untouched.

## Measurements and reliability limit

Canonical command: `bin/verify-commerce storefront`, including its build.
Node 24.22.0, Linux arm64, exact locked dependencies; dependency/compiler caches
warm, a fresh canonical build and new SQLite run path per sample. Acceptance
was declared before candidate timing: at least 20s and 20% median elapsed
reduction, no systematic CPU regression above 5%, and original case coverage.
Baseline runs restored original test bytes and absence of both new fixture files.
Case identity comparison used project, relative file and full title; source-line
shifts were recorded separately.

| Attempt | Result | Seconds |
| --- | --- | ---: |
| B1 | 7 passed | 146.907 |
| C1 setup refusal | stale task-owned dev lock; no cases ran | 5.367 |
| C1 qualified | 7 passed | 83.611 |
| C2 | 5 passed, 2 failed | 79.310 |
| Diagnostic | first case only; passed | 47.167 |
| B2 | 7 passed | 145.001 |
| C3, unchanged candidate | 7 passed | 85.500 |

Among successful full runs, median elapsed was 145.954→84.555s, a 61.398s
(42.07%) reduction. Median waited-child CPU was 65.467→62.642s (4.32% lower).
This is a conditional latency result: **one of three full candidate runs failed**.
C2 missed the existing duplicate-SKU refusal text; its dependent media case then
failed. The index was unique and one RED-HAT record remained. Cause is unresolved.
A passive diagnostic reproduced neither failure nor delay: the POST completed
in 31.074ms with HTTP200 and the expected duplicate-SKU refusal. No response wait,
timeout or business behavior was changed to conceal this result.

The early setup refusal came from an old task-generated Astro lock combined with
per-command PID namespaces. Only the proven-stale fixture lock was removed after
its owner ended and its port was unused; subsequent samples used the same reset.
No cache clearing or process-name kill was used. The diagnostic profile/repro and
failed attempts remain separate from successful-run timing.

Full `bin/verify-commerce full` is pending on the frozen committed head. Its
terminal result and exact-head CI/reviews belong in the PR/current run records.
No whole-workflow, hosted critical-path or invoice saving is claimed.
Exact numbers, source hashes and limitations: [measurements.json](measurements.json).
