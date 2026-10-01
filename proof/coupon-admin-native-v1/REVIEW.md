# Coupon admin native v1 — current review handoff

The current pinned native browser run passed 1/1 with exit 0, the parent
independent real-SQLite checks passed 3/3, and the visible usage counts were
1 consumed, 1 pending, 1 released, and 1 remaining. The owned bounded
composition proof is verified. The full pinned rail produced 248/248 unit and
22/22 integration passes but exited 1 at shared sandbox startup because
Google font metadata/files were unavailable.

This is not a self-independent clean-review claim. Official CI and independent
review remain pending, and no final merge or production-mount clearance is
claimed. The current published media and its provenance are in
[`media-manifest.json`](./media-manifest.json); the prior release is preserved
in [`media-manifest-historical.json`](./media-manifest-historical.json).

The review scope is the exact source set listed in
`source-manifest.sha256`, covering the native mapping, browser-safe contract,
client page, controller, server routes, focused unit test, browser
configuration, supported fixture, browser spec, and fixture `.gitignore`.
Historical `.grilltrack/proof` references and the original immutable media
release remain unchanged. The full-rail font failure is an environment limit,
not an owned source or test change.
