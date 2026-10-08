# Authorize.net installed checkout provider (proposal)

GrillTrack decisions below are **proposed**, not locked. Only Ryan may lock.

- `checkout-authorize-net-provider-20261008`
- `checkout-authorize-net-provider-ryan-notes-20261008` (#71 answers)
- `checkout-authorize-net-provider-ryan-notes-20261008b` (#72 answers)

Context: Payments exposes an `authorize_net` adapter and sandbox Accept Hosted
wiring ([payments PR #22](https://github.com/dinkuskit/payments/pull/22)).
Commerce [#67](https://github.com/dinkuskit/commerce/pull/67) freezes chosen
variant IDs, labels, price, and fulfillment before Payments contact. Charge and
paid amount checks must use that frozen total — never a recomputed price.

## Ryan answers

### From #71 (“Go with your picks”)

1. Keep `dinkuskit.commerce.registry-checkout/v1`. Legacy enabled configs without
   new fields keep loading. Test an old saved config.
2. Separate optional `authorizeNetMerchantId`. Do not reuse/overload
   `stripeAccountId`.
3. Sandbox only until Ryan approves live.
4. Implement now against payments #22. Paid only from authoritative transaction
   lookup (`gateway.getTransaction` / `getTransactionDetailsRequest`) plus
   amount and currency match against the **frozen** checkout total. Webhook
   alone never marks paid.

### From #72

1. Keep the settings name `authorizeNetMerchantId`.
2. Do **not** match Authorize.net against the Payments binding wire field
   `stripeAccountId`. Commerce reads a dedicated binding field also named
   `authorizeNetMerchantId`. No `stripeAccountId` fallback. The Commerce
   implementation depends on payments #22 adding that binding field.
3. Split more Registry backend into cohesive modules for about **6500 bytes**
   of headroom under the 131072-byte file limit, behavior unchanged.

## Product rules

1. `providerId` may be `stripe` or `authorize_net`.
2. Optional `authorizeNetMerchantId` only with `authorize_net`.
3. Optional `mode`, when present, must be `test`.
4. Paid requires authoritative Payments lookup matching the frozen attempt
   total and currency; webhook/return/token/timer never write paid.
5. Backend under 131072 bytes with meaningful headroom via cohesive factoring.

## Non-goals

No secrets, live traffic, merge, or GrillTrack lock by agents.
