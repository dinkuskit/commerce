# Cart email stopped at send time

Decision: `cart-email-stop-at-send-20261123`.

`tests/features/checkout/cart-email-stop-at-send.test.mjs` runs Commerce's built Registry bundle in a workerd isolate
behind a real EmDash 1.5 runtime, as the Registry runs it, with a stand-in email sender. Store emails' send is EmDash's
own `email.send` for plugin `dinkus-email`.

1. A cart email to Ana goes.
2. Ana is put on `cart_email_stops` (the hash of her trimmed, lowercased address, as the stop link's route keeps it).
3. The same cart email, to ` Ana@Buyer.test `, is refused: the send rejects with
   `Plugin dinkus-commerce:0.8.0 hook email:beforeSend failed: CART_EMAIL_STOPPED: …`, and nothing reaches the sender.
4. Ana's order confirmation, and Bo's cart email, still go.

Run with Node 24.22.0 after `npm run build`: `node --test tests/features/checkout/cart-email-stop-at-send.test.mjs`.
Output: [run.log](run.log).

Inside the isolate EmDash puts the plugin and hook in front of the message, so a sender should look for
`CART_EMAIL_STOPPED` anywhere in it.
