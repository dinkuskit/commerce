# run1 — PASS_LOCAL_FIXTURE

Source: `54764d9b3f68efc80225f7a66237880efeb7e0f2`; sourceDirty=false. Assertions SHA256:
`2a6937c1830490f801fbfab2a8bcd3ffec21963a10cbbc589e1e80abe26a14f1`. UTC: 2026-10-16T14:37:10.402Z to 2026-10-16T14:37:29.942Z.

[Observable join/state](observable-state.json), [execution/build identity](result.json),
[Commerce load](loaded-dinkus-commerce.json), [Payments load](loaded-r_3brsc2on3bu673rn.json).

Run `local-1792161422941-e075c579-run1`; site `local-local-1792161422941-e075c579-run1`; binding `binding-local-1792161422941-e075c579-run1`.
Checkout `cad1af35-2da6-4f1a-bd8e-d75f9c7b353f`; Receipt: receipt:cad1af35-2da6-4f1a-bd8e-d75f9c7b353f.
Exactly one local USD12 paid fixture order, one connection and one session;
wake acknowledged. Fresh database/storage/browser context, zero test retries.

- [run1-order-detail-fixture.png](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-local-merchant-20261016-54764d9/run1-order-detail-fixture.png)
- [run1-payments-commerce-recorded-fixture.png](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-local-merchant-20261016-54764d9/run1-payments-commerce-recorded-fixture.png)
- [run1-guest-paid-fixture.png](https://github.com/dinkuskit/dinkus-pr-assets/releases/download/commerce-local-merchant-20261016-54764d9/run1-guest-paid-fixture.png)

Synthetic issuer, payment service and Stripe result. No real provider/PB/Ship/PDF/tracking, Registry installation/update, deployed authentication or full hosted E2E certification. The order remains Processing; nothing manually completes fulfillment. See [scope and commands](../PROOF.md).
