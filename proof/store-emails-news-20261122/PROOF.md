# Store emails news proof (22 Nov 2026)

GrillTrack `store-emails-plugin-20261122` in dinkuskit/dinkuskit. The owner approved it on 2026-11-22.

- `outbox-proof.log`: what the courier reads from Commerce's outbox in the unit and runtime tests (cart links
  redacted). It covers `order.paid`, `order.shipped` with a carrier and tracking number, the 7,500-byte item budget
  on 60-line orders, and `cart.left`. The `cart.left after a changed-email retry` line shows that news is bound to
  the checkout its link was made for. After the shopper retried the same cart, unticked, under another email,
  rereading the outbox still names the first address with its tick and the same link. The same test then uses
  that link's stop and gets exactly one `cart_email_stops` row, for the first address
  (`tests/features/checkout/cart-left-news.test.mjs`, "the email's key lasts only as long as its cart").
- `cart-email-upgrade-bridge.json` and `cart-email-upgrade-new.json`: the 0.8.0 upgrade traces
  (`tests/sandbox/registry-upgrade-cart-email.spec.mjs`).
- `new-cart-email-settings.png`: Commerce settings after the upgrade, with both Catalog switches kept and no cart email setting.
