# Changesets

Every pull request that changes shipped behavior adds a changeset file here
declaring its version bump. While Commerce is on 0.x, bug fixes are `patch`
and everything else is `minor`; `major` is rejected until the 1.0.0 gate.
Docs, tests, and CI-only pull requests use an empty changeset
(`npx changeset --empty`).

See [RELEASING.md](../RELEASING.md) for the full release flow.
