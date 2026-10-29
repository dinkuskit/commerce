---
"@dinkuskit/commerce": patch
---

Report CLI timeouts, interruptions and dropped connections while reading a response body as transport failures (exit 3), not internal errors (exit 5). Keep raw transport exceptions out of command output and do not retry possibly applied writes.
