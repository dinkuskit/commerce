# Integrate approved Node 22 repository contracts

> Superseded for bundle size and the distribution gate by [CURRENT-HEAD.md](CURRENT-HEAD.md): after #75 the backend is 110,484 bytes, under the 131,072-byte cap.

Inputs: country checkpoint `c6349b54f9295958fe6ced90f44fc9bd25bc48b6` and approved main `89bb9f696fb2ad5ad9103da4e0cf04bd56d9d461`. Clean ordinary merge; common ancestor is qualified variant source `aacbcb3fd99d67fcfc06008b8887b1b0668fd1a8`.

The imported delta is five files: root `.npmrc`, `AGENTS.md`, `package.json`, repository audit and its tests. Runtime, build scripts, feature/browser tests, lockfile, canonical GrillTrack ledger/events and retained lineage are byte-identical to the country checkpoint. No reconciliation or product-decision changes were needed. Audit/test/instruction files exactly match approved main; package integration preserves country exports and imports main's Node engine contract.

On Node22.23.2: `bin/verify-commerce quick` passes (362 unit tests, typecheck, repository/feature audits). The focused repository-contract suite passes4/4 including nested npm-config rejection and exact root-config guard. `npm config get engine-strict` is true. Offline npm installation dry-run succeeds under Node22 and rejects Node24.16.0 with EBADENGINE requiring >=22.16.0 <23. Dry runs do not install dependency changes. GrillTrack CLI validation passes.

The rebuilt backend remains137927 bytes, SHA256 `ed25cef1433b3c0e74bd133d0f7f5a63bb4893b93f3d500215cb6344f4db6aab`, exactly matching the prior build; it exceeds the unchanged131072-byte cap by6855. The previously proven official installed-coupon rejection remains unresolved. Browser journeys were not repeated because application source and emitted backend are unchanged.

Historical review request `req-20261008T183741Z-278582221293` is preserved: comprehensive P3, one accepted P1 bundle-size finding on c6349b5/base35fb11d. It is not current-head review qualification. This bounded integration does not claim a new comprehensive review or native ClawSweeper qualification. The imported delta was inspected against approved main; no additional changes were introduced. No main merge, release, cap change, provider or address policy change.

Local detailed evidence: `.grilltrack/work/main-integration-20261008/` (preview, invariants, quick/focused-test logs, npm dry-runs, bundle hash and CLI validation).
