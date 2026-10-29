---
"@dinkuskit/commerce": patch
---

Reject malformed explicit Payments readiness flags before creating a payment session, matching the existing readiness check. Continue accepting successful bindings without a readiness flag and allow historical lookup when current payment creation is not ready.
