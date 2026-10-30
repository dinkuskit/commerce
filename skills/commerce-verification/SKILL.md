---
name: commerce-verification
description: Run the canonical Commerce repository gate and distinguish local proof from production readiness.
---

# Commerce verification

Install the locked dependencies with `npm ci`. Use the Node version recorded
in `.nvmrc` and the current package/toolchain contract.

```sh
bin/verify-commerce quick
bin/verify-commerce full
```

The default is `quick`. Both modes resolve the repository from the script path,
so an absolute invocation also works from another directory.

`quick` runs typechecking, the build (including sandbox validation/bundle), unit and workflow tests, and repository/feature audits.
`checks` adds SQLite/D1 integration to quick. `storefront` builds and runs the
main three-project Playwright config; `packaged` builds and runs the orders
browser config and native consumer check. `core` runs checks, storefront and
packaged sequentially. `full` runs core, then the merchant-settings checks.
Success exits 0 and prints `verify-commerce: <mode> passed`; unsupported modes
exit 64. A failed child command stops the gate with a non-zero exit.

Use quick during edits and full before delivery. Keep the complete command
output as proof and report the first failing check; do not relax assertions or
label fixture transport as live provider proof. Browser/runtime dependencies
must be installed before the full gate.

These checks use local or synthetic fixtures. They do not authorize publishing,
deployment, live payment traffic, or production mutations, and do not establish
an installed release's compatibility beyond the profiles actually exercised.

For a resource-constrained diagnostic, see the README's single-host browser
instructions. `COMMERCE_BROWSER_PROOF_PROFILE=sandbox|native|native-variant`
selects one project and its one host in the main config; unset/empty retains
all three. Run direct Playwright with a fresh run id, never parallel to a build
or another profile on the same artifacts. This does not qualify the other
lanes or a full gate. Canonical storefront/core/full modes reject a nonempty
override before any child gate; unset it for normal delivery verification.
The separate settings and orders configs are unchanged.

If the sandbox bundler reports a missing platform-native binding, repeat the
locked install under the current pinned Node with a compatible npm and
`--include=optional`. Older Node 22/npm 10 recovery observations are historical,
not a replacement for the current Node contract. Preserve the lockfile and pins.

The local D1 race harness retries busy or exact opaque Wrangler internal errors
up to five times under the same idempotent fixture write. It still requires the
named constraint diagnostic and one persisted record; exhausted retries fail.
