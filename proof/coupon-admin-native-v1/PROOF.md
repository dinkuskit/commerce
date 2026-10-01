# Coupon admin native v1 — current composition verification

This canonical public proof records the current bounded browser capture and
composition verification. Historical proof and media remain unchanged and are
not relabeled as current composition proof.

## Boundary

The supported synthetic EmDash host fixture uses the native client page,
server route adapter, controller, and browser-safe contract in `src/admin/`,
with the existing native mapping. It is not a Registry-installed production
mount. The source/test set is bound by the refreshed
[`source-manifest.sha256`](./source-manifest.sha256), including fixture
hygiene. The current composition baseline is
`git:5710fc185645ed56098aff5727da03483be067ea`; approved lineage plan
`15aa3e6cee8cffda9b9fa353a4f0175dd6f79aad82222a6e8190320530ba1ab5` was
applied with merged CLI source
`fd423c6d9aaba885696f65926da0680f78659b74`.

## Verification

- Full pinned unit result: 248/248 passed; integration result: 22/22 passed.
- Pinned Node `v22.23.2` typecheck and build stages passed.
- Current native browser capture: `browser-20261001T152159Z`, 1/1, exit 0.
- Parent independent real-SQLite checks: 3/3 passed.
- Owned bounded composition proof is verified; official CI and independent
  review remain pending.
- Full rail exit: 1, blocked in shared `test:sandbox` startup by unavailable
  Google font metadata/files. This is outside the owned admin/test partition.
- Usage counts shown in both relevant captures: consumed `1`, pending `1`,
  released `1`, remaining `1`.
- Storage evidence retains pending, consumed-with-provider-session, and
  released attempts; the coupon is disabled.

Raw logs, exit markers, run state, and current proof are retained under
`.grilltrack/work/coupon-admin-run/composition-verification/`.

## Immutable media

The complete provenance, redaction statement, byte sizes, SHA-256 values, and
current release URLs are canonical in
[`media-manifest.json`](./media-manifest.json). The selected six screenshots
and storage evidence are published under the immutable
[commerce-coupon-admin-16b1e96d31fa release](https://github.com/dinkuskit/dinkus-pr-assets/releases/tag/commerce-coupon-admin-16b1e96d31fa):

| Artifact | Size | SHA-256 | Immutable link |
| --- | ---: | --- | --- |
| `coupon-empty-before.png` | 91,732 | `8d9816b683bd5314919c55fa1602f07767f233ff069dbc35d4946469c19c7dbd` | [open](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-coupon-admin-16b1e96d31fa/coupon-empty-before.png) |
| `coupon-created-percent.png` | 109,473 | `dcaf3c0449ffff4f20e7f35bd24a99fc1bd99e39f04881786b03f7a812fbb28b` | [open](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-coupon-admin-16b1e96d31fa/coupon-created-percent.png) |
| `coupon-created-fixed.png` | 111,162 | `e07cffb30db22560118c5e9709c68169ea82c5d9442e43020be52ad81d81d179` | [open](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-coupon-admin-16b1e96d31fa/coupon-created-fixed.png) |
| `coupon-usage-real-attempts.png` | 116,037 | `5ad5b75f03fe3fffc77a1206a22d82b4077fc61609f82f1fcaaf5a39b76bb924` | [open](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-coupon-admin-16b1e96d31fa/coupon-usage-real-attempts.png) |
| `coupon-disabled-persisted.png` | 114,419 | `8f5b2d629e5b86d5f0f0392ac7bc3e76d53d916d52df47f2847ac92e36dab4f7` | [open](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-coupon-admin-16b1e96d31fa/coupon-disabled-persisted.png) |
| `coupon-final-after.png` | 117,916 | `0f807dbdadc8119127eaaba221f133e84f3a9c0a2af1f96218e15e30f54bc858` | [open](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-coupon-admin-16b1e96d31fa/coupon-final-after.png) |
| `coupon-storage-evidence.json` | 515 | `a950eee22b32d1e472d88b21eac1abaca1a2aec2d9b0cfa24061dd5267e6f336` | [open](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-coupon-admin-16b1e96d31fa/coupon-storage-evidence.json) |

The prior release and its exact manifest are preserved in
[`media-manifest-historical.json`](./media-manifest-historical.json) and remain
explicit historical reviewed synthetic state with no sensitive data. It was
not overwritten by the current publication.

## Lineage note

The original frozen base was `fc97ead4d5c1d5a28567f467085e041f88223daa`;
the original base snapshot was `d3f7e59`; approved current main is
`5710fc185645ed56098aff5727da03483be067ea`. The current composition passed
bounded acceptance while preserving the exact five core-owned source files and
the unmounted contract; all 72 original snapshot files remain byte-identical.
The root is mechanically adopted at local commit
`40b02d8cd0f16e205e4951f03196177f228934a6`. Central native mounting, hosted
feature merge, deployment, official CI, and final independent review remain
pending; the shared full rail remains limited by unavailable Google font
metadata/files.
