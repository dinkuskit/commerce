---
"@dinkuskit/commerce": patch
---

Report an unknown outcome (exit 3) when Ctrl-C interrupts a catalog or order change after dispatch starts, instead of falsely saying nothing was sent (exit 4). Read-only preflights, blocked requests and already-cancelled changes do not mark a write as sent.
