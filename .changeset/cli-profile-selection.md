---
"@dinkuskit/commerce": patch
---

Fail closed when a requested CLI configuration profile is missing or malformed. Inherited JavaScript property names no longer count as defined profiles, and selected profiles/maps must be JSON objects before any HTTP request. This prevents a malformed selection from silently dispatching an authenticated change to the base site. Explicitly defined names, valid overrides, configuration precedence, and project-config credential restrictions are unchanged.
