# CLI SIGINT after a change dispatch: report the unknown outcome

## Scope and source identity

Source **9655633ed806e2fa81e8bae6cecadef692d296c6**, parent
**2e648bb513fb26df6384907a2c86c26d857ae07c**. The maintainer subsequently merged
that parent as #210, main **00fb693a118822f921c831564bc44ca0aa2ffd72** at
2026-10-29T21:06:34Z. These parent/main trees are identical. The submission
merges that accepted main without changing source files; it does not carry an
open transport proposal. `manifest.json` binds the completed source gates and
six changed source files. Final proof-only head qualification is reported
separately in the PR, not inferred from this report's existence.

This selects the original frozen31666da repair onto accepted current code.
Client, spec, and test files remain byte-identical to original31666da. Original
branches/proofs, including prepared88289bd, remain preserved. No shared CLI
kernel change relative accepted main, dependency update, persisted-data change,
checkout/order eligibility change, automatic retry, or companion-repository edit.

## Observed failure and repair

The executable's existing SIGINT handler promises “nothing was sent” only before
change dispatch, and otherwise reports an unknown outcome. Commerce never
forwarded that handler's shared lifecycle to its client. Consequently an actual
order-completion request could reach the HTTP server, then SIGINT still produced:

```text
interrupted; nothing was sent.
```

with exit4. That reassurance is false even if the remote operation ultimately
fails: the client no longer knows whether a change committed.

The repair forwards `ctx.lifecycle` through `connect()` to the Commerce client.
A semantic mutation marks `lifecycle.sending` immediately before its fetch,
**after** credential, destination-trust, and pre-abort checks. Catalog get/list,
order show/list, and public/native GET reads remain unmarked. HTTP POST alone is
not a mutation classifier. After dispatch begins, SIGINT now reports exit3:

```text
interrupted after the request was sent; the outcome is unknown.
```

The JSON error remains `interrupted`; no automatic retry is introduced. Read back
the product/order before deciding whether to repeat an uncertain change.

Starting fetch is not proof of receipt; receipt is not proof of durable commit.
The flag conservatively identifies a point after which “nothing was sent” is no
longer safe. It does not prove an order was saved, undo a request, or recover a
previous uncertain write.

## Real behavior proof, and what is simulated

`tests/cli/sigint-outcome.test.mjs` contains14 top-level checks:

- **Eight actual executable processes**: product create, product price change,
  order complete, and order reopen, each with no response headers and a partial
  HTTP response. A real loopback Node HTTP server receives the JSON request before
  sending POSIX SIGINT to the real CLI child. Assertions require normal exit3,
  unknown-outcome wording, one JSON `interrupted` error, no token disclosure,
  and exactly one received change request. The partial fixture writes response
  bytes before signaling; it does **not** assert the child consumed headers or
  entered `response.text()`. Accepted210's separate transport tests cover that
  body-phase boundary.
- **Two actual executable read-preflight processes**: price-change preview read
  and order dry-run read. SIGINT during that read still exits4 with “nothing was
  sent”, no unknown-outcome wording, and exactly one read request.
- **Four client controls**: catalog/orders read-versus-write operation matrices,
  public/native GET reads, and credential/trust/pre-aborted refusals. These use
  injected fetch callbacks; refused cases invoke no fetch and never mark sending.

The10 process cases run the production executable and real Node fetch over local
TCP, with an isolated HOME/cwd and only synthetic credentials in the child env.
Responses and products are a synthetic HTTP protocol fixture, **not** a real
EmDash backend/order store. The fixture does not assert durable write, actual
Payments/Inventory/provider operation, SDK installation, or a deployed store.
A bounded watchdog fails a stuck child; no suite force-exit, weakened assertions,
mutation retry, or cleanup-error waiver is used.

Windows explicitly skips the10 process cases because child SIGINT delivery
there differs. This Linux run skipped none. No Windows/device/browser claim.

## Fresh before/after results

2026-10-29, Node24.22.0, Linuxx64, own synthetic host; no maintainer store used.

| Run | Result |
| --- | --- |
| Rebuilt/qualified parent2e + selected14 regressions | **3pass/11fail**, zero skips, expected exit1; completed21:03:40UTC |
| Repaired source965, canonical unit/workflow | **828/828**, zero failures/skips |
| Repaired source965, canonical integration | **110/110**, zero failures/skips |
| Three additional focused repetitions | **14/14 each**, zero failures/skips |
| Build, typecheck, repository audit, ledger, diff/clean gates | Passed; source pipeline completed **21:08:56UTC** |

`npm test` and `npm run test:integration` each run their normal build/gates.
Builds, tests and extra repetitions were sequential in a bounded independent
service. They exited naturally. Repository audit is not a new dependency/security
clearance, and these are not full release/browser gates.

Backend **131007bytes**, limit131072, **65bytes headroom**, SHA256
`ae50fc8beb73af5cc05d1f8f17be631b8251c0ed8cc5444e2abaf6034dd118fa`.
`dist/sandbox/plugin.mjs` and extracted Registry backend were byte-equal. This
matches accepted parent2e; the CLI repair does not change that artifact. Do not
infer the budget of arbitrary other proposed merges.

## Reproduction

Use a disposable checkout/worktree and Node24.22.0. Baseline requires only the
Node CLI files, not an installed CMS or network credentials:

```sh
git worktree add --detach ../sigint-before 2e648bb513fb26df6384907a2c86c26d857ae07c
git show 9655633ed806e2fa81e8bae6cecadef692d296c6:tests/cli/sigint-outcome.test.mjs > ../sigint-before/tests/cli/sigint-outcome.test.mjs
(cd ../sigint-before && node --test tests/cli/sigint-outcome.test.mjs)
# Expected exit1: 3pass/11fail. Do not count this as a passing qualification.
```

At repaired source965 (or the qualified submission head), with project
dependencies installed under the pinned Node version:

```sh
node --test tests/cli/sigint-outcome.test.mjs
npm test
npm run test:integration
npm run typecheck
npm run audit:repo
./scripts/grilltrack --project . validate
```

Published Registry behavior is not retested here: this is CLI source/real-process
transport evidence, not an official installed-plugin claim. Earlier Registry0.6
and mounted-settings evidence retain their original hashes, dates and scopes.
