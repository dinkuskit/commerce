# Isolated Ship cohort v1 proof

Source baseline:29f55b0857dc4545de70a02f6b549135951ce4b8. Source-only contract:docs/contracts/isolated-ship.md; GrillTrack decision isolated-ship-cohort-v1. No deployment, publication, installation, configuration/grant/credential action, live order/payment, label/provider or email action performed.

Targeted initial gate:21 tests passed, including isolated tuple admission, empty cohort, immutable/idempotent admission, historical exclusion, TEST guard, foreign events, disable vs completion/ack CAS, late settings response and legacy permanent-pin protection. The negative config fixture failed against the unmodified compiled baseline before implementation (Checkout unavailable), proving the new supported tuple behavior was absent.

Compiled Registry test uses actual built backend and shipped manifest through pinned Workerd/EmDash storage bridge. Synthetic signed issuer and Ship HTTP fixtures are intercepted locally. Historical fixture order1001 and its storage revision stay unchanged; only fresh explicit TEST fixture admitted. Wrong role, foreign labels, late disabled events and expected-generation/header tuple checks pass. No Payments checkout session/transport calls in this proof. This is not actual issuer/Ship cross-repository or live proof, and does not establish provider/no-email behavior.

Full gate initial run:570/572 unit checks passed; feature front-door imports and manifest host expectation failed. Both corrected without changing policy; final full gate/reviews pending. Generated logs retained under ignored .tmp/isolated-ship-cohort-contract.

Final local acceptance: full gate passed (573 unit,95 integration,10 sandbox,1 native-local-stock,3 Orders browser, native consumer and2 settings profiles). Final quick gate then passed575 unit checks after two additional legacy-in-flight race fixtures and final normalized-host/admin-link guards.13 focused isolation/race checks passed. Typecheck, public-source/feature audits and bundle cap passed. Final backend SHA256 `67c136ee3b9ed00eae0cd0093e4d212e1765e7cb3608f8d7e691fe1ce30a49cd`.

Actual local cross-component proof additionally consumed an actual issuer-produced signed ES256 sandbox pass, the compiled Commerce plugin/shipped manifest and actual compiled Ship Worker with SQLite Durable Object. Empty receiver cohort rejects intake; one exact fresh TEST fixture is admitted once; historical fixture remains unchanged/absent; wrong tuple, historical and live requests reject; disable-before-intake-receipt prevents Commerce acknowledgement. Payment session/provider/unapproved-network calls are zero. Tokens and JWK are process-local with no artifact output. Component source identities and unabridged safe result records remain in ignored operator proof, not copied into this public repository.

Fidelity limit: the Ship harness entry reexports only default/StoreShipping from the unchanged compiled bundle; its primitive named exports fail direct workerd startup and require Ship-owner adjudication. No label was created in this run. Receiver-produced label/completion/ack and email suppression are not claimed; Commerce disable/completion/ack races use local fixtures. This is source-level integration evidence, not installed/deployed/promotion evidence.

Required exact-head OpenClaw, native ClawSweeper and CI evidence pending PR creation. No merge or promotion authority.
