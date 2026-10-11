# Route auth manifest landing proof

Maintainer accepted the PR103 contract: every route explicitly declares public or admin; admin routes require EmDash permissions; the built manifest lists exact shopper paths and the Registry backend digest outside the backend bundle. Recorded by GrillTrack lock/confirm/implement, preserving prior decisions and history.

Composition base: 05936c670b61fdb1b8d5971921cf8c79cc79526d (PR102 and PR104 landed). Original implementation: c3fe11c49994f16b146df4ad04c18238da360bb8. No merge conflicts.

Verification on Node22.23.2:
- `COMMERCE_PROOF_PORT=64851 ASTRO_DEV_BACKGROUND=1 npm exec --yes --package=node@22.23.2 -- ./bin/verify-commerce full`: exit0.
- 542 unit tests; 56 integration tests; 10 general browser tests; one native stock test; three packaged Registry tests; clean external npm consumer; two merchant-settings host tests passed.
- `npm exec --yes --package=node@22.23.2 -- npm run audit:repo`: public repository and feature contracts clean.
- Manifest reports six public Registry routes; backend128667bytes,2405bytes below cap, sha256388baeaa30c45f46bdbadbb29141a039b23b104ca40cb3ca55727a1938940027.
- Actual external npm consumer includes and dynamically imports `./route-manifest` using JSON import attributes. Tarball sha25648ddf717895967b667439b2cb026348daa05a494da7b8a39c9659b116b12ebac. Native admin, CLI help and foreign-origin denial passed; Registry settings/auth/checkout denial passed.

Parent source review and Antigravity read-only composition review found no required source fixes. Optional observation deferred: native entries use the shared registry surface label in the nested native section. Public-path selection and auth declarations are unchanged by that label; surface-specific consumers should revisit it in a focused follow-up. This is not a live Access policy change.

Limits: synthetic local hosts and unsigned local Registry artifact; no production publication, provider traffic or live Access policy mutation. Settings emitted an existing Base UI uncontrolled-field warning while both tests passed. Fresh external CI, native ClawSweeper and comprehensive OpenClaw reviews bind the pushed final head before merge.
