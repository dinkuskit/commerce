# Qualified native, sandbox and checkout integration

Plan `edee28c3ffe5d322451dacd0140b8af895fc7769dd290b63f38e0288c3440438`
(`Qualified native, sandbox and checkout integration`). Joined track
`gt-join-edee28c3ffe5d322451dacd0140b8af8`. GrillTrack CLI applied the exact
approved reconcile; canonical archives stayed byte-identical; competing
histories remain in lineage snapshots. The track stays active. This packet is
composed verification evidence only. It is not a clean review, closeout, or
delivery claim.

Preview union identity before local status edits:
`sha256:efac8bd8341f03813ed316780c2b31c40a8c8b6532636411c240f1fdc89dd2a7`.
Composed working-tree identity after apply, pending-status disclosure, ignored
work-walk skip, focused public-audit regressions, and this packet: SHA-256 of
[source-manifest.sha256](source-manifest.sha256).

## Bound

Checkout is **exported and unmounted**. Native `./admin`, `./sandbox`,
`./descriptor`, sandbox build, and native lock/dependencies remain. Native
`createPlugin` does not register `checkoutCarts`, checkout routes, payment
adapters, or Stripe logic. Real Stripe traffic, Inventory provider
quantity/whole-basket work, shopper H1 UI, and runtime checkout mount remain
separate obligations. This verification does not relock those obligations and
does not claim product-proof of them.

## Verifier

`bin/verify-commerce full` once under already-installed Node 22.23.2:
typecheck passed; unit 144 cases (143 pass, 1 fail); the fail was
`the committed scaffold satisfies the public repository contract` walking
ignored GrillTrack work `plans`/`runs` segments from the isolated CLI source
copy. `scripts/repo-contract.mjs` now skips gitignored `.grilltrack/work`,
`.tmp`, `dist`, and `coverage`. Focused retest of that one unit case passed.
`audit:repo` and `audit:features` then passed.

Remaining full stages: integration 21 cases (20 pass, 1 fail). The fail was
Wrangler/D1 `internal error` on `two local Wrangler/D1 processes enforce one
permanent store identity`, not a constraint-mismatch from composed source.
Focused retest of that one case passed. Acceptance-map integration cases
`checkout CAS and order receipt survive exact EmDash repository connection
reopen` and `native SQLite saves an explicit stock status and restores it when
the next toggle omits status` passed on the first integration run.

Playwright sandbox/native: 3 passed (fresh sandbox clerk workflow; native
populated continuity; native anonymous denial). Screenshots used synthetic
fixtures only. Four selected captures were visually inspected and published
to the designated restricted proof shelf; server byte sizes and SHA-256
digests match. [media-manifest.json](media-manifest.json) records capture
source `2c9725f09bb555fbae3d8f49417a111418f6f10e`, provenance, redaction
status, and digest references. Authorized reviewers need the separately
retained operational receipt to resolve the restricted assets. The evidence
follow-up changes text proof only; capture source code is unchanged. Media
are not tracked here.

Follow-up public-audit regressions under the same Node 22.23.2, without
re-running accepted full/integration/browser suites: `tests/repo-contract.test.mjs`
3/3 (1 committed-scaffold case plus 2 focused regressions). Synthetic temporary
roots prove ignored `.grilltrack/work` and build/browser output stay outside the
walk, and that a public `.grilltrack/proof` `.sql` fixture plus `src/.env`
sentinel remain rejected. `npm run audit:repo` passed again. Original ignored
verify exit logs were retained.

## All 16

Every named executable case in the parent-reviewed acceptance map passed on
the composed tree. `checkout-hosted-first-002` also cites a
`source_contract_guard` in `src/features/checkout/orchestrate.ts` (https
redirect, no credentials). That guard is source structure, not a named test.
Fixture hostname is not a live Stripe hosted-Checkout proof.

| ID | Status | Evidence kind | Limits |
| --- | --- | --- | --- |
| manage-stock-checkbox-001 | composed verified | named cases | no real Inventory quantity |
| manage-stock-hide-status-002 | composed verified | named cases | Allow backorders is a different field |
| manage-stock-setup-required-003 | composed verified | named cases | no marketplace install popup assert |
| manage-stock-uncheck-restores-004 | composed verified | named cases | real Inventory quantity retention deferred |
| manage-stock-reenable-fresh-005 | composed verified | named cases | pool quantity 6 is an Inventory obligation |
| manage-stock-existing-sku-confirm-006 | composed verified | named cases | confirm is kernel/API, not a clerk UI |
| manage-stock-no-price-rewrite-007 | composed verified | named cases | — |
| manage-stock-same-save-008 | composed verified | named cases | — |
| block-admin-create-002 | composed verified | named cases | storefront product-page H1 out of slice |
| block-admin-save-001 | composed verified | named cases | native Store radios are not Settings labels |
| block-admin-settings-003 | composed verified | named cases | no kernel Block Kit JSON unit |
| block-admin-settings-label-004 | composed verified | named cases | exact heading `Settings` unasserted |
| checkout-guest-001 | composed verified | named cases | no mounted shopper guest UI; no account-absent assert |
| checkout-hosted-first-002 | composed verified | source guard + named cases | no live Stripe redirect |
| checkout-stock-hold-003 | composed verified | named cases | whole-basket Inventory adapter deferred |
| checkout-payment-window-004 | composed verified | named cases | no live Stripe 1800 window |

Detailed mapping: [acceptance-result.json](acceptance-result.json).

## Not claimed

- Independent exact-source review (separate owner).
- Track closeout or clean review identity.
- Live Stripe, live Inventory, runtime checkout mount, or shopper H1.
- Merge, deployment, release, or live payment/provider mutation.

## Delivery

[Draft integration PR #31](https://github.com/dinkuskit/commerce/pull/31)
contains the reviewed source union and composed proof. Independent review
remains pending. The active track is not closed.
