# Registry checkout readiness and bounded refresh

## Contract and authority

The original Commerce Registry context exposes `GET checkout/guest/readiness` with HTTP `no-store`. Use the same installed dispatcher and namespace as `catalog/public`. The public response remains:

- `{"schema":"dinkuskit.commerce.checkout-readiness/v1","status":"supported","mode":"test"}`
- `{"schema":"dinkuskit.commerce.checkout-readiness/v1","status":"unavailable"}`

Only an affirmative admitted TEST Payments binding can establish supported readiness. No keys, tokens, raw settings, account IDs or binding details enter the response or cache. Readiness is advisory, not a capability or approval of a basket. Prepare, start, unresolved status and wake reconciliation retain their independent service resolution. A previously settled order can replay without another provider call.

## Bounded refresh repair

The owner authorized this repair after both exact-head reviewers identified public-read quota amplification in `8911f2b6d89444eb13d7482d776edaa6de050657`. The engineering-selected bounds are recorded in `installed-checkout-readiness-bounds-001`:

- One versioned record at a constant key in the original installation's declared `checkout_readiness` collection.
- A supported answer expires at most 900 seconds after the refresh attempt. Failed or abandoned attempts retain a 900-second same-generation cooldown.
- At most 100 attempts in a rolling 86400-second window, with a 60-second minimum interval. The budget is charged through durable CAS before service resolution or upstream I/O.
- Owner settings/key revisions and trusted site identity form the generation. Generation changes invalidate the answer, but cannot reset the rolling history or minimum interval. Request query/header variation cannot select another budget.
- The initial claim stores unavailable. Supported publication requires unchanged generation, completion within the 30-second claim lease, and a successful CAS against that exact claim revision. Losers cannot adopt a newer writer's revision.
- Invalid shapes, timestamps, history or versions fail closed without replacing the record. Freshness is constrained by the attempt time, not an unconstrained stored expiry.

Only coordination metadata is written. No readiness call creates a checkout capability, cart or order, or changes settings. A cached answer does not constrain genuine checkout's validation or budget.

## Evidence and limits

DinkusKit [source 5c206369](https://github.com/dinkuskit/dinkuskit/blob/5c206369949dcf807607ed274ecb93849b8b65dc/src/account/config.ts) sets 1200 pass requests per fixed minute per key. Its [counter](https://github.com/dinkuskit/dinkuskit/blob/5c206369949dcf807607ed274ecb93849b8b65dc/src/account/store-passes.ts) is shared across service audiences. Payments [source d0e7115c](https://github.com/dinkuskit/payments/blob/d0e7115cd03c22c31e9674b1d8a7bd72eecf5252/src/hosted/connection.ts) reaches provider account status during binding lookup. [Stripe's documented limits](https://docs.stripe.com/rate-limits) include a 25 requests/second sandbox default and a shared Connect-platform read allocation.

A 30-second cache alone permits 86400 refreshes in 30 days per continuously active store. This repair caps a store at 100 attempts/day (3000 in 30 days); regular quarter-hour refreshes need at most 96/day. This is per-installation mitigation, not a reserved portion of Stripe's allocation or proof that a platform fleet has sufficient aggregate quota. No tenant override, hosted quota or real provider behavior was probed.

## Local verification

Node 22.23.2, EmDash 1.2.0. The integration suite loads the actual compiled Registry entry into workerd with original namespace/storage and explicitly labeled local service fixtures.

- TypeScript and official Registry package build pass.
- Backend: 130947 bytes; 125 bytes below the 131072 limit.
- Backend SHA256: `7acc7f3b7edba5fbfde3c1eb21f7c569b863887e0bb92f7d542a721ac769e9bb`.
- `node --test tests/integration/*.test.mjs tests/route-auth.test.mjs`: 97 passed, 0 failed (91 integration plus 6 exact-route checks).
- Checkout feature tests: 182 passed. Full unit suite: 542 passed from the public-source snapshot. The unchanged public-source audit passed.
- Two independent database connections using the installed SDK: 64 contenders produced one insert winner and one revision-update winner; stale writes were rejected and store namespaces remained isolated. The SDK performs conditional SQL against plugin/collection/key and exact revision.
- Compiled cases cover concurrent refresh/query bursts, failure cooldown, expiry, malformed/future metadata, key/config invalidation, rolling-budget exhaustion, superseded CAS completion, settings changing during an in-flight response, restart persistence and store isolation. Genuine start/status still validate fresh and settle one canonical order with the advisory budget exhausted.

Raw local evidence is under `runs/checkout-readiness-runs/20261012/bounded-refresh/`; generated files are untracked. The public repository audit uses a staged source snapshot so local run files do not weaken the audit policy.

## Review lineage and gates

The earlier unbounded candidate was independently reviewed through P3 by OpenClaw and by native ClawSweeper. Their P2 is a required fix under the new owner authorization, not an accepted production risk. During local review of the repair, unchecked final CAS publication and permissive timestamp validation were corrected and covered by regression tests.

The repaired immutable head requires fresh OpenClaw/native review and CI. This proof does not claim those results in advance. No merge, Registry publication, deployment, live service traffic, or hosted merchant checkout is established.
