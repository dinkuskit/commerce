# Coupon admin native v1 — current composition verification

This canonical public proof records the current bounded browser capture and
composition verification. Historical proof and media remain unchanged and are
not relabeled as current composition proof.

## Boundary

The supported synthetic EmDash host fixture uses the native client page,
server route adapter, controller, and browser-safe contract in `src/admin/`,
with the standard native mapping limited to `/products` and `/store`; the
named `CouponsPage` is composed only by the test fixture alongside its test-only
routes and storage. It is not a Registry-installed production mount. The
source/test set is bound by the refreshed
[`source-manifest.sha256`](./source-manifest.sha256), including fixture
hygiene. The repaired source identity is
`sha256:c5207970164ed4d15aac454617a1cca7a97551e2392f37c23ea39b3a01f4e68b`; the approved composition baseline was
`git:5710fc185645ed56098aff5727da03483be067ea`, with plan
`15aa3e6cee8cffda9b9fa353a4f0175dd6f79aad82222a6e8190320530ba1ab5` applied with merged CLI source
`fd423c6d9aaba885696f65926da0680f78659b74`.

## Verification

- Accepted OpenClaw P2 on prior head `2a9`, whose source identity was
  `sha256:16b1e96d31fa4cd1abed3851ebea58e1e7657cf9fb249762d49433c650cbb692`.
- Repair verification passed four focused tests, one native browser capture
  (`browser-20261001T163500Z`, 1/1, exit 0), build, and typecheck.
- Prior full CI passed 248 unit tests, 22 integration tests, five standard browser
  checks, and one native local-stock browser check; typecheck, build, and audit
  passed.
- Fresh CI and both independent reviews remain pending; no final merge or
  production-mount clearance is claimed.
- Usage counts shown in both relevant captures: consumed `1`, pending `1`,
  released `1`, remaining `1`.
- Storage evidence retains pending, consumed-with-provider-session, and
  released attempts; the coupon is disabled.

Raw logs and exit markers for this repair are retained under
`.grilltrack/work/coupon-admin-run/openclaw-p2-repair/`; the fresh browser
artifacts are under `.grilltrack/work/coupon-admin-browser-proof/browser-20261001T163500Z/`.

## Immutable media

The complete provenance, redaction statement, byte sizes, SHA-256 values, and
the fresh release URLs are canonical in
[`media-manifest.json`](./media-manifest.json). Those previously selected six screenshots
and storage evidence are published for the repaired source under the immutable
[commerce-coupon-admin-c5207970164e release](https://github.com/dinkuskit/dinkus-pr-assets/releases/tag/commerce-coupon-admin-c5207970164e):

| Artifact | Size | SHA-256 | Immutable link |
| --- | ---: | --- | --- |
| `coupon-empty-before.png` | 91,732 | `8d9816b683bd5314919c55fa1602f07767f233ff069dbc35d4946469c19c7dbd` | [open](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-coupon-admin-c5207970164e/coupon-empty-before.png) |
| `coupon-created-percent.png` | 109,473 | `dcaf3c0449ffff4f20e7f35bd24a99fc1bd99e39f04881786b03f7a812fbb28b` | [open](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-coupon-admin-c5207970164e/coupon-created-percent.png) |
| `coupon-created-fixed.png` | 111,162 | `e07cffb30db22560118c5e9709c68169ea82c5d9442e43020be52ad81d81d179` | [open](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-coupon-admin-c5207970164e/coupon-created-fixed.png) |
| `coupon-usage-real-attempts.png` | 116,037 | `5ad5b75f03fe3fffc77a1206a22d82b4077fc61609f82f1fcaaf5a39b76bb924` | [open](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-coupon-admin-c5207970164e/coupon-usage-real-attempts.png) |
| `coupon-disabled-persisted.png` | 114,419 | `8f5b2d629e5b86d5f0f0392ac7bc3e76d53d916d52df47f2847ac92e36dab4f7` | [open](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-coupon-admin-c5207970164e/coupon-disabled-persisted.png) |
| `coupon-final-after.png` | 117,916 | `0f807dbdadc8119127eaaba221f133e84f3a9c0a2af1f96218e15e30f54bc858` | [open](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-coupon-admin-c5207970164e/coupon-final-after.png) |
| `coupon-storage-evidence.json` | 515 | `a53c14236c19b507cd16091e9f05a1c476258e878bcf6633a92f4debc76aa952` | [open](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-coupon-admin-c5207970164e/coupon-storage-evidence.json) |

The prior release and its exact manifest are preserved in
[`media-manifest-before-exposure-fix.json`](./media-manifest-before-exposure-fix.json)
and remain explicit historical reviewed synthetic state with no sensitive data.
It was not overwritten or relabeled as proof of this repair.

## Lineage note

The original frozen base was `fc97ead4d5c1d5a28567f467085e041f88223daa`;
the original base snapshot was `d3f7e59`; approved current main is
`5710fc185645ed56098aff5727da03483be067ea`. The prior composition passed
bounded acceptance while preserving the exact five core-owned source files and
the unmounted contract; all 72 original snapshot files remain byte-identical.
The root is mechanically adopted at local commit
`40b02d8cd0f16e205e4951f03196177f228934a6`. Central native mounting, hosted
feature merge, deployment, official CI, and final independent review remain
pending; the shared full rail remains limited by unavailable Google font
metadata/files.
