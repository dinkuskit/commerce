---
"@dinkuskit/commerce": patch
---

Enforce explicit `CHECKOUT_PHASE_TRANSITIONS` before attempt CAS writes, retain payment wakes until paid-order handoff durably succeeds or on late-paid mismatch against a released attempt, and prevent transient coupon provider-session attachment failures from blocking authoritative paid order completion.
