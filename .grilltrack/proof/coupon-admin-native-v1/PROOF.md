# Coupon admin native v1 — bounded browser proof

Status: cleanup-ready uncommitted working tree. This records the successful
focused proof, not a clean independent review or delivery. No commit, push,
PR, merge, deploy, permission change, payment action, customer data, or secret
was used.

Fixture boundary: supported EmDash host APIs, neutral synthetic SQLite data,
authenticated dev-bypass, real plugin routes, and real durable storage. This
is a test fixture and is not a Registry-installed mount; the serial production
descriptor/storage/routes mount remains pending.

Owned source is limited to the existing admin slice plus this repair:
`src/admin/coupons*`, the parent `src/admin/native.ts` mapping, focused coupon
tests, implementation documentation, and this public proof. No core/kernel/
shared source, dependency, config, theme, sidebar, or manifest overhaul was
made.

The page visibly separates labels and values, gives controls/borders and
distinct buttons, groups list/edit/usage, wraps responsively, preserves host
theme colors, and keeps full ISO offset strings legible. Pending operations
disable controls. Request/selection generations prevent stale initial/load
responses from replacing a new selection; recovery sets pending, catches
failures, preserves the draft, and refreshes the expected revision only for
the same coupon.

The focused browser spec covers empty-before capture, percentage create,
separate fixed-USD create and storage assertion, invalid input, real usage
counts (consumed/pending/released/remaining), concurrent domain edit and CAS
recovery with retained draft, supported 503 reload fallback, explicit save,
disable, and persisted disabled state. It uses no payment bridge or test
charges.

Verification actually observed:

- Parent pinned Node 22.23.2 `test:unit`: 238/238 passed.
- Parent pinned `typecheck` and `audit`: passed; logs remain under
  `.grilltrack/work/coupon-admin-run/parent-{unit,typecheck,audit}-final.log`.
- `mise exec node@22.23.2 -- npx playwright test -c tests/coupon-native.playwright.config.mjs`
  — 1 passed in 13.1s, exit 0.
- Final browser artifact run:
  `.grilltrack/work/coupon-admin-browser-proof/1790854740513/`
- Synthetic storage evidence proves the disabled coupon retained exactly three
  immutable attempts: pending, consumed with provider session, and released.
- Screenshots were inspected locally; hashes are recorded below. They remain
  local pending immutable publication and are not committed.

Screenshot and evidence SHA-256:

```text
coupon-created-percent.png       dcaf3c0449ffff4f20e7f35bd24a99fc1bd99e39f04881786b03f7a812fbb28b
coupon-disabled-persisted.png    8f5b2d629e5b86d5f0f0392ac7bc3e76d53d916d52df47f2847ac92e36dab4f7
coupon-empty-before.png           8d9816b683bd5314919c55fa1602f07767f233ff069dbc35d4946469c19c7dbd
coupon-final-after.png            a5ce70222d6357e68d1793f23878b9cda1e6c78b916f6f745d014dfe8d37d662
coupon-usage-real-attempts.png   1353f05410ef93267b090b0a6b07f52ff3b1f84ef677710aca3475eaf3bab2c0
coupon-storage-evidence.json     1bfdfacaa4165c73f2e0f55bef9da80983a58f25e7c02742b42502f9ffcfd486
```

Independent review and exact-commit binding remain pending. Historical
`.grilltrack/proof` references and prior failed-run artifacts are preserved.
