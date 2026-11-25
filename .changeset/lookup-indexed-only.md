---
"@dinkuskit/commerce": patch
---

The order lookup at /track-order reads only the orders saved under the typed email. A missed lookup no longer reads every order kept without an email index, so changing the email on each try can no longer make Commerce read the whole order list. The orders API refuses an action that is not its own plain name, such as `["complete"]` or `"toString"`, instead of treating it as a reopen. The native build's publish route now clears a deleted product's prices, availability, media and feed rows, as the Registry build always has.

Checkout readiness may refresh up to 300 times in a rolling 24 hours, up from 100: a store with steady visitors used about 96 at the 15-minute cache, so a few settings changes could close checkout until the count fell. Variant option and value labels are measured after NFKC normalization, so a 160-character label can no longer be stored at many times that length. The `dinkus-commerce` CLI refuses a `--oz` or `--weight-oz` value Commerce would refuse (ounces above 0 and up to 2400, at most two decimals) before its preview, instead of previewing and confirming it.
