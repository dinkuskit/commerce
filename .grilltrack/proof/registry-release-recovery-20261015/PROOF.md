# Locked planning and existing-tag Registry recovery

## Observed failure and cause

[Release run 38767095956](https://github.com/dinkuskit/commerce/actions/runs/38767095956)
on `dcfe61619195d965dbcd7ded6cb186893801c5f0` created the immutable
`v0.3.0-beta.0` tag and prerelease, then failed in the Registry planner before
any Registry build, attestation or publication. The bounded planner error was
`npm error Cannot read properties of null (reading 'edgesOut')`.

Node22.23.2/npm10.9.8 reproduces that error with the exact transient
`npx --yes @emdash-cms/plugin-cli@0.13.3 release plan` command in an isolated
fixture containing the release's public package/lock/manifest/entry metadata
and a fresh npm cache. The lockfile-installed official0.13.3 CLI succeeds on
the same complete metadata, emitting `dinkus-commerce@0.3.0-beta.0`.
The incomplete initial fixture missing `src/plugin.ts` was rejected as invalid
fixture evidence and corrected before this causal comparison. No npm debug,
publisher intent or authentication log is used as proof.

The planner job now installs with `npm ci` and directly invokes the installed
CLI. It retains the official package/version checks and existing beta selector
routing. It performs no transient package resolution during planning.

## Why retrying the old workflow would be insufficient

The pinned Changesets publish action derives publication from emitted release
events. With an existing version tag, the actual Changesets3.0.3 `tag` command
emits no new event and leaves the tag untouched. The action consequently returns
`published=false` and omits the package output, so the old dependent Registry
job can be skipped even after fixing the planner.

Primary source at the exact action pin:

- [runPublish](https://github.com/changesets/action/blob/ae32849d5ba541f9ae29e40e22a623bc13562f51/src/run.ts#L158)
- [publish outputs](https://github.com/changesets/action/blob/ae32849d5ba541f9ae29e40e22a623bc13562f51/src/publish/index.ts#L57)

Explicit `publish-only` dispatch on `main` now validates the existing ancestor
version tag, matching package/plugin identity and version, current release mode,
and equality of runtime/build inputs. Missing tags, changed runtime/build inputs,
metadata drift and unsupported dispatch contexts fail closed. It skips App-token
generation and tag/release creation, and supplies a separate Registry-recovery
signal and validated package list. The normal Changesets `published` output
remains truthful; recovery never fabricates a new publication/tag event.

The local read-only gate admits the CI repair source
`c27adbd9dbb995db7aa616a28d9254cd675dc1e3` while retaining tag commit
`dcfe61619195d965dbcd7ded6cb186893801c5f0`. This is a local gate evaluation,
not a workflow dispatch or evidence of successful Registry publication.

## Verification

Five planner tests fail before the fix and pass afterward. They execute the
actual workflow shell step with the transient resolver deliberately unavailable,
prove stable and beta planning, reject a version mismatch, and exclude unrelated
packages. The cold-job invariant requires locked installation before planning.

For recovery, the real existing-tag no-event scenario already passes on the old
source; five missing-helper/gate tests fail before repair. After repair all six
pass, covering stable/beta recovery, unchanged tags, distinct repair/tag source
commits, missing tags, changed runtime/metadata, unsupported dispatch contexts,
and separate signal/no-tag-mutation workflow wiring. Together with existing
release-process tests, all24 focused checks pass.

The complete Node22.23.2 gate passes: typecheck, repository/feature audits,
604 unit tests,99 integration tests,10 sandbox browser tests,1 stock test,
3 Orders tests, native consumer and both settings projects. YAML parsing
reports no workflow syntax errors. The pinned GrillTrack ledger validates
without any canonical/history/status change.

Official beta preparation from the repaired source preserves the reviewed
runtime artifacts:

- Backend117650 bytes; SHA256 `7ab9cf5c17986dc6ff6b39a561b5a7f8c97dffdf2bd44b96cf0a3afe44164eb4`.
- Compiled manifest SHA256 `86cbba303b8780f7a1dfc74dfa7af3404215975f89a98aa4403596992de16e5e`.
- Identity `dinkus-commerce-beta@0.3.0-beta.0`; expanded Ship host and runtime
  identity `r_fjzjvld3ssb4j63o` unchanged.

No runtime source, dependency lock, version, profile or tag content changes.
The required CI-only changeset is empty and requests no version bump.

## Owner recovery gate and final proof

After exact-source CI and both reviews qualify the source repair, the owner can
merge it and use the existing supported command documented in `RELEASING.md`:

```sh
gh workflow run release.yml --repo dinkuskit/commerce --ref main -f publish-only=true
```

Before dispatch, check the actual main/source SHA, unchanged runtime/build inputs
against the existing tag, version0.3.0-beta.0, beta profile/permissions and public
version-record state. Expected effects: skip versioning and tag/release mutation;
build, attest and publish only the validated beta Registry selector. Provenance
must name the actual repair merge SHA/ref/run, while the version tag stays at its
original commit. A local archive digest is not a predicted published digest.

The existing Registry verifier remains the final byte-level gate: a PDS record
with the wrong checksum, size, MIME, identity or version fails closed, including
an existing conflicting version record. Actual run archive, attestation, public
PDS record and index must match before claiming publication. At the failed run's
readback the beta version record was absent. No recovery was dispatched by this
source worker; no published archive/provenance or fresh-store E2E is claimed.
No original installation, order1001, key or shared credential was accessed.
