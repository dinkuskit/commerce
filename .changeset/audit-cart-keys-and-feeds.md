---
"@dinkuskit/commerce": patch
---

A guest cart key now lasts only as long as its cart: past the cart's 30 days from its last change every request with it is refused, and before a cart is made the key lasts 30 days. The five-minute background check deletes keys past their date whose cart is gone, up to 100 a run, so keys no longer pile up after their carts. A cart replace of more than 100 lines is refused before any line is looked up. The Google and Meta feed builders drop characters XML cannot hold, so one product's text cannot break the whole feed, and `pageProductFeedRows` refuses a page size that is not a whole number instead of returning the same cursor. The Registry build also leaves out three Manage stock refusals that only a managed item can reach, since that build never has one.
