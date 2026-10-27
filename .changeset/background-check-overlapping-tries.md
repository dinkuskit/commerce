---
"@dinkuskit/commerce": patch
---

When the site scheduler hangs long enough for a second try to start, a late failure from the first try no longer makes Commerce forget that the second try registered its 5-minute background check. Switching Commerce on still forgets any earlier registration and writes the check again.
