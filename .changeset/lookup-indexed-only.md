---
"@dinkuskit/commerce": patch
---

The order lookup at /track-order reads only the orders saved under the typed email. A missed lookup no longer reads every order kept without an email index, so changing the email on each try can no longer make Commerce read the whole order list. The orders API refuses an action that is not its own plain name, such as `["complete"]` or `"toString"`, instead of treating it as a reopen. The native build's publish route now clears a deleted product's prices, availability, media and feed rows, as the Registry build always has.
