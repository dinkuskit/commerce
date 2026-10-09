# Propagate approved main contracts into initial US policy

> Superseded for bundle size and the installation gate by [CURRENT-HEAD.md](CURRENT-HEAD.md): after #75 the backend is 110,484 bytes, under the 131,072-byte cap.

Inputs: US policy checkpoint `ca38c1c8c4f136f25469ded0c200f74773802668` and updated country checkpoint `4c10da1505b1c89f4c7400683aefe3e6c7394bd5`, which contains approved main `89bb9f696fb2ad5ad9103da4e0cf04bd56d9d461`. Clean ordinary merge preview; common ancestor c6349b54f9295958fe6ced90f44fc9bd25bc48b6.

The imported changes are the five Node22/repository-contract files and the country integration proof. Canonical GrillTrack ledger/events, retained lineage and every US policy decision remain byte-identical to ca38c1c. No reconciliation or decision changes were needed. All runtime, tests, scripts, manifest, lockfile and root npm policy match updated country checkpoint4c10da1 exactly.

Fresh checks under Node22.23.2: focused repository-contract tests4/4, repository/feature audits and GrillTrack CLI validation pass. The matched country checkpoint also passed the complete quick gate (362 unit tests and typecheck), plus an offline npm dry-run accepted under Node22 and rejected under Node24.16.0 with EBADENGINE. Those runtime tests and browser journeys were not repeated for this decision-only composition.

The country build remains137927 bytes with SHA256 `ed25cef1433b3c0e74bd133d0f7f5a63bb4893b93f3d500215cb6344f4db6aab`; installation remains blocked by the unchanged131072-byte per-file cap. No full-gate pass is claimed.

Historical review `req-20261008T183807Z-278889526077` remains preserved: comprehensive P3 and zero findings on ca38c1c/basec6349b5. It does not qualify the new head/base. The limited imported delta was checked against approved main and the verified country checkpoint; no new comprehensive review or native ClawSweeper qualification is claimed. No main merge, release, contact-tree edit or address/eligibility implementation.

Detailed evidence: `.grilltrack/work/us-release-scope-20261008/main-integration/`.
