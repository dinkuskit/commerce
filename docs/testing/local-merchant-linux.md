# Linux merchant fixture handoff

This is packaging for the existing two-run local merchant journey. It does not
add cases or authorize a hosted-provider test. The runtime owner must first
qualify the runner, its authenticated caller, resource limits and Chromium.

## Inputs

- Commerce starts at merged PR122, commit
  `67f2626edb7986d82886f0c015a9305f61c1753e`. The only executable change in this
  portability slice resolves workerd through the package's platform-selecting
  `node_modules/.bin/workerd` entry point instead of a Darwin-arm64 path.
- Payments is unchanged at `922e0de9d86ca935bdca852f44552c6c34c50203`.
- Node **22.23.2**, npm from that distribution, Linux **x86_64**, glibc userspace.
- Playwright **1.61.1**, its Chromium **149.0.7827.55**, EmDash **1.2.0**,
  sandbox-workerd **0.9.3**, workerd **1.20260826.1** (`workerd 2026-08-26`).
- Commerce lock SHA256:
  `e414fbeda2898c4cc28a330fb926f0567d6c8f9e4cbd8a5ce7ea86798499a9b6`.
- Payments lock SHA256:
  `8538405646dfba95f9bd1e37942a0e1e1be78ccb9d37f7ad57864b536e3aa912`.
- Unchanged journey assertion SHA256:
  `2a6937c1830490f801fbfab2a8bcd3ffec21963a10cbbc589e1e80abe26a14f1`.

The package manifest supplied with a handoff records its actual Commerce head,
archive hash/size and both source identities. Package only fresh shallow local
clones of these public sources, with their remotes removed and minimal Git
metadata retained. The launcher checks real Git identities, so an archive that
omits `.git` is insufficient. Do not create fake commits or relax that check.

Exclude node_modules, environment files, caches, generated run directories,
Git hooks/reflogs, credentials, browser stores and operator configuration.
Retain only tracked source plus the new clone's HEAD, index, shallow boundary,
refs, objects and a known credential-free core Git configuration. Dependency
installs run inside the disposable runtime, from the committed lockfiles.
The package carries no GitHub, Cloudflare or 1Password authentication material.

## Runtime preparation and command

The existing runtime owner supplies Git, Node22.23.2, Chromium's Linux shared
libraries and workerd's Linux dependencies (including libc++1). Debian12 is a
local qualification baseline, not a requirement to replace the runner image.
`playwright install-deps chromium` is an OS preparation operation owned by the
runtime owner. A browser already installed by another Playwright version does
not establish compatibility with this package's pinned browser.

The process environment must reap exited child processes. Use the runner's
existing init, Docker `--init` for a local qualification, or an installed
`tini -s --` around the package command. A bare `sleep` as container PID1 leaves
Astro zombies: its PID check then correctly refuses the second run. Do not use
`astro --force`, delete locks or stop an unknown server to bypass that refusal.
Pinned upstream Crabbox `2bd85693b5fdea67d352516e082b90f8cacfe07b`
already installs Tini and uses `ENTRYPOINT ["/usr/bin/tini", "--", "sleep", "infinity"]`;
retain that environment rather than patching Crabbox. Its presence in source
does not substitute for the runtime owner's actual image/process receipt.
The preparatory dependency/browser footprint was about4.1GiB; allow at least
6GiB writable space for installs, caches and generated evidence.

Verify the archive SHA256 before extracting it into a **new** empty directory.
Use an empty, disposable HOME and TMPDIR; do not mount an operator HOME, Docker
socket, host browser profile or credential directory. Preserve the package's
two independent Git roots. With Node22.23.2 first on PATH, the command is:

```sh
env -i HOME="$RUN_ROOT/home" TMPDIR="$RUN_ROOT/tmp" \
  PATH="$NODE22_BIN:/usr/local/bin:/usr/bin:/bin" CI=1 LANG=C.UTF-8 \
  NPM_CONFIG_USERCONFIG="$RUN_ROOT/home/npm-user.conf" \
  NPM_CONFIG_GLOBALCONFIG="$RUN_ROOT/home/npm-global.conf" \
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
  PACKAGE_ROOT="$PACKAGE_ROOT" /bin/sh -eu -c '
    test "$(node -p process.versions.node)" = 22.23.2
    test "$(node -p process.platform)" = linux
    test "$(node -p process.arch)" = x64
    cd "$PACKAGE_ROOT/commerce"
    npm ci --no-audit --no-fund
    (cd ../payments && npm ci --no-audit --no-fund)
    npx playwright install chromium
    npm run test:merchant:local -- --payments "$PACKAGE_ROOT/payments"
  '
```

`RUN_ROOT/home` and `RUN_ROOT/tmp` must already be new private directories, with distinct empty
`npm-user.conf` and `npm-global.conf` files in HOME. npm refuses loading the
same configuration file as both user and global config.
The launcher preserves the custom Commerce build, builds Payments with its
existing supported localhost testOnly profile, and starts only loopback
services. Port64751 must be unused inside the runner. It executes the same
zero-retry Playwright assertions twice, with fresh database/media directories,
host/browser processes, generated encryption material and run/site/checkout
identities. No manual credential reset or seeding between runs is required.

The runtime owner enforces the remaining total cost/TTL cap externally. Do not
start a lease merely because this source package exists. A USD1 feasibility
claim needs the qualified profile's effective rate, remaining budget and
transfer/storage costs. A conservative15-minute allocation fits only if its
compute rate is at most USD4/hour before those other costs; this is arithmetic,
not a provider price quote or spending authority. Stop rather than start when
the remaining approved budget cannot cover the admitted walltime.

## Output contract

The command prints `.tmp/local-merchant/<batch>/` under Commerce. Extract only:

- Batch `identities.json`, `STATE.md`, `events.jsonl`, `heartbeat`, `PROOF.md`.
- Each run's `result.json`, `observable-state.json`, `PROOF.md`,
  `loaded-dinkus-commerce.json`, `loaded-r_3brsc2on3bu673rn.json` and selected
  PNG screenshots after inspecting them for fixture-only content.

Never export databases/WAL/SHM, the disposable HOME/TMPDIR, node_modules,
browser profiles, session state, raw authenticated traces, HAR or arbitrary
logs. Encryption/signing material stays private in disposable processes.
Keep separate failed preparation and accepted-run records. Preserve the
evidence for at least14days; there is no automatic resource or evidence cleanup.

Acceptance remains actual workerd loads of both plugins, merchant settings and
catalog through UI, guest payment **fixture**, one durable TEST order and
receipt, reopen without duplication, wake acknowledgment, matching Payments
status, and private-route denial. Issuer, authorization, Payments service and
Stripe outcomes are synthetic. This does not certify Cloudflare execution until
run there, nor real Ship/PB/PDF/tracking, Registry installation/update, deployed
authentication or real provider actions. Do not access a hosted merchant or
reuse any protected order to complete this package's fixture journey.
