---
"@dinkuskit/commerce": minor
---

Agents and tools can manage products through the private `catalog` route with an EmDash API token: list, get, create, link, prices and stock status, choices, SKU, weight, identifiers, archive, pictures and feeds, with the same checks as the product page panels. The `dinkus-commerce` CLI gains product commands on that route, each previewed with `--dry-run` and sent with the `--confirm` value it printed, which Commerce checks before it saves. A smaller Registry build makes room for it without removing anything.
