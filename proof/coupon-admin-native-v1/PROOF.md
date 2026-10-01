# Coupon admin native v1 — final bounded capture

This canonical public proof records the final focused browser capture and its
immutable media publication. It complements the append-only historical
`.grilltrack/proof` record; that history is not a complete action log.

## Boundary

The supported synthetic EmDash host fixture uses the native client page,
server route adapter, controller, and browser-safe contract in `src/admin/`,
with the existing native mapping. It is not a Registry-installed production
mount. The source/test set is bound by
[`source-manifest.sha256`](./source-manifest.sha256) with identity
`sha256:1c026ebbb5b65d46b2b898d992b3d1af47c698430f9c4860d4098a0769c52445`.

## Verification

- Focused unit result: 238/238 passed.
- Pinned typecheck and audit results: passed.
- Parent independent browser qualification: passed 1/1, exit 0.
- Final capture run: `1790855042182`; the fixed-USD creation is captured
  separately.
- Usage counts shown in both relevant captures: consumed `1`, pending `1`,
  released `1`, remaining `1`.
- Storage evidence retains pending, consumed-with-provider-session, and
  released attempts; the coupon is disabled.

No code, test, full-suite, or browser rerun was performed for this metadata
follow-up.

## Immutable media

The complete provenance, redaction statement, byte sizes, SHA-256 values, and
release URLs are canonical in
[`media-manifest.json`](./media-manifest.json). The selected six screenshots
and storage evidence are published under the immutable
[commerce-coupon-admin-1c026ebbb5b6 release](https://github.com/dinkuskit/dinkus-pr-assets/releases/tag/commerce-coupon-admin-1c026ebbb5b6):

| Artifact | Size | SHA-256 | Immutable link |
| --- | ---: | --- | --- |
| `coupon-empty-before.png` | 91,732 | `8d9816b683bd5314919c55fa1602f07767f233ff069dbc35d4946469c19c7dbd` | [open](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-coupon-admin-1c026ebbb5b6/coupon-empty-before.png) |
| `coupon-created-percent.png` | 109,473 | `dcaf3c0449ffff4f20e7f35bd24a99fc1bd99e39f04881786b03f7a812fbb28b` | [open](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-coupon-admin-1c026ebbb5b6/coupon-created-percent.png) |
| `coupon-created-fixed.png` | 111,162 | `e07cffb30db22560118c5e9709c68169ea82c5d9442e43020be52ad81d81d179` | [open](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-coupon-admin-1c026ebbb5b6/coupon-created-fixed.png) |
| `coupon-usage-real-attempts.png` | 116,037 | `5ad5b75f03fe3fffc77a1206a22d82b4077fc61609f82f1fcaaf5a39b76bb924` | [open](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-coupon-admin-1c026ebbb5b6/coupon-usage-real-attempts.png) |
| `coupon-disabled-persisted.png` | 114,419 | `8f5b2d629e5b86d5f0f0392ac7bc3e76d53d916d52df47f2847ac92e36dab4f7` | [open](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-coupon-admin-1c026ebbb5b6/coupon-disabled-persisted.png) |
| `coupon-final-after.png` | 117,916 | `0f807dbdadc8119127eaaba221f133e84f3a9c0a2af1f96218e15e30f54bc858` | [open](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-coupon-admin-1c026ebbb5b6/coupon-final-after.png) |
| `coupon-storage-evidence.json` | 515 | `88a3c9ad411332c5ffc73151021d8312fa34c8ddf74da47d1e8ad5e11b81c7a1` | [open](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-coupon-admin-1c026ebbb5b6/coupon-storage-evidence.json) |

The release and manifest identify the fixture as reviewed synthetic state with
no sensitive data.

## Lineage note

The original base was `d3f7e591ef64c63d7748fe75e746dcfe39bbb4ca`; fetched
`main` is `5710fc185645ed56098aff5727da03483be067ea`. Their drift remains a
parent-owned canonical lineage and production-mount concern; this proof does
not claim integration clearance.
