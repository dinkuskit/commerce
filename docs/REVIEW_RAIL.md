# Review rail

Commerce uses a fail-closed, maintainer-triggered ClawSweeper review after the
normal repository checks pass. The caller on `main` binds every admitted
request to this repository's immutable numeric ID and to the pull request's
live base and head commits before invoking the pinned reusable workflow.

The accepted commands are one standalone line:

```text
@clawsweeper review
@clawsweeper re-review
@clawsweeper re-run
```

All commands require a maintainer association (spark-dgx #269: comments are
maintainer-only for enqueue and publish; there is no author re-review tier).
A maintainer may also force a review by applying the `clawsweeper:review`
label. Bot comments, edited comments, non-pull-request issues, non-`main`
targets, and stale or malformed identities are rejected. Automatic reviews
run for human-authored PRs and the shared trusted bots (`smoky-agent[bot]`,
`dinkuskit-release[bot]`); other bot-authored PRs wait for a maintainer
label or comment.

ClawSweeper is advisory evidence. It may publish a review comment and labels,
but it cannot merge the pull request. The current head must still match the
reviewed head before a maintainer treats a verdict as current.

<!-- canary smoke: verifies automatic queue admission after #146; safe to close unmerged -->
