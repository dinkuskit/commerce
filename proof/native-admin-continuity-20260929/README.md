# Native admin continuity proof

Base: `0d120659d39e859ed4d32224b5981a18029ccb01` (Commerce PR #27).
Source manifest SHA-256: `bd18d60315f2e91ce758b90a732945a674994412ebd6ee003f60446488009665`; see `source-sha256.txt`.
Runtime: installed Node 22.23.1, EmDash 0.41.0. Data: synthetic local SQLite only.

## Behavior and results

- Build and sandbox manifest validation: pass via `npm run test:unit`.
- Unit tests: 124 passed, 0 failed, including built `./admin` import and native descriptor registration.
- Type checking: `npm run typecheck`, pass.
- Repository contracts: `npm run audit:repo`, pass.
- SQLite integration subset: pass. Full initial integration run: 17 passed, 2 failed on generic Workerd error text after one competing write succeeded and one failed. Targeted unchanged D1 rerun: all 3 passed, including persisted-row and constraint assertions. That transient failure remains recorded in local logs; no test expectations were relaxed.
- Fresh sandbox browser: pass, covering creation/replay, invalid-price refusal, Manage stock toggles, Store policy, anonymous denial, and unmanaged operation without Inventory.
- Native browser: 2 passed. Seeded native camelCase collections render saved regular/sale prices, manual availability, managed setup and Store settings. Edits persist; page reload retains values; original product identities and managed record remain intact; no snake_case catalog rows are created. Anonymous admin/API access fails closed.
- Initial native browser failure: onboarding overlay intercepted clicks because the fixture checked visibility too early. Fixed fixture by awaiting dismissal; no force-click or production bypass.

## Visible evidence

Local screenshots: `.grilltrack/work/native-continuity/screenshots/` contains populated and edited Products/Store plus managed setup. Products populated and Store edited images inspected directly. The restored native UI is the existing same-repository UI, retaining its plain styling; this slice does not redesign it.
Raw command logs: `.grilltrack/work/native-continuity/` (`unit.log`, `typecheck.log`, `audit.log`, `integration.log`, `sqlite-integration.log`, `d1-recheck.log`, `browser.log`, `native-browser.log`). These generated artifacts are ignored; no credentials or live-site content were used.

## Limits

This is compatibility retention, not a native-to-sandbox data migration. Fresh registry distribution remains Block Kit. No EmDash 1.0 runtime claim, managed Inventory service integration claim, official external review completion, commit, push, merge, publication, deployment, or live-site migration is claimed. External review and human merge remain pending.
