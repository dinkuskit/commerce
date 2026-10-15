# Review adjudication — repair cycle1 of maximum2

Reviewed source952bad38526f643b92a81f6a27da83c61d44eccc, base29f55b0857dc4545de70a02f6b549135951ce4b8.

OpenClaw existing review reported2P2 findings; both accepted required_fix and reproduced as failing regressions before source repair:

1. Legacy label read before owner pin admission: completion's predicate refuses the new pin, but the subsequent unconditional ACK removes the event. Fix rereads pin after completion and skips ACK for the pinned order; regression requires zero ACK and unchanged completion/revision.
2. Ordinary isolated422 response: permanent refusal was treated as though it needed a tuple-bearing success receipt, causing infinite retries. Fix retains the documented permanent-refusal marker only after current identity/enabled pin/storage CAS; outcome explicitly refused. Matching 2xx receipt records accepted; mismatched 2xx still fails closed. Receiver order.ts returns422 NOT_SERVED for non-US addresses and ordinary error bodies. No successful intake or label is claimed for refusal.

That older run appliedP3 but used an older reviewer model and supplied no complete exact-tuple terminal attestation; findings are useful evidence, not qualified clean clearance. The corrected assigned infrastructure route must review the repaired exact head. No alternate route chosen.

Native review https://github.com/dinkuskit/commerce/pull/117#issuecomment-6173963164 reports no runtime defects but requests visible final-head authority proof. Accept the proof-publication gap as required_fix: current traces previously lived in ignored operator proof. Sanitized952 trace was posted at https://github.com/dinkuskit/commerce/pull/117#issuecomment-6176936819. Reject the factual assertion that952 did not update PROOF.md: git show952 changes the proof and adds the compiled legacy settings-switch regression. Pending-review wording is not absence of runtime verification. The accepted proof visibility request does not authorize live production actions.

All earlier head reviews/traces are superseded for repaired-head readiness. Reverify meaningful regressions, compiled Registry and bounded actual cross-component cases, then publish sanitized current-head results and obtain both required exact reviews. No merge/publish/deployment/config/grant/key/payment/ACK action against a live service.
