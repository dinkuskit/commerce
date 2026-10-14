---
"@dinkuskit/commerce": patch
---

Recognize successful Payments checkout-binding responses without a wire `ready` field, so Registry checkout readiness can become supported after the store is configured. Preserve binding identity, provider, account, mode, and refusal checks.
