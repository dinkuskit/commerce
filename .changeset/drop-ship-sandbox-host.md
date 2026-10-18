---
"@dinkuskit/commerce": patch
---

Commerce asks only for DinkusKit's own hosts: payments, coupons and ship under dinkuskit.com, and dinkuskit.com itself. The isolated Ship TEST profile from 0.3.0-beta.0 and its test host `ship.sm0ky.dev` are gone. A store whose checkout settings still name that profile keeps checkout and simply has no Ship until it is set up with Ship at ship.dinkuskit.com, which every store uses.
