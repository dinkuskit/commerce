# Isolated Ship cohort v1 proof

Baseline: `29f55b0857dc4545de70a02f6b549135951ce4b8`. Contract: `docs/contracts/isolated-ship.md`; GrillTrack lock `isolated-ship-cohort-v1`. This slice changes source only. No deployment, publication, installation, settings/grant/credential action, live order/payment, provider or email action performed.

## Commerce acceptance

Final full gate:578 unit,95 integration,10 sandbox,1 native-local-stock,3 Orders browser, native consumer and2 settings checks passed. An additional compiled Workerd regression then passed: a legacy Registry invocation captures its connection, settings switch to sandbox while label polling is in flight, and a fresh unpinned order becomes visible; no old-destination POST or acknowledgement occurs. Existing compiled isolated admission boundary also passed. Typecheck, source/feature audits, package cap and diff whitespace checks passed.

Coverage includes exact tuple/normalized-host denial, JWT claim admission, expected-generation key trade, private owner admission, idempotent immutable site/recipient/generation pins, explicit TEST, empty cohort, historical/foreign event exclusion, disable vs completion/ack CAS races, late settings responses, captured legacy identity switch, permanent no-production-fallback and existing production fixtures.

First full run failed two repository contract expectations (feature front-door imports and host manifest list); corrected through owned interfaces. Next integration run found the second old host expectation; corrected. Final acceptance also tightened legacy current-connection rechecks under the confirmed in-flight contract. These failures and commands remain in ignored logs. The initial new-config regression failed against the unmodified compiled baseline before source support existed.

Backend:117308 bytes, SHA256 `028f6e2c7575137a73bcfe1904eb91ed1a74dfe2de29c30ac70cc28721cf9b22` (see exact build output for byte count). Manifest declares only the exact additional sandbox host, without publication or an effective live grant claim.

## Local actual producer/receiver boundary

Actual issuer-generated signed ES256 sandbox pass -> actual Commerce compiled backend/shipped manifest through pinned EmDash Workerd/storage bridge -> actual raw compiled Ship Worker entry and SQLite Durable Object. Ephemeral synthetic identities/data and local JWKS interception only; no credentials/JWK output. Exact component identities and artifact digests are held in ignored operator results, not imported private repository material.

The receiver cohort starts empty and denies intake. One exact fresh TEST fixture is owner-admitted; historical fixture order1001 remains byte-for-byte unchanged with its storage revision intact and absent from the receiver. Wrong tuple, protected ID and non-TEST requests deny. One canonical fresh order produces version1 intake and, after completion, version2 intake; retries do not create another canonical order.

Ship's EXISTING public Durable Object saveShipFrom/addBox/buyLabel(kind=practice) lifecycle generates a real event. Commerce consumes the actual HTTP event tuple, completes only the fresh fixture and receives the actual tuple-bound ACK; the receiver event list becomes empty. A second test disables through the supported private owner route while that real label-list response is in flight: the fresh fixture is not completed, the event remains unacknowledged and there is no replay. Disable-before-intake-receipt also prevents local acknowledgement. Historical records stay unchanged in each run. Payment session, provider and unapproved-network calls are zero.

Raw repaired receiver entry is used with no integration export shim. The earlier primitive-export startup failure and owner-wire mismatch were separately repaired by the receiver owner; earlier machine-only/shim proof is retained as superseded operator evidence.

Fidelity limits: practice label via public DO RPC fixture is NOT owner-browser authentication or Pitney Bowes sandbox-postage proof. Alarm is reserved over public RPC and was not invoked. Independent injected EMAIL/alarm suppression remains receiver-owned verification, not claimed by Commerce. Synthetic fixture paid orders were seeded locally; no new real checkout/payment was created. Activation still requires operational drain/old session-token quiescence and separate owner authorization; settings checks are not instant revocation or cross-service deduplication.

## Review and delivery

PR117. Initial c4d2679 review requests became stale after the confirmed legacy-current check refinement; preserve them as stale. Exact final-head CI, comprehensive OpenClaw and native ClawSweeper completion/adjudication remain required. No merge or promotion authority.
