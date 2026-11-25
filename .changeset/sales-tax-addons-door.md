---
"@dinkuskit/commerce": minor
---

Sales tax through the add-ons door. The Tax plugin answers beside Coupons with the address it priced (`to`), a rate for every line and one for shipping, in millionths; Commerce refuses an answer for any other address as `CONTENTION`, takes discounts off first, then rounds each line's tax and shipping's tax to the cent once, halves up, and adds the tax to the total. The pricing snapshot then carries `tax` and `lines[].tax`; a checkout without a tax answer carries neither, so it is unchanged. Orders shows a **Sales tax** row, and the thank-you page, the order lookup and the courier's `order.paid` news carry the tax. Payments must accept the tax and charge it as a **Sales tax** line before a taxed checkout can pay; until then the Payments service refuses it rather than charging less. No new permissions.
