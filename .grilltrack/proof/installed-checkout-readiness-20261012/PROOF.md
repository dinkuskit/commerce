# Registry checkout readiness

## Contract

The original Commerce Registry context exposes `GET checkout/guest/readiness` with `cacheControl: no-store`. Call it through the same installed dispatcher and runtime namespace as `catalog/public`.

- Supported: `{"schema":"dinkuskit.commerce.checkout-readiness/v1","status":"supported","mode":"test"}`.
- Unavailable: `{"schema":"dinkuskit.commerce.checkout-readiness/v1","status":"unavailable"}`.

The handler validates the original Registry identity, installed storage interfaces, request/site/configuration origin, and the existing owner-controlled Payments binding. Only an affirmative `ready: true` TEST binding qualifies. It uses the existing store-key-to-pass exchange and bounded Payments transport. It returns no account, binding, settings, key, or token details.

Reading may POST to DinkusKit.com's store-pass endpoint and GET the existing Payments binding. These are credential exchange and binding-read effects; it does not mint checkout capabilities or write carts, orders, or settings. Non-test configuration is rejected before those calls. Readiness is advisory, not a capability or a guarantee for a particular basket. Prepare does not establish Payments readiness. Start and unresolved status retain their own binding validation; a settled order can be replayed without another provider call.

## Local verification

Node 22.23.2; EmDash 1.2.0; actual compiled Registry entry loaded in workerd with its original runtime namespace and SDK storage. Service responses and credentials are explicitly synthetic fixtures. No hosted merchant, Registry publication, real provider call, or deployment is established.

- TypeScript check and official Registry build pass.
- Backend: 129442 bytes; 1630 bytes below the 131072-byte limit.
- Backend SHA256: `8f3f771cb713044f1d6e638df1363bbe91e8da36ac4d778741ee8cf157752f81`.
- Final targeted result: 60 passed, 0 failed (22 readiness, 32 existing service/settlement, 6 route tests).
- A separate compiled runtime call read `catalog/public` and readiness in the same Registry namespace with no checkout/capability records created; it passed without an Origin header as a server-side dispatcher consumer would call it.
- Sequential targeted command: `node --test --test-concurrency=1 tests/integration/registry-checkout-readiness.test.mjs tests/integration/registry-checkout-services.test.mjs tests/route-auth.test.mjs`.
- Coverage includes affirmative Stripe and Authorize.net TEST readiness, no checkout storage writes, missing/disabled/malformed/wrong-origin setup, wrong namespace and native alias, missing/refused/expired pass, missing/false readiness, mismatched/live binding, start and pending-status revalidation, canonical settlement/replay, and exact public-route inventory.
- Public repository audit runs against the staged source snapshot, excluding ignored local run output without changing the repository's audit policy.

Raw local command evidence is retained under `runs/checkout-readiness-runs/20261012/`; it is intentionally untracked.

## Local review dispositions

- Accepted: remove unrelated audit exemption for `runs`; audit the public source snapshot instead.
- Accepted: remove unrequested native route and reject native alias in Registry readiness.
- Accepted: reuse runtime binding validation, reject non-test setup before a service call, and correct prepare/status documentation.
- Rejected test assumption: deleting a fixture manifest collection does not remove the pinned SDK's dynamic storage proxy. This is not evidence of a supported missing-collection installation. No SDK or storage-policy bypass was added.

Independent exact-head OpenClaw and native ClawSweeper review results are delivery evidence associated with the pull request. They are not implied by these local checks.
