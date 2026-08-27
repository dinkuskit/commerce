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

An initial review requires a maintainer association. A pull-request author may
request only a later re-review or rerun. Bot comments, edited comments,
non-pull-request issues, non-`main` targets, and stale or malformed identities
are rejected.

ClawSweeper is advisory evidence. It may publish a review comment and labels,
but it cannot merge the pull request. The current head must still match the
reviewed head before a maintainer treats a verdict as current.
