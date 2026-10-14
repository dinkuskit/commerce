# Delegated release preparation uses Commerce's prebundle

## Clean failure and supported counterproof

On release candidate c0770cb7a2606906c25c63694eb05723473dbf07, a fresh
checkout with a normal locked `npm ci` and no generated profiles resolved
`dinkus-commerce@0.2.1` through official release planning. The publish job's
exact `emdash-plugin release prepare ... --dir . --out-dir .emdash-release`
command then exited 1: its temporary probe could not resolve `@oslojs/binary`.
The installed package resolves from that same checkout. This is not a missing
dependency installation.

CLI 0.13.3's preparation calls its bundler directly on the discovered source
package. It does not run Commerce's prebundle script. The tagging job's build
cannot supply output to the separate clean publishing job. Commerce's normal
build succeeds by first bundling its browser-compatible dependency closure and
then using the official build and bundle APIs on staged source.

Counterproof: the same clean checkout's normal build and official bundle of
`.tmp/sandbox-source` succeed. Official `release prepare` also succeeds when
that staged source is copied to a standalone temporary directory outside the
repository discovery tree. It returns the expected publisher DID, slug,
version, plugin directory and archive path. Its archive contains the exact
reviewed backend and wire manifest. No credentials, publication, service calls
or provider mutations were used.

## Repair

The delegated publish job now runs the normal build, then a small preparation
helper. The helper checks the selector and staged metadata, copies the three
prebundle inputs to a temporary standalone package, and invokes the official
CLI's `release prepare`. It validates the returned identity metadata and
copies the official archive back to `.emdash-release`, emitting an absolute
bundle path for the existing attestation and publish steps.

The standalone directory is necessary because `release prepare --dir` inside
the checkout walks up to its Git root and discovers both the raw package and
staged or test packages. No custom archive writer or manual publishing path
was added. OIDC, the publisher/version checks, prerelease refusal, provenance,
permissions and the delegated release action remain in place.

## Regression

The regression runs the actual helper and pinned official CLI with the real
compiled prebundle. The fixture's raw entry throws if selected and its root
contains both raw and staged manifests. The prepared archive's backend and
manifest must match the canonical build byte for byte; all required GitHub
outputs must identify that archive and package. Wrong selectors and stale
staged metadata fail before any outputs are emitted.

The targeted workflow and preparation suite passes 10 tests. Full local
verification, CI and exact-source reviews are separate delivery gates and
reported in the PR handoff. This is a release-pipeline repair only; no runtime
source, dependency or package version changes are included.
