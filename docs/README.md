# Documentation

- [CHARTER.md](CHARTER.md) records the current public product and clean-room
  repository decisions.
- [implementation/authorize-net-checkout-provider.md](implementation/authorize-net-checkout-provider.md)
  is the proposal-only note for admitting `authorize_net` beside `stripe` in
  installed checkout (GrillTrack `checkout-authorize-net-provider-20261008`).
- [implementation/guest-checkout-public.md](implementation/guest-checkout-public.md)
  is the Template Store issue 20 handoff for mounted guest checkout.
- [implementation/checkout-payment-window.md](implementation/checkout-payment-window.md)
  is the current public 1800..1860 payment-window contract and Payments handoff.
- [implementation/product-media.md](implementation/product-media.md)
  is the product image, gallery, placeholder, size-preset and alt-text
  contract over EmDash's Media Library.
- [REVIEW_RAIL.md](REVIEW_RAIL.md) describes the fail-closed ClawSweeper
  command boundary.

Documentation must remain generic and public-safe. Private operating rationale,
tenant specifics, and production configuration belong outside this repository.
