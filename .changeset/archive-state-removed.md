---
"@dinkuskit/commerce": patch
---

Commerce no longer keeps an archive mark of its own (`archivedAt`); archiving a product is moving its page to EmDash's trash. The Draft that loses a race for a page stays a Draft with no page, the product panel and the CLI no longer show "Archived", and the Registry backend is 394 bytes smaller. A product archived with the Archive button of Commerce 0.8.0 or older is no longer kept off the shop by that mark after the update: trash its page to archive it again.
