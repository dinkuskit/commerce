# Agent Contract

This public repository owns DinkusKit Commerce, the open-source commerce layer
for EmDash sites. Assume every committed byte is immediately public.

## Source priority

1. This file.
2. [docs/CHARTER.md](docs/CHARTER.md).
3. `.grilltrack/ledger.json`, maintained only through the GrillTrack CLI.
4. Current source, tests, and committed proof.

## Public-safe boundary

- Never commit credentials, environment files, customer or tenant data,
  business addresses or figures, production configuration, private repository
  coordinates, or private operating rationale.
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

## Working rules

- Product decisions flow through GrillTrack before implementation.
- Changes use focused branches and pull requests with tests and proof.
- ClawSweeper is review evidence, not merge authority. Findings are adjudicated
  before changes are routed.
- Publishing, deployment, production mutation, secrets or permissions changes,
  and merges require explicit human approval.
