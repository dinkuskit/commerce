---
"@dinkuskit/commerce": patch
---

A shopper's bodyless `GET account/profile` now returns their saved profile instead of HTTP 400 `INVALID_PLUGIN_REQUEST` (commerce#256). The route takes a text body and parses a POST's JSON itself; malformed JSON on POST is now refused in-band as `INVALID_INPUT`, like every other Commerce refusal. The size limit, session header, origin checks and `no-store` are unchanged.
