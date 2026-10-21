---
"@dinkuskit/commerce": patch
---

Recover the 5-minute background check when the site scheduler fails or stalls
while Commerce is switched on. Switching on now gives the scheduler 3 seconds
and never fails the hook; until the check is registered, the next request
registers it, at most one attempt a minute per isolate, so payments a shopper
never returned from and Ship labels are still picked up without switching the
plugin off and on.
