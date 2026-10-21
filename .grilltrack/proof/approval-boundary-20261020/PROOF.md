# Source delivery approval boundary

- Repository: `dinkuskit/commerce`.
- Branch: `codex/approval-boundary-commerce-20261020`.
- Base: `18f0c196ed71ac74a532fd9d9d650860b9ab70fb`.
- Scope: [AGENTS.md](../../../AGENTS.md), this public-safe proof, and the required
  empty docs-only changeset (no package bump).

The contract now explicitly includes implementation of locked or approved
GrillTrack decisions within an assigned source task, required checks/proof,
commits, non-force pushes to the assigned branch, pull-request creation/updates,
review requests, and bounded in-scope repairs. These steps do not
need another permission question. One writer, an isolated branch/worktree,
and review evidence for the exact current head remain required.

The existing publishing, deployment, production mutation, secrets/permissions
and merge gates remain unchanged. This grants no standing merge authority.
ClawSweeper remains review evidence rather than merge authority. The scoped
active-policy check found no fixed-count repair cap to remove.

Validation:

- Node: `v24.22.0` using an existing runtime and command-local PATH.
- `npm run audit:repo`: `public_repository_contract=clean` and
  `feature_contract=clean`.
- Markdown links resolve; unchanged contract sections and preserved gates
  checked against the exact base.
- `git diff --check`: passed.
- The Changeset check requires an empty changeset for docs-only PRs, as stated
  in `.changeset/README.md` and `.github/scripts/check-changeset.mjs`. CI run
  `39527832677` rejected the missing file. The canonical empty-frontmatter file
  supplies that metadata without a product release bump; the unchanged checker
  validates it.

This is source-policy proof. No product code, decision ledger, dependency,
runtime, deployment, credential, installed skill, or global configuration
changed. Product test/browser suites were not run for this documentation-only
change; no product behavior claim is made.
