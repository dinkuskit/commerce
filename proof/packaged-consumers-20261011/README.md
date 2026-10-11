# Packaged consumer acceptance

The existing Orders Registry harness now also exercises merchant settings and
checkout against the extracted final unsigned local Registry artifact. It checks
backend identity, settings persistence, anonymous-write denial without canonical
mutation, guest capability preparation, foreign-origin denial before storage,
and checkout failing closed without a Payments provider.

A separate clean temporary npm consumer installs the actual `npm pack` archive
outside the repository, with no source aliases or linked repository modules. Its
minimal host uses the existing lockfile versions. It checks exported runtime and
type targets, declared CLI help, the installed native EmDash admin settings
screen, and foreign-origin checkout denial. This caught an omitted `cli/`
dependency closure: npm included the declared bin automatically, but its sibling
kernel and spec files were absent. The package file allowlist and its exact
public-repository audit now include `cli`; unrelated files remain forbidden.

Commands (Node 22.23.2):

- `npm run test:sandbox:orders`
- `npm run test:consumer:native`
- `node --test tests/workflows/packaged-consumers.test.mjs`
- `bin/verify-commerce full`

CI preserves only explicitly named synthetic PNGs, status-only outcomes and
package/lock/runtime digest receipts under `.tmp/commerce-consumers-runs`, for
14 days. Raw traces, HAR, browser state, cookies, databases, capability payloads
and host logs are excluded. Failures retain nonzero exit status.

The local Registry fixture is unsigned and does not prove Registry publication,
signing, production installation, or provider-backed payment fulfillment. No
live provider or external customer traffic is configured. Astro's agent-aware
background mode is suppressed in the owned native test host so its process group
can be stopped by the test.

Local verification passed on Node 22.23.2: typecheck, 532 unit tests,
repository/feature audit, 56 integration tests, 10 general browser cases,
one native stock case, three extracted Registry cases, and the clean npm
consumer. Browser stages took 1.8 minutes, 14.1 seconds and 19.2 seconds.
No dependency versions or lockfile contents changed.
