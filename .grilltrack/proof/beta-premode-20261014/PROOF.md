# Beta pre-mode entry

## Scope and initial state

Entry uses the existing documented command, `npx changeset pre enter beta`,
with pinned Changesets CLI3.0.3 and Node22.23.2. It generates only mode `pre`
and tag `beta` in `.changeset/pre.json`; package and plugin versions remain
`0.2.2`, and the pending runtime patch and empty changesets are preserved.
The documented empty entry changeset was generated with `changeset --empty`.

Changesets3 intentionally removes the older `initialVersions` and `changesets`
fields during pre-state migration. No obsolete fields were added by hand.
The initial version is verified through unchanged package metadata and the
actual CLI release plan's `oldVersion: 0.2.2`.

## Release plans

`changeset status --output` on this source returns:

- Package: `@dinkuskit/commerce`.
- Pending runtime patch: old `0.2.2`, new `0.2.3-beta.0`.
- Pre-state: mode `pre`, tag `beta`.

A separate disposable plan fixture keeps the same package/config/pre-state
and pending changesets, adding only the held feature's exact minor changeset
from Commerce commit `83e8ba91f0aefb50e4be23c225db6c6f42f283d5`. The same CLI
returns old `0.2.2`, new `0.3.0-beta.0`. This is a conditional release plan,
not a version bump or published release. Actual package versions were never
modified, no tag was created, and the held feature checkout was untouched.

## Merge and publication effects

The pinned Changesets select-mode action returns `version` when it finds a
nonempty changeset. The pending patch supplies that condition, so a normal
merge creates or updates a version PR. The separate publish job requires
`mode == 'publish'`; its Registry child requires `published == 'true'`.
This entry does not meet either publication gate. No publish-only dispatch
was performed. An existing stable version PR must remain unmerged and be
updated under beta mode before its separate review and approval.

For the planned prereleases, the already-tested effective selector routes to
`dinkus-commerce-beta@0.2.3-beta.0` or conditionally
`dinkus-commerce-beta@0.3.0-beta.0`. Preparation and verification use that same
selector. Final profile authorization, expanded feature manifest checks,
beta release PR merge/publication and fresh-store proof remain separate.

## Local validation

`npm run verify:quick` passed: Node22.23.2, 566 unit tests, typecheck,
repository audit and feature audit. A separate assertion probe verified the
CLI pre-state, initial version, both actual release-plan outputs and routed
beta selectors. Package, plugin manifest and lockfile diffs are empty.
