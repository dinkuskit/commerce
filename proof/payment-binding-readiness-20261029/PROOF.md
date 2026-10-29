# Payment session creation rejects malformed readiness flags

## Scope and baseline

- Commerce parent: `04dcf5e1ef296cc9ca8d719a11fec731d6961660` (`0.6.0`).
- Branch: `saarius/fix-payment-binding-readiness`, independent of the earlier CLI and catalog contributions.
- Node: `v24.22.0`; Linux x64; pinned dependencies installed with `npm ci`.
- Routine admission repair, not a change to payment policy, provider ownership, persistence, pricing, or the readiness cache. No GrillTrack state changes.
- All transport replies, credentials, merchant identifiers, orders and live-mode cases in the tests are synthetic. No real processor or production service was contacted by these tests.

## Finding

`src/features/checkout/test-payments.ts` already makes `verifyBinding()` refuse an explicit `ready` flag unless it is the boolean `true`. Successful bindings without this optional flag are accepted, because Payments' wire protocol uses HTTP success to signal current readiness.

However, `requestOutcome(request, true)` previously rejected only `ready === false`. Otherwise identical bindings with `ready: null`, `"false"`, `"true"`, `0`, `1`, `[]`, or `{}` reached `POST /v1/checkout/session`. Thus an earlier readiness result did not give creation the same fail-closed admission rule. This also matters when an earlier positive readiness result is cached: creation performs its own fresh binding check.

This is malformed service-response handling, **not** evidence that a shopper can forge the authenticated Payments binding or that a real processor charged a payment. A real Payments outage/refusal should continue to use a non-success HTTP response. The repair simply prevents a malformed explicit flag from being mistaken for permission to create a session.

The existing [installed services contract](../../docs/implementation/installed-checkout-services.md#payments-and-wake-transport) already says an explicit non-true flag fails closed. Public companion source was checked read-only at Payments `d9cdee68be8e5b470d5e564bfea1672485d6eb2a`: [hosted binding endpoints](https://github.com/dinkuskit/payments/blob/d9cdee68be8e5b470d5e564bfea1672485d6eb2a/src/hosted/http.ts#L235-L242) distinguish current readiness from historical identity. No companion code was copied or changed.

## Repair

Use the same optional-boolean condition before session creation as the existing `verifyBinding()` check:

```ts
if (create && ready.ready !== undefined && ready.ready !== true) {
  throw new Error("Payments binding unavailable");
}
```

The actual source keeps this guard on one line, consistent with the surrounding code. Missing flags and boolean `true` continue to work. Historical lookup still uses `/v1/existing-binding`, does not assert current creation readiness, and can reconcile a binding reporting `ready: false`. Identity, merchant and mode checks remain unchanged.

## Red → green evidence

Tests were added and run against the already-built upstream baseline before changing runtime source:

| Test | Before | After |
| --- | --- | --- |
| `tests/features/checkout/payment-binding-readiness.test.mjs` | exit 1: 16 pass, 32 fail | 48 pass, 0 fail |
| Four new compiled-Registry cases in `tests/integration/registry-checkout-services.test.mjs` | exit 1: 1 pass, 3 fail | 4 pass, 0 fail |

The unit runner's 32 baseline failures include four failed parent tests and 28 failed subtests (seven malformed values × two providers × two modes). Explicit boolean `false` was already denied. The new controls cover omitted flags, boolean `true`, unchanged frozen request bodies and historical lookup with `ready: false` for Stripe and Authorize.Net in both test and live configuration modes.

The Registry cases run the **actual compiled backend in workerd**. Baseline `null`, `"false"` and `"true"` responses yielded a GET followed by a session POST. After repair, all four cases yield only the binding GET, one durable attempt without a session or order, and no Orders copy. The normal full integration suite also exercises successful checkout and payment reconciliation.

## Verification

On the final runtime/test/docs tree:

- `npm run build`: pass, including Registry bundle and route-manifest checks.
- All normal unit-test globs from `test:unit`: **756/756 pass**, no skips.
- `node --test tests/integration/*.test.mjs`: **110/110 pass**, no skips, in a run not overlapped with unit tests or a build.
- Focused adapter matrix: **48/48 pass**.
- Focused compiled-Registry cases: **4/4 pass**.
- `npm run typecheck`: pass.
- `npm run audit:repo`: public repository and feature contracts clean.
- `./scripts/grilltrack --project . validate`: valid.
- `git diff --check`: clean.

Reproduce with Node 24.22.0 and installed dependencies:

```sh
npm test
# Wait for the build/unit run to finish before starting integrations.
node --test tests/integration/*.test.mjs
npm run typecheck
npm run audit:repo
./scripts/grilltrack --project . validate
```

For only the new cases, after building:

```sh
node --test tests/features/checkout/payment-binding-readiness.test.mjs
node --test --test-name-pattern='compiled Registry creation refuses' \
  tests/integration/registry-checkout-services.test.mjs
```

### Execution caveats

An initial integration attempt accidentally overlapped `npm test`'s build and failed while `dist` was being regenerated; it is not included as passing evidence. A later full integration attempt overlapped the large unit run and exceeded its 180-second budget during the existing Connect test. The Connect test then passed in isolation, the other integrations passed together, and finally **all 110 integrations passed together** without a concurrent unit/build run. An initial `npm test` attempt also exceeded a 120-second command budget; the complete unit-glob run subsequently finished successfully. These incomplete attempts are not represented as product regressions or successful full runs.

## Runtime budget and docs impact

| Registry backend | Bytes | Headroom below 131072 |
| --- | ---: | ---: |
| Upstream parent | 131033 | 39 |
| Repair | 131044 | 28 |

Backend growth: **11 bytes**. Backend SHA-256: `dd8e6018be154d4f65002d46340dee47fe521f85f029cee2f1571deaf46c38f9`.

**Docs: up to date.** The implementation contract now explicitly covers both readiness checking and creation; the website reference notes that an explicit non-true flag prevents new payment sessions without blocking historical lookup. A patch changeset records the repair. No dependency, manifest, capability, route, storage or deployment change is included.
