---
"@dinkuskit/commerce": minor
---

Archive a product by moving its page to EmDash's trash. The product panel's Archive product and Restore buttons, the catalog API's `archive` op and the CLI's `products archive` and `products restore` commands are gone: trashing the page takes the product off sale and keeps its link, Restore from the trash brings the page back as a Draft, and publishing it sells the product again. A Commerce Restore no longer leaves a Draft under a live page with no Publish button. Publishing a page also sells a product archived with the old Archive button, so nothing archived before the upgrade is stranded.
