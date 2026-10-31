---
"@dinkuskit/commerce": minor
---

Agents and the `dinkus-commerce` CLI can correct a Processing order's delivery address through the private `orders` route (`action: "address"`, `orders address`), with the Orders page's Correct address checks: at the confirmed order version, checked as checkout checks an address, only to a country the store ships to, never on a Completed order, and billing unchanged.
