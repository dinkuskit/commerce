# Single-host browser diagnostics on current main

## Scope and provenance

Source: **88f6cd375a6f9f77af7dcff9bb3e01e67b8841ea**.
Parent: accepted upstream main **4e4ca758bb28edee691a948353c046e1a2357faf**.
The five source files are byte-identical to preserved contribution
**071eab6690136300b2ae0efffae8c2efc9b9aa69**, but all results below are fresh
current-main checks, not relabelled historical results. The old branch and its
proof remain unchanged. No open SIGINT/profile repair or Oracle proposal is
included.

This is test tooling, not a product repair or a new default. Main Playwright
starts three hosts even when `--project` selects one project's tests. An explicit
`COMMERCE_BROWSER_PROOF_PROFILE=sandbox|native|native-variant` now selects that
existing project **and** its matching host. Unset/empty retains three. Invalid
names fail before creating artifact directories. Exact selected config equality
covers tests, ports, isolated DBs, host flags, viewports, workers, timeouts and
`reuseExistingServer:false`.

Canonical `bin/verify-commerce storefront|core|full` rejects any nonempty selector
with exit64 **before any child gate**, so a diagnostic cannot silently narrow
those commands. Quick/checks and the separate packaged/settings configs are not
narrowed. README and verification skill document direct diagnostic use and the
normal full gate. Product article: **Docs: not applicable**; no owner-facing
product behavior/setup, package version or release changeset changes.

## Fresh reproduction and qualification

Fresh parent with only the new workflow test: **17 tests:4 pass/13 fail**, expected
exit1, no skips. These are absent-selector/guard expectations, not thirteen
product defects. At repaired source: **17/17**, no skips.

Source sequential checks finished **2026-10-29 23:02:16UTC** on Node24.22.0/Linux x64:

- **838/838 unit/workflow;110/110 integration**, zero failures/skips.
- Fresh builds, typecheck, repository/feature audit, GrillTrack validation,
  shell syntax, diff/clean worktree and source/HEAD invariance passed.
- `src`, CLI, dependencies, ledger, browser specs and fixture hosts are
  unchanged relative to accepted main. No persistence, permission or runtime
  contract changes.
- Backend **130676 bytes /396 bytes headroom** under unchanged131072-byte cap,
  SHA256 **a630ca239b3573cd5943cb430fb8e26702c946ba6d7c38438fcc86ac01c98f92**;
  `dist/sandbox/plugin.mjs` equals extracted Registry-bundle backend. This is the
  accepted-main artifact identity, not historical071's131033-byte artifact.

Actual direct Playwright runs, sequential and without retries or assertion/
timeout changes, used fresh isolated synthetic DBs and one selected host:

| Profile | Executed spec | Result |
| --- | --- | --- |
| sandbox | unchanged guest-checkout | 1/1 (38.6s) |
| native | unchanged guest-checkout | 1/1 (33.1s) |
| native-variant | unchanged complete variant-checkout spec | 2/2 (1.9m) |

List-only checks separately collect sandbox5/native3/native-variant2 tests;
these counts are **not additional executions**. A conflicting native selector
with `--project=sandbox --list` refuses exit1, rather than starting an unselected
host. No default three-host or canonical storefront/core/full execution is
claimed: the wrapper command-plan tests mock npm and are not those gates.

## Reproduce

Use pinned Node24.22.0 and working locked dependencies/native bindings. Build
first; do not run browser profiles or builds concurrently. For each profile use
a unique run ID and unused ports. Example source commands:

```sh
npm test
npm run test:integration
npm run typecheck
npm run audit:repo
./scripts/grilltrack --project . validate
mkdir -p .tmp/astro-config
ASTRO_TELEMETRY_DISABLED=1 XDG_CONFIG_HOME="$PWD/.tmp/astro-config" \
  COMMERCE_BROWSER_PROOF_PROFILE=native \
  COMMERCE_PROOF_RUN="native-diagnostic-$(date +%s)" \
  npx playwright test tests/sandbox/guest-checkout.spec.mjs --project=native
```

Substitute sandbox for its guest case; for native-variant select that profile
and run `tests/sandbox/variant-checkout.spec.mjs`. Unset the variable when running
normal canonical gates. The manifest binds source files/results, not later
merge heads, signatures, approval or live Registry artifacts.

## Limits and hygiene

Browser passes exercise real local TCP routes, mounted EmDash UI/SDK and the
compiled local sandbox where applicable. The sandbox fixture is **not an
external Registry installation**. The native-variant Payments facade is
synthetic/in-memory, not a real processor; test DB edits are explicit fixture/
stale-write controls, not production operations. No fresh official Registry
selection or installed-plugin qualification is claimed here.

No full browser release gate, settings/orders/consumer aggregate, actual
Inventory/Ship/provider/channel behavior, real payment, device/touch/Safari,
performance benchmark, security clearance or combined pending-feature build.
The existing viewport screenshots are not new phone-edit coverage; the separate
preserved phone-test contribution is not included. Source lock remains unchanged
DOMPurify3.4.16; repository contract audits are not dependency vulnerability audits.

Only source, this report and a public-safe digest manifest are committed. No raw
logs, DBs, credentials, sessions, capabilities, request/response dumps, traces or
screenshots are published. All data is synthetic. Exact proof-only final-head
checks are recorded separately in the PR; source evidence is not silently
attributed to an untested later head. No upstream merge, publication, deployment,
maintainer-store call or execution-controller change was performed.
