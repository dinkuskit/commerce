---
"@dinkuskit/commerce": patch
---

Commerce asks only for DinkusKit's own hosts: payments, coupons and ship under dinkuskit.com, and dinkuskit.com itself. The isolated Ship TEST profile from 0.3.0-beta.0 and its test host `ship.sm0ky.dev` are gone: checkout settings refuse that profile, and every store uses Ship at ship.dinkuskit.com.
