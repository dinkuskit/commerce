DinkusKit Commerce brings product, price and order management into EmDash.

Manage products beside their pages in your CMS, set regular and sale prices, and inspect orders from the store admin. Connect DinkusKit Payments for checkout; add Ship when you want to test the shipping-label workflow.

You supply the storefront. Installing Commerce does not create a finished shop or its customer-facing pages. Start with unmanaged products: the current Registry build does not provide managed inventory or coupon checkout.

## What Commerce connects to

Commerce asks to reach three DinkusKit addresses. It contacts none of them until you connect your store at DinkusKit.com, and a store you never connect makes no outside calls.

- **dinkuskit.com**: connecting your store, and the short-lived passes Commerce uses for the other two. Your store key is only ever sent here.
- **payments.dinkuskit.com**: opening a payment page with your own Stripe or Authorize.net account, and confirming the payment afterwards.
- **ship.dinkuskit.com**: sending paid orders to Ship, if you add it, and bringing back the tracking number once a label is bought.

[Explore Commerce](https://dinkuskit.com/docs/reference/commerce) · [Start your store](https://dinkuskit.com/start) · [See the demo store](https://playground.dinkuskit.com)

The screenshots show a local demo with synthetic products, not a live merchant store.

Building with it? [Star DinkusKit Commerce on GitHub](https://github.com/dinkuskit/commerce) to support the project.
