# Linux merchant package preparation

Result: **LOCAL_LINUX_AMD64_PREPARATION_PASS**. No Cloudflare execution.

Base:67f2626edb7986d82886f0c015a9305f61c1753e (merged PR122).
Tested source:c736cc9da85e89f8e61e074fbb7ee6ea9193d672.
Payments:922e0de9d86ca935bdca852f44552c6c34c50203, unchanged.
The only executable change is workerd identity lookup through its installed
platform-selecting CLI. Merchant assertions remain byte-identical at SHA256
2a6937c1830490f801fbfab2a8bcd3ffec21963a10cbbc589e1e80abe26a14f1.

The local qualification used the pinned public Node22.23.2 Debian12 image for
linux/amd64 on an arm64 Mac, hence emulated CPU execution. Image and toolchain
identity are in [environment.json](environment.json). This is not the upstream
Crabbox image, its deployed instance, or Cloudflare acceptance.

[Binary regression](binary-probe.jsonl): the old Darwin path returns ENOENT on
Linux. The package CLI exits0 with workerd2026-08-26. Both complete executions
then load Commerce and Payments in real WorkerdSandboxRunner instances:
[Run1](run1/result.json), [Run2](run2/result.json). Each records one distinct
USD12 paid TEST fixture order, its receipt/status, reopen/no duplicate,
acknowledged wake and anonymous private-route refusal. No source assertions,
zero-retry policy or simulated provider boundaries were weakened.

The full credential-free package bootstrap, installs, build and both runs took
about213.7seconds with OS dependencies preinstalled. See [timings](timings.json).
The earlier fresh OS preparation observed38s base tools,35s Commerce npm,
25s Payments npm and51s browser/dependency preparation before build/run. These
are local observations, not Cloudflare latency guarantees. Plan10minutes and
admit at most15minutes only after the runtime owner checks effective rates,
remaining USD1 total cap, transfer/storage and available disk. No spending or
resource call follows from this packet.

Initial preparation exposed two environment/package issues: a bare-sleep PID1
left the exited Astro process as a zombie, so Run2 correctly refused its PID;
a standard Tini subreaper fixed the local environment. Upstream Crabbox already
uses Tini, per the pinned source identified in environment.json. No product or
Crabbox patch was made. The initial package wrapper also used the same empty
npm config path twice; npm rejected it. Distinct empty user/global config
files fixed bootstrap. Failed preparation attempts are not accepted runs.

The source archive is assembled only from fresh public shallow source snapshots
and minimal credential-free Git identity metadata. It retains exact commits,
contains no remotes/hooks/reflogs, and excludes .env, node_modules, caches,
private homes, browser/session stores and generated tests. Prototype extraction
proved both exact heads and clean Git state without GitHub access. Final archive
and per-file manifest hashes accompany the coordinator handoff outside tracked
source, so producing them does not mutate the reviewed head.

Procedure, exact command, dependency/reaper/disk needs and output allowlist:
[Linux handoff](../../../docs/testing/local-merchant-linux.md).
Export only selected sanitized JSON/Markdown/PNG outputs, not databases,
WAL/SHM, HOME, secrets, traces or arbitrary logs. Encryption/signing material
exists only inside disposable test processes. Preserve proof14days; no auto
cleanup. Source checks:604/604 tests, typecheck, repository/feature audit and
diff whitespace PASS. Source reviews are recorded on the new PR; PR122 remains
merged and untouched.

Synthetic issuer/Payments/Stripe only. No real Ship/PB/PDF/tracking, hosted
merchant, provider transaction, Registry action, deployed auth or Cloudflare
runner claim. Actual remote acceptance waits for the qualified runner receipt
and remains with its existing owner. No account/auth/lease/runtime source was
changed here.
