# Backend headroom

Base: `4a8fac510772dcce7be5280c9b9d7c0360d15e92`.

The official build emitted a 131,027-byte backend with SHA-256
`f4eb6cf3c8dc06422afec8dcddf2e1482a4f83e0aff1722e855079278d553b02`.
Factoring coupon validation error construction, nested line labels, and
terminal-conflict error construction emits 130,021 bytes with SHA-256
`c635ea65de3e86c04e020a43c0cb66f6b38529053a539f6ba7118864c008f827`.
This recovers 1,006 bytes and increases margin under 131,072 bytes from 45 to
1,051 bytes. The cap and official packaging pipeline are unchanged.

Source-map attribution estimates the largest Commerce contributors as checkout
orchestration (9,614 bytes), coupon composition (9,066), coupon validation
(6,762), coupon blocks (6,651), and catalog admin (6,572). These are diagnostic
estimates, not package size acceptance evidence.

Conditions, validation order, error classes/codes/messages, storage operations,
localization, dependencies, manifest and grants remain unchanged. New negative
cases check nested messages and first failure order; terminal conflict checks
assert exact codes and messages.

Verification: typecheck, 306 unit tests and repository/feature audits passed.
Full integration/browser verification and independent exact-source review are
pending. No Registry publication, deployment, real provider call, or merge.
