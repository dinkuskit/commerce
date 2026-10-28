# Agent Contract

This public repository owns DinkusKit Commerce, the open-source commerce layer
for EmDash sites. Assume every committed byte is immediately public.

## Source priority

1. This file.
2. [docs/CHARTER.md](docs/CHARTER.md).
3. `.grilltrack/ledger.json`, maintained only through the GrillTrack CLI.
4. Current source, tests, and committed proof.

Use Node 24.22.0 per `.nvmrc` and verify `node -v`. In Cursor cloud agents put
nvm's Node ahead of `/exec-daemon` on `PATH` with
`export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$PATH"`. In Claude Code
cloud sessions the environment supplies that Node, and
`.claude/hooks/session-start.sh` installs dependencies from the lockfile, the
pinned agent skills below and the Playwright browser, then reports anything
missing; read that report before running project scripts.
A checkout last installed under Node 22 needs `npm ci` again after switching to
Node 24: native modules such as better-sqlite3 built for Node 22 fail to load
otherwise (the session hook reinstalls automatically because its stamp
includes the Node version).

## Direction and research

Read the organization [vision](https://github.com/dinkuskit/.github/blob/main/VISION.md)
and [scope and planning](https://github.com/dinkuskit/.github/blob/main/ROADMAP.md)
with this repository's charter and current decisions. They describe direction
and the store baseline; they do not reopen local locks or establish implemented
capabilities.

Use the installed `emdash-commerce` skill for material product or architecture
questions and relevant grills. Its selective REA guidance distinguishes
research, accepted design, active work and verified behavior. Reuse the owning
issue or proposal for unresolved questions; research alone does not authorize
implementation or expand an active release.

## Running GrillTrack

Run `./scripts/agent-skills` before agent work to install the pinned
SaariusSkills copy into ignored `.cursor/skills/`; use
`./scripts/grilltrack --project . validate` (or `show`) for ledger reads.
The bundle keeps its existing pin; `emdash-commerce` has a separate exact
revision in that script, including its reference files.
The wrapper uses an existing `~/.codex` install when available and never
replaces the CLI-only ledger rule. SmokySkills remains gated on maintainer
access and an immutable public-safe commit pin.

## Public-safe boundary

- Never commit credentials, environment files, customer or tenant data,
  business addresses or figures, production configuration, private repository
  coordinates, or private operating rationale.
- The CLI-maintained `.grilltrack/ledger.json`, event log, and same-repository
  closed-track archives are public Commerce product-decision lineage. Keep
  them public-safe and preserve them through the GrillTrack lifecycle; they are
  not imported private ledgers or unrelated archived documents.
- This repository has an independent Git root. Never merge, cherry-pick,
  subtree, fork, bundle, or otherwise import unrelated repository history.
- Reuse from prior private work is source-by-source only: classify the slice,
  review its complete dependency closure, rewrite where needed, and commit it
  here as new public work with fresh tests and provenance.
- Do not copy private ledgers, proof bundles, plans, SQL, data, lockfiles,
  workflows, generated artifacts, or archived documents.

## Product boundary

- EmDash is the CMS framework; DinkusKit Commerce is the commerce layer.
- Commerce owns catalog identity, authoritative price and sellability,
  `Manage stock?`, one inventory-provider binding, cart, checkout
  orchestration, Commerce receipts, and orders.
- Commerce never owns a production stock ledger or silently falls back between
  inventory providers.
- DinkusKit Inventory is the default first-party inventory provider and owns
  physical stock truth.
- Brand storefronts consume this package; this package never depends on a
  brand repository.

## Reference article

`docs/website/reference/commerce.md` is the Commerce article on dinkuskit.com/docs
(GrillTrack decision `website-docs-from-plugin-releases-086` in
dinkuskit/dinkuskit). Change it in the same PR as any behavior, screen, route
or setup step it describes. Keep `version_scope: "Commerce {{version}}"` and the
`{{version}}` and `{{release_date}}` placeholders: a stable release fills
them in and publishes the article, so main may describe changes that are not
released yet. Guides that span plugins live in dinkuskit/dinkuskit
`docs/updates/`; link that PR under **Docs impact**.

Reviewers, ClawSweeper included, record every PR's docs as one of:

- **Docs: up to date**: the PR updates the article to match, or the article
  already describes the change correctly.
- **Docs: missing**: the PR changes something the article describes, or should
  describe, without updating it. Report it as a P3 finding naming the section;
  it does not block the merge.
- **Docs: not applicable**: nothing an owner or developer sees changes (tests,
  CI, internal refactors).

## Working rules

- Product decisions flow through GrillTrack before implementation.
- Changes use focused branches and pull requests with tests and proof.
- An assigned source task, including implementation of locked or approved
  GrillTrack decisions, authorizes required checks/proof, commits, non-force
  pushes to its assigned branch, pull-request creation/updates, review requests,
  and bounded in-scope repairs without separate permission questions. Keep one
  writer in an isolated branch/worktree and bind review evidence to the exact
  head; a changed head requires current review evidence.
- ClawSweeper is review evidence, not merge authority. Findings are adjudicated
  before changes are routed.
- Publishing, deployment, production mutation, secrets or permissions changes,
  and merges require explicit human approval.
