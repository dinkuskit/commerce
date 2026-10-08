# Pack on the Commerce order

Commerce keeps the order number. Pack sends Inventory only the ticket ids saved
when reserve returned them. It does not buy a label and does not mark anything
Delivered.

## Ticket ids

`CheckoutInventoryPort.reserve` still accepts the legacy string `"reserved"`.
That result leaves the paid order without `inventoryHold`. Ticket ids are
stored only when reserve returns `{ outcome: "reserved", ticketIds }` and the
list matches the frozen stock requirements one for one. Same-SKU lines stay
merged into one requirement, so they are one ticket. The Commerce order number
is not written onto the hold and is not sent to Inventory.

The hold freezes `siteId` and `poolId` from the checkout-time Inventory
binding. A later configuration change cannot substitute them.

## Command

One ticket builds `stock.pack`. More than one builds `stock.pack_all`.
`references` is empty. `commandId` is `pack:` plus the ticket ids, not the
order number.

```json
{
  "schema": "dinkuskit.inventory.command/v1",
  "commandId": "pack:ticket-hats",
  "type": "stock.pack",
  "context": { "siteId": "site-test", "poolId": "pool-test" },
  "payload": { "reservationId": "ticket-hats" },
  "references": []
}
```

```json
{
  "schema": "dinkuskit.inventory.command/v1",
  "commandId": "pack:ticket-hats,ticket-shirts",
  "type": "stock.pack_all",
  "context": { "siteId": "site-test", "poolId": "pool-test" },
  "payload": { "reservationIds": ["ticket-hats", "ticket-shirts"] },
  "references": []
}
```

## No hosted route

Inventory `33840af97ed18f35c0c27f663c2250219efe3c26` `src/cloudflare/hosted-worker.ts`
admits `/v1/account-overview`, `/v1/connect`, `/v1/status`, `/v1/operations`,
`/v1/locations`, `/v1/skus`, `/v1/skus/register`, `/v1/stock`,
`/v1/stock/opening/eligibility`, `/v1/stock/adjust/preview`,
`/v1/stock/adjust/confirm`, `/v1/stock/opening/preview`,
`/v1/stock/opening/confirm`, `/v1/receipts`, `/v1/transfers`, and
`/v1/stock/transfers`. There is no pack route. Pack therefore shows
**Not packed** and sends nothing. Fulfillment stays **Not recorded**. An order
without ticket ids gets the same refusal before any command is treated as sent.

The Registry backend file is `dist/sandbox/plugin.mjs`. After this slice it is
131040 bytes, 32 bytes under the 131072-byte cap.
